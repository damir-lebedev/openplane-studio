//! Что подключено по USB: COM-порты (наша прошивка, мосты ESP32) и
//! STM32 в системном загрузчике DFU (у него COM-порта нет).

use std::io::{Read, Write};
use std::time::{Duration, Instant};

use nusb::MaybeFuture;
use serde::Serialize;
use serde_json::Value;
use serialport::{SerialPortType, UsbPortInfo};

use crate::util::{err, Res};

pub const STM32_VID: u16 = 0x0483;
pub const STM32_CDC_PID: u16 = 0x5740;
pub const STM32_DFU_PID: u16 = 0xDF11;

#[derive(Serialize, Clone, Debug)]
pub struct Device {
    /// stm32-cdc — STM32 с виртуальным COM (наша прошивка на DevEBox);
    /// stm32-dfu — STM32 в загрузчике, можно шить;
    /// esp32-usb — родной USB ESP32-S3/C3; usb-serial — мост CH340/CH343/CP210x/FTDI;
    /// serial — прочий COM-порт.
    pub kind: String,
    pub port: Option<String>,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub product: Option<String>,
    pub manufacturer: Option<String>,
    pub serial: Option<String>,
    /// Название для человека: «STM32 в режиме прошивки», «мост CH343»…
    pub title: String,
}

fn bridge_name(vid: u16, pid: u16) -> Option<&'static str> {
    match (vid, pid) {
        (0x1A86, 0x7523) => Some("CH340"),
        (0x1A86, 0x55D3) | (0x1A86, 0x55D4) => Some("CH343"),
        (0x1A86, _) => Some("CH34x"),
        (0x10C4, 0xEA60) => Some("CP210x"),
        (0x0403, _) => Some("FTDI"),
        _ => None,
    }
}

fn classify(port: &str, usb: &UsbPortInfo) -> Device {
    let (vid, pid) = (usb.vid, usb.pid);
    let (kind, title) = if vid == STM32_VID && pid == STM32_CDC_PID {
        ("stm32-cdc", "STM32, USB-порт".to_string())
    } else if vid == 0x303A {
        ("esp32-usb", "ESP32, родной USB".to_string())
    } else if let Some(name) = bridge_name(vid, pid) {
        ("usb-serial", format!("мост {name}"))
    } else {
        ("serial", usb.product.clone().unwrap_or_else(|| "COM-порт".into()))
    };
    Device {
        kind: kind.into(),
        port: Some(port.into()),
        vid: Some(vid),
        pid: Some(pid),
        product: usb.product.clone(),
        manufacturer: usb.manufacturer.clone(),
        serial: usb.serial_number.clone(),
        title,
    }
}

pub fn list() -> Vec<Device> {
    let mut out = Vec::new();
    if let Ok(ports) = serialport::available_ports() {
        for p in ports {
            // macOS: /dev/tty.* ждёт несущую при открытии — берём /dev/cu.* того же порта.
            if cfg!(target_os = "macos") && p.port_name.starts_with("/dev/tty.") {
                continue;
            }
            if let SerialPortType::UsbPort(usb) = &p.port_type {
                out.push(classify(&p.port_name, usb));
            }
        }
    }
    if let Ok(devices) = nusb::list_devices().wait() {
        for d in devices {
            if d.vendor_id() == STM32_VID && d.product_id() == STM32_DFU_PID {
                out.push(Device {
                    kind: "stm32-dfu".into(),
                    port: None,
                    vid: Some(STM32_VID),
                    pid: Some(STM32_DFU_PID),
                    product: d.product_string().map(str::to_string),
                    manufacturer: d.manufacturer_string().map(str::to_string),
                    serial: d.serial_number().map(str::to_string),
                    title: "STM32 в режиме прошивки (DFU)".into(),
                });
            }
        }
    }
    out
}

fn open(port: &str, stm32: bool) -> Res<Box<dyn serialport::SerialPort>> {
    // DevEBox (USB CDC) молчит без DTR. У ESP32 DTR/RTS дёргают сброс и
    // загрузчик — их не трогаем, как monitor_dtr/monitor_rts = 0 в platformio.ini.
    let mut p = serialport::new(port, 115_200)
        .timeout(Duration::from_millis(50))
        .dtr_on_open(stm32)
        .open()
        .map_err(|e| {
            let text = e.to_string();
            if text.contains("Access is denied") || text.contains("Отказано в доступе") || text.contains("os error 5") {
                format!("PORT_BUSY: {port} занят другой программой")
            } else {
                format!("{port}: {text}")
            }
        })?;
    if !stm32 {
        let _ = p.write_request_to_send(false);
    }
    Ok(p)
}

/// Паспорт прошивки: STX "id" '\n' → строка "@id {...}" (FirmwareIdentity.h).
/// Нет ответа — Ok(None): на плате не наша прошивка или старая.
pub fn identity(port: &str, stm32: bool) -> Res<Option<Value>> {
    let mut p = open(port, stm32)?;
    let _ = p.clear(serialport::ClearBuffer::Input);
    let deadline = Instant::now() + Duration::from_millis(2500);
    let mut next_ask = Instant::now();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 512];
    while Instant::now() < deadline {
        if Instant::now() >= next_ask {
            p.write_all(b"\x02id\n").map_err(err("запись в порт"))?;
            let _ = p.flush();
            next_ask = Instant::now() + Duration::from_millis(700);
        }
        match p.read(&mut chunk) {
            Ok(n) if n > 0 => buf.extend_from_slice(&chunk[..n]),
            _ => {}
        }
        let text = String::from_utf8_lossy(&buf).into_owned();
        for line in text.split(['\n', '\r']) {
            if let Some(json) = line.trim().strip_prefix("@id ") {
                if let Ok(v) = serde_json::from_str::<Value>(json) {
                    return Ok(Some(v));
                }
            }
        }
    }
    Ok(None)
}

/// Клавиша 'D' консоли: плата перезагружается в загрузчик USB DFU (STM32).
pub fn reboot_to_bootloader(port: &str) -> Res<()> {
    let mut p = open(port, true)?;
    p.write_all(b"D").map_err(err("запись в порт"))?;
    let _ = p.flush();
    std::thread::sleep(Duration::from_millis(150));
    Ok(())
}
