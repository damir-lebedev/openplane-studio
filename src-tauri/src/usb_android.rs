//! Android: плата по USB-OTG через Kotlin-плагин `UsbPlugin`
//! (gen/android/app/src/main/java/com/openplane/studio/usb/).
//!
//! Плагин даёт только «сырой» USB: список устройств, разрешение, CDC-порт
//! (usb-serial-for-android, DTR) и control-передачи к загрузчику DFU. Всё
//! остальное — здесь и в общих модулях: `AndroidPort` реализует Read/Write,
//! поэтому link.rs, чёрный ящик и паспорт платы работают как на ПК; протокол
//! прошивки — dfuse.rs (проверен тестами на ПК).
//!
//! Входящие байты порта идут не через JSON-ответы плагина, а прямым JNI-вызовом
//! из потока чтения Kotlin (`UsbNative.data`) — без опроса и без главного потока.
//!
//! Порт на телефоне называется "usb:<deviceName>", например "usb:/dev/bus/usb/001/002".

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use jni::objects::{JByteArray, JClass, JString};
use jni::sys::jint;
use jni::JNIEnv;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Emitter, Wry};

use crate::devices::{self, Device};
use crate::dfuse::{self, Alt, Dfu, Transport, FLASH_BASE};
use crate::util::Res;

static PLUGIN: OnceLock<PluginHandle<Wry>> = OnceLock::new();

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("usb")
        .setup(|_app, api| {
            let handle = api
                .register_android_plugin("com.openplane.studio.usb", "UsbPlugin")
                .map_err(|e| e.to_string())?;
            // devices::list() и link::open() зовутся без AppHandle — ручка глобально
            let _ = PLUGIN.set(handle);
            Ok(())
        })
        .build()
}

fn call<T: DeserializeOwned>(cmd: &str, payload: Value) -> Res<T> {
    let h = PLUGIN.get().ok_or("USB-плагин не запущен")?;
    h.run_mobile_plugin(cmd, payload).map_err(|e| {
        let text = e.to_string();
        // Kotlin отклоняет с кодом в начале текста: "NO_PERMISSION: …", "NOT_FOUND: …"
        text.trim_start_matches("error: ").to_string()
    })
}

pub fn device_name(port: &str) -> Option<&str> {
    port.strip_prefix("usb:")
}

// ---------- список устройств ----------

#[derive(Deserialize)]
struct UsbDev {
    name: String,
    vid: u16,
    pid: u16,
    product: Option<String>,
    manufacturer: Option<String>,
    serial: Option<String>,
}

pub fn list() -> Vec<Device> {
    let found: Vec<UsbDev> = match call::<Value>("listDevices", json!({})) {
        Ok(v) => serde_json::from_value(v["devices"].clone()).unwrap_or_default(),
        Err(_) => return Vec::new(),
    };
    found
        .into_iter()
        .map(|d| {
            let mut dev = devices::classify_ids(
                &format!("usb:{}", d.name),
                d.vid,
                d.pid,
                d.product,
                d.manufacturer,
                d.serial,
            );
            if dev.kind == "stm32-dfu" {
                // как на ПК: у загрузчика нет порта, прошивка находит его сама
                dev.port = None;
            }
            dev
        })
        .collect()
}

// ---------- порт (CDC) ----------

type Inbox = Sender<Option<Vec<u8>>>;

fn inboxes() -> &'static Mutex<HashMap<i32, Inbox>> {
    static M: OnceLock<Mutex<HashMap<i32, Inbox>>> = OnceLock::new();
    M.get_or_init(Default::default)
}

/// Поток чтения Kotlin: пришли байты порта `id`.
#[no_mangle]
pub extern "system" fn Java_com_openplane_studio_usb_UsbNative_data<'l>(
    env: JNIEnv<'l>,
    _class: JClass<'l>,
    id: jint,
    data: JByteArray<'l>,
) {
    let Ok(bytes) = env.convert_byte_array(&data) else { return };
    if let Some(tx) = inboxes().lock().unwrap().get(&id) {
        let _ = tx.send(Some(bytes));
    }
}

/// Порт закрылся (кабель выдернули, ошибка USB): читатель получит BrokenPipe.
#[no_mangle]
pub extern "system" fn Java_com_openplane_studio_usb_UsbNative_closed<'l>(
    _env: JNIEnv<'l>,
    _class: JClass<'l>,
    id: jint,
    _reason: JString<'l>,
) {
    if let Some(tx) = inboxes().lock().unwrap().remove(&id) {
        let _ = tx.send(None);
    }
}

pub struct AndroidPort {
    id: i32,
    rx: Receiver<Option<Vec<u8>>>,
    pending: Vec<u8>,
    closed: bool,
}

fn next_id() -> i32 {
    static N: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(1);
    N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

/// Открыть CDC-порт платы. `dtr` — для STM32 (без DTR наша прошивка молчит);
/// у ESP32 DTR/RTS дёргают сброс — не трогаем, как на ПК.
pub fn open(port: &str, dtr: bool) -> Res<AndroidPort> {
    let name = device_name(port).ok_or_else(|| format!("{port}: не USB-устройство"))?;
    let (tx, rx) = channel();
    // ящик — до открытия: первые байты платы приходят сразу
    let id = next_id();
    inboxes().lock().unwrap().insert(id, tx);
    if let Err(e) = call::<Value>("serialOpen", json!({ "id": id, "name": name, "baud": 115_200, "dtr": dtr })) {
        inboxes().lock().unwrap().remove(&id);
        return Err(e);
    }
    Ok(AndroidPort { id, rx, pending: Vec::new(), closed: false })
}

impl Read for AndroidPort {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.pending.is_empty() {
            if self.closed {
                return Err(std::io::ErrorKind::BrokenPipe.into());
            }
            match self.rx.recv_timeout(Duration::from_millis(30)) {
                Ok(Some(b)) => self.pending = b,
                Ok(None) | Err(RecvTimeoutError::Disconnected) => {
                    self.closed = true;
                    return Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "USB: плата отключена"));
                }
                Err(RecvTimeoutError::Timeout) => return Err(std::io::ErrorKind::TimedOut.into()),
            }
            // склеиваем всё, что уже пришло — меньше вызовов на поток связи
            while let Ok(Some(more)) = self.rx.try_recv() {
                self.pending.extend_from_slice(&more);
            }
        }
        let n = buf.len().min(self.pending.len());
        buf[..n].copy_from_slice(&self.pending[..n]);
        self.pending.drain(..n);
        Ok(n)
    }
}

impl Write for AndroidPort {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.closed {
            return Err(std::io::ErrorKind::BrokenPipe.into());
        }
        call::<Value>("serialWrite", json!({ "id": self.id, "data": buf }))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::BrokenPipe, e))?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl Drop for AndroidPort {
    fn drop(&mut self) {
        inboxes().lock().unwrap().remove(&self.id);
        let _ = call::<Value>("serialClose", json!({ "id": self.id }));
    }
}

// ---------- загрузчик DFU ----------

#[derive(Deserialize)]
struct DfuOpened {
    raw: Vec<u8>,
    alts: Vec<DfuAlt>,
}

#[derive(Deserialize)]
struct DfuAlt {
    interface: u8,
    alt: u8,
    name: String,
}

struct PluginDfu {
    id: i32,
}

impl Transport for PluginDfu {
    fn control_out(&mut self, request: u8, value: u16, data: &[u8]) -> Res<()> {
        call::<Value>("dfuOut", json!({ "id": self.id, "request": request, "value": value, "data": data }))?;
        Ok(())
    }
    fn control_in(&mut self, request: u8, value: u16, len: usize) -> Res<Vec<u8>> {
        #[derive(Deserialize)]
        struct Got {
            data: Vec<u8>,
        }
        let g: Got = call("dfuIn", json!({ "id": self.id, "request": request, "value": value, "length": len }))?;
        Ok(g.data)
    }
}

impl Drop for PluginDfu {
    fn drop(&mut self) {
        let _ = call::<Value>("dfuClose", json!({ "id": self.id }));
    }
}

fn find_dfu() -> Option<String> {
    let found: Vec<UsbDev> = call::<Value>("listDevices", json!({}))
        .ok()
        .and_then(|v| serde_json::from_value(v["devices"].clone()).ok())
        .unwrap_or_default();
    found
        .into_iter()
        .find(|d| d.vid == devices::STM32_VID && d.pid == devices::STM32_DFU_PID)
        .map(|d| d.name)
}

#[derive(Clone, Serialize)]
struct FlashProgress {
    phase: String,
    fraction: f32,
}

#[derive(Serialize)]
pub struct Flashed {
    pub chip: String,
    pub bytes: usize,
    pub seconds: f32,
}

/// Прошить готовый образ: плата с нашей прошивкой (`port`) уходит в загрузчик
/// по 'D' (заармленная — отказ прошивки, ловим её ответ), ждём 0483:DF11 до
/// 10 с; плата уже в загрузчике — `port` не нужен. События "flash-progress".
pub fn flash(app: &AppHandle, port: Option<&str>, image: &[u8], want_chip: Option<&str>) -> Res<Flashed> {
    let started = Instant::now();
    let emit = |phase: &str, fraction: f32| {
        let _ = app.emit("flash-progress", FlashProgress { phase: phase.into(), fraction });
    };
    let mut dfu_name = find_dfu();
    if dfu_name.is_none() {
        let port = port.ok_or("NO_BOARD: плата не найдена — подключите кабель")?;
        emit("bootloader", 0.0);
        reboot_to_bootloader(port)?;
        let deadline = Instant::now() + Duration::from_secs(10);
        while dfu_name.is_none() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(250));
            dfu_name = find_dfu();
        }
    }
    let name = dfu_name.ok_or("NO_DFU: плата не появилась в режиме прошивки за 10 с")?;
    let id = next_id();
    let opened: DfuOpened = call("dfuOpen", json!({ "id": id, "name": name }))?;
    let t = PluginDfu { id }; // закроется сам при любом выходе
    let alts: Vec<Alt> =
        opened.alts.into_iter().map(|a| Alt { interface: a.interface, alt: a.alt, name: a.name }).collect();
    let alt = dfuse::pick_internal_flash(&alts).ok_or("DFU: нет «@Internal Flash» у загрузчика")?.clone();
    call::<Value>("dfuClaim", json!({ "id": id, "interface": alt.interface, "alt": alt.alt }))?;
    let mut dfu = Dfu::new(t, &alt.name, dfuse::transfer_size(&opened.raw));
    let chip = dfu.chip.to_string();
    let mut last = (String::new(), -1.0f32);
    dfu.flash(FLASH_BASE, image, want_chip, &mut |phase, f| {
        // не чаще шага 1 % — окну хватает, мост не забивается
        if phase != last.0 || f - last.1 >= 0.01 || f >= 1.0 {
            last = (phase.to_string(), f);
            emit(phase, f);
        }
    })?;
    dfu.leave(FLASH_BASE)?;
    emit("done", 1.0);
    Ok(Flashed { chip, bytes: image.len(), seconds: started.elapsed().as_secs_f32() })
}

/// 'D' в консоль; прошивка отказывает заармленной плате — читаем ответ.
pub fn reboot_to_bootloader(port: &str) -> Res<()> {
    let mut p = open(port, true)?;
    p.write_all(b"D").map_err(|e| format!("запись в порт: {e}"))?;
    let deadline = Instant::now() + Duration::from_millis(400);
    let mut got = Vec::new();
    let mut chunk = [0u8; 256];
    while Instant::now() < deadline {
        match p.read(&mut chunk) {
            Ok(n) => got.extend_from_slice(&chunk[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => break, // ушла в загрузчик
            Err(_) => {}
        }
    }
    if armed_refusal(&String::from_utf8_lossy(&got)) {
        return Err("ARMED: плата заармлена — снимите ARM и повторите".into());
    }
    Ok(())
}

/// Ответ консоли на 'D' при включённом ARM (CopterConsole::refuseArmed).
pub fn armed_refusal(text: &str) -> bool {
    text.to_lowercase().contains("только без arm")
}
