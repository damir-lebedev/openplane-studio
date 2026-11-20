//! OpenPlane Studio — команды для окна приложения.
//!
//! Окно (React) решает, что показывать; здесь — всё, что требует доступа к
//! системе: USB и COM-порты, PlatformIO, файлы ангара.

mod blackbox;
mod devices;
mod dfuse;
mod firmware;
mod hangar;
mod link;
mod radio;
mod setup;
mod sitl;
mod source;
mod system;
mod update;
#[cfg(target_os = "android")]
mod usb_android;
mod util;
mod wifi_ota;

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use util::{find_pio, find_python, home, Res};

async fn blocking<T, F>(f: F) -> Res<T>
where
    T: Send + 'static,
    F: FnOnce() -> Res<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("задача: {e}"))?
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
    platform: String,
    /// Процессор сборки (aarch64, arm, x86_64…) — в отчёты: 32-битный телефон или нет (PLAN.md P53).
    arch: String,
    hangar_dir: String,
    cache_dir: String,
    pio: Option<String>,
    python: Option<String>,
    /// Где, скорее всего, лежат исходники прошивки (папка plane рядом).
    firmware_guess: Option<String>,
}

fn guess_firmware() -> Option<PathBuf> {
    let candidates = [
        home().join("Documents").join("PlatformIO").join("Projects").join("plane"),
        home().join("Documents").join("PlatformIO").join("Projects").join("OpenPlaneProject"),
        // скачанные подготовкой компьютера (установщик, «Настройки»)
        setup::default_source(&util::local_data_dir()),
    ];
    candidates.into_iter().find(|p| p.join("tools").join("opconfig.py").is_file())
}

#[tauri::command]
fn app_info(app: AppHandle) -> Res<AppInfo> {
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        hangar_dir: s(util::hangar_dir(&app)?),
        cache_dir: s(util::cache_dir(&app)?),
        pio: find_pio().map(s),
        python: find_python().map(s),
        firmware_guess: guess_firmware().map(s),
    })
}

#[tauri::command]
async fn update_check() -> Res<update::UpdateInfo> {
    blocking(update::check).await
}

#[tauri::command]
async fn update_download(app: AppHandle, asset: update::Asset) -> Res<String> {
    blocking(move || {
        update::cleanup(&app, Some(&asset.name))?;
        update::download(&app, &asset)
    })
    .await
}

#[tauri::command]
fn update_install(app: AppHandle, path: String) -> Res<bool> {
    update::install(&app, &path)
}

#[tauri::command]
fn update_cleanup(app: AppHandle) -> Res<()> {
    update::cleanup(&app, None)
}

#[tauri::command]
fn radio_find_sd() -> Vec<String> {
    radio::find_radio_sd()
}

#[tauri::command]
async fn radio_read_logs(sd: String) -> Res<Vec<radio::RadioLog>> {
    blocking(move || radio::read_logs(&sd, 5)).await
}

#[tauri::command]
async fn radio_read_last_gps(sd: String) -> Res<Option<String>> {
    blocking(move || radio::read_last_gps(&sd)).await
}

#[tauri::command]
fn open_map(url: String) -> Res<()> {
    radio::open_map(&url)
}

#[tauri::command]
async fn radio_install_lua(app: AppHandle, sd: String) -> Res<radio::LuaInstalled> {
    blocking(move || radio::install_lua(&app, &sd)).await
}

#[tauri::command]
async fn radio_install_oplane(source: String, sd: String) -> Res<usize> {
    blocking(move || radio::install_oplane(&source, &sd)).await
}

#[tauri::command]
fn settings_load(app: AppHandle) -> Res<Value> {
    hangar::load_settings(&app)
}

#[tauri::command]
fn settings_save(app: AppHandle, settings: Value) -> Res<()> {
    hangar::save_settings(&app, &settings)
}

#[tauri::command]
fn hangar_list(app: AppHandle) -> Res<Vec<Value>> {
    hangar::list(&app)
}

#[tauri::command]
fn hangar_save(app: AppHandle, plane: Value) -> Res<()> {
    hangar::save(&app, &plane)
}

#[tauri::command]
fn hangar_remove(app: AppHandle, id: String) -> Res<()> {
    hangar::remove(&app, &id)
}

#[tauri::command]
fn hangar_history(app: AppHandle, id: String) -> Res<Vec<Value>> {
    hangar::history(&app, &id)
}

#[tauri::command]
fn hangar_snapshot(app: AppHandle, id: String, label: String, data: Value) -> Res<String> {
    hangar::snapshot(&app, &id, &label, &data)
}

#[tauri::command]
async fn firmware_describe(source: String) -> Res<Value> {
    blocking(move || firmware::describe(Path::new(&source))).await
}

#[tauri::command]
async fn firmware_commit(source: String) -> Res<Option<String>> {
    blocking(move || Ok(firmware::source_commit(Path::new(&source)))).await
}

#[tauri::command]
async fn firmware_fetch_github(app: AppHandle, version: Option<String>) -> Res<firmware::Fetched> {
    blocking(move || firmware::fetch_github(&app, version.as_deref())).await
}

#[tauri::command]
async fn firmware_versions() -> Res<Vec<String>> {
    blocking(firmware::versions).await
}

#[tauri::command]
async fn firmware_prepare(app: AppHandle, source: String, plane_id: String) -> Res<firmware::Prepared> {
    blocking(move || firmware::prepare(&app, Path::new(&source), &plane_id)).await
}

#[tauri::command]
async fn firmware_apply(source: String, dir: String, config: Value) -> Res<Value> {
    blocking(move || firmware::apply(Path::new(&source), Path::new(&dir), &config)).await
}

#[tauri::command]
async fn firmware_build(app: AppHandle, dir: String, env: String) -> Res<firmware::TaskResult> {
    blocking(move || firmware::build(&app, Path::new(&dir), &env)).await
}

#[tauri::command]
async fn firmware_upload(app: AppHandle, dir: String, env: String, port: Option<String>) -> Res<firmware::TaskResult> {
    blocking(move || firmware::upload(&app, Path::new(&dir), &env, port.as_deref())).await
}

/// «Экспорт для телефона»: firmware.bin → «Загрузки»/<name>, папка открывается.
#[tauri::command]
async fn firmware_export_bin(dir: String, env: String, name: String) -> Res<String> {
    blocking(move || {
        let out = firmware::export_bin(Path::new(&dir), &env, &name, None)?;
        let _ = firmware::reveal(Path::new(&out));
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn bf_board(app: AppHandle, source: String, args: Vec<String>) -> Res<firmware::TaskResult> {
    blocking(move || firmware::bf_board(&app, Path::new(&source), &args)).await
}

#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Текстовый файл платы (дамп CLI Betaflight, .txt) — для переноса настроек.
#[tauri::command]
fn text_read(path: String) -> Res<String> {
    if Path::new(&path).extension().and_then(|e| e.to_str()) != Some("txt") {
        return Err("читаются только .txt".into());
    }
    std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
async fn devices_list() -> Res<Vec<devices::Device>> {
    blocking(|| Ok(devices::list())).await
}

#[tauri::command]
async fn board_identity(port: String, stm32: bool) -> Res<Option<Value>> {
    blocking(move || devices::identity(&port, stm32)).await
}

/// Прошить готовый `.bin` (телефон, USB-OTG): тело запроса — байты образа,
/// заголовки `port` (порт платы с нашей прошивкой; нет — плата уже в DFU) и
/// `chip` (f405/h743 — для проверки). Прогресс — события "flash-progress".
#[tauri::command]
async fn firmware_flash_bin(app: AppHandle, request: tauri::ipc::Request<'_>) -> Res<Value> {
    let tauri::ipc::InvokeBody::Raw(image) = request.body() else {
        return Err("прошивка: ждали байты образа".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).filter(|v| !v.is_empty()).map(str::to_string);
    let (image, port, chip) = (image.clone(), header("port"), header("chip"));
    #[cfg(target_os = "android")]
    {
        blocking(move || {
            let done = usb_android::flash(&app, port.as_deref(), &image, chip.as_deref())?;
            serde_json::to_value(done).map_err(|e| e.to_string())
        })
        .await
    }
    #[cfg(not(target_os = "android"))]
    {
        // на ПК шьёт PlatformIO (firmware_upload): там же собирается образ
        let _ = (app, image, port, chip);
        Err("DESKTOP_USES_PIO: на компьютере прошивка — кнопкой «Прошить»".into())
    }
}

/// Готовый `firmware-<env>.bin` из последнего релиза Studio (P49) — байтами.
/// Телефон: качает Kotlin-плагин (у github.com нет CORS для fetch из окна); ПК — curl.
#[tauri::command]
async fn firmware_release_bin(env: String) -> Res<tauri::ipc::Response> {
    let url = update::release_bin_url(&env)?;
    blocking(move || {
        #[cfg(target_os = "android")]
        let bytes = usb_android::download(&url, update::RELEASE_BIN_MAX)?;
        #[cfg(not(target_os = "android"))]
        let bytes = {
            let tmp = std::env::temp_dir().join(format!("openplane-release-{env}.bin"));
            source::download(&url, &tmp).map_err(|e| format!("NOT_FOUND: {e}"))?;
            let b = std::fs::read(&tmp).map_err(|e| format!("файл {}: {e}", tmp.display()))?;
            let _ = std::fs::remove_file(&tmp);
            b
        };
        if bytes.is_empty() || bytes.len() > update::RELEASE_BIN_MAX {
            return Err(format!("TOO_BIG: файл {} байт — не прошивка", bytes.len()));
        }
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
}

/// Самолёт на ESP32 по WiFi (P50): паспорт и окно прошивки (`GET /ota`).
#[tauri::command]
async fn firmware_wifi_status(host: Option<String>) -> Res<wifi_ota::OtaStatus> {
    let host = host.unwrap_or_else(|| wifi_ota::DEFAULT_HOST.into());
    blocking(move || wifi_ota::status(&host, std::time::Duration::from_secs(3))).await
}

/// Отправить образ по WiFi: тело — байты (телефон, файл) или пусто и заголовок
/// `path` (ПК, `firmware.bin` сборки); заголовки `host`, `name`.
/// Прогресс — "flash-progress" (phase "upload"). После "OK" плата перезагружается.
#[tauri::command]
async fn firmware_wifi_flash(app: AppHandle, request: tauri::ipc::Request<'_>) -> Res<()> {
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).filter(|v| !v.is_empty()).map(str::to_string);
    let body = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        _ => Vec::new(),
    };
    let (host, name, path) = (header("host").unwrap_or_else(|| wifi_ota::DEFAULT_HOST.into()), header("name"), header("path"));
    blocking(move || {
        let image = match &path {
            Some(p) if body.is_empty() => std::fs::read(p).map_err(|e| format!("файл {p}: {e}"))?,
            _ => body,
        };
        let name = name.or_else(|| path.as_deref().and_then(|p| Path::new(p).file_name()).map(|n| n.to_string_lossy().into_owned()));
        wifi_ota::upload(&host, name.as_deref().unwrap_or("firmware.bin"), &image, |fraction| {
            let _ = app.emit("flash-progress", serde_json::json!({ "phase": "upload", "fraction": fraction }));
        })
    })
    .await
}

/// Ждать, пока плата после прошивки снова ответит в своей сети.
#[tauri::command]
async fn firmware_wifi_wait(host: Option<String>, timeout_s: Option<u64>) -> Res<wifi_ota::OtaStatus> {
    let host = host.unwrap_or_else(|| wifi_ota::DEFAULT_HOST.into());
    let timeout = std::time::Duration::from_secs(timeout_s.unwrap_or(30));
    blocking(move || wifi_ota::wait_back(&host, timeout)).await
}

/// Телефон: подключиться к точке платы (системное окно Android). ПК — сам пользователь.
#[tauri::command]
async fn wifi_join(ssid: String, password: String) -> Res<bool> {
    #[cfg(target_os = "android")]
    {
        blocking(move || usb_android::wifi_join(&ssid, &password).map(|_| true)).await
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (ssid, password);
        Ok(false)
    }
}

#[tauri::command]
async fn wifi_release() -> Res<()> {
    #[cfg(target_os = "android")]
    usb_android::wifi_release();
    Ok(())
}

#[tauri::command]
async fn board_bootloader(port: String) -> Res<()> {
    blocking(move || devices::reboot_to_bootloader(&port)).await
}

#[tauri::command]
async fn port_holders() -> Res<Vec<system::PortHolder>> {
    blocking(|| Ok(system::port_holders())).await
}

#[tauri::command]
async fn port_holders_kill(pids: Vec<u32>) -> Res<usize> {
    blocking(move || system::kill_port_holders(&pids)).await
}

#[tauri::command]
async fn dfu_driver_status() -> Res<system::DriverStatus> {
    blocking(system::dfu_driver).await
}

#[tauri::command]
async fn dfu_driver_install(app: AppHandle) -> Res<system::DriverInstall> {
    blocking(move || system::install_dfu_driver(&app)).await
}

#[tauri::command]
async fn platformio_install(app: AppHandle, lang: Option<String>) -> Res<String> {
    blocking(move || system::install_platformio(&app, lang.as_deref() == Some("en"))).await
}

#[tauri::command]
async fn setup_status(app: AppHandle) -> Res<setup::Status> {
    let resources = app.path().resource_dir().ok().map(|d| d.join("resources"));
    blocking(move || Ok(setup::status(&util::local_data_dir(), resources.as_deref()))).await
}

/// Подготовка компьютера из окна: строки — событиями "task-log" (task = "setup").
#[tauri::command]
async fn setup_run(app: AppHandle, options: setup::Options) -> Res<setup::Report> {
    blocking(move || {

        let resources = app.path().resource_dir().ok().map(|d| d.join("resources"));
        let emitter = app.clone();
        let log: setup::Log = std::sync::Arc::new(move |line: &str| {
            let _ = emitter.emit("task-log", util::LogLine { task: "setup", stream: "out", line: line.to_string() });
        });
        setup::run(resources, &options, log)
    })
    .await
}

/// Подготовка компьютера без окна — для установщика: `--setup ...`.
/// Возвращает код выхода, если это был такой запуск.
pub fn cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    args.iter().any(|a| a == "--setup").then(|| setup::cli(&args))
}

#[tauri::command]
async fn link_start(app: AppHandle, port: String, stm32: bool) -> Res<()> {
    let app2 = app.clone();
    blocking(move || app2.state::<link::LinkState>().start(&app, &port, stm32)).await
}

#[tauri::command]
async fn link_stop(app: AppHandle) -> Res<()> {
    blocking(move || app.state::<link::LinkState>().stop()).await
}

#[tauri::command]
fn link_send(state: State<'_, link::LinkState>, text: String) -> Res<()> {
    state.send(text.into_bytes())
}

#[tauri::command]
fn link_port(state: State<'_, link::LinkState>) -> Option<String> {
    state.port()
}

/// Полёты на плате: {"state": {...}, "flights": [{n, sectors, kb, seconds, start}, ...]}.
#[tauri::command]
async fn blackbox_list(app: AppHandle) -> Res<Value> {
    blocking(move || match app.state::<link::LinkState>().blackbox(blackbox::Job::List)? {
        blackbox::Done::List(v) => Ok(v),
        blackbox::Done::Get(_) => Err("чёрный ящик: не тот ответ".into()),
    })
    .await
}

/// Выгрузить полёт с платы в папку проекта; путь к файлу .bbl.
#[tauri::command]
async fn blackbox_download(app: AppHandle, flight: u16, project: Option<String>) -> Res<String> {
    blocking(move || match app.state::<link::LinkState>().blackbox(blackbox::Job::Get(flight))? {
        blackbox::Done::Get(data) => blackbox::save(&app, project.as_deref(), flight, &data),
        blackbox::Done::List(_) => Err("чёрный ящик: не тот ответ".into()),
    })
    .await
}

#[tauri::command]
async fn blackbox_files(app: AppHandle, project: Option<String>) -> Res<Vec<blackbox::LogFile>> {
    blocking(move || blackbox::files(&app, project.as_deref())).await
}

/// Файл журнала целиком — в приложение двоичным ответом (без JSON).
#[tauri::command]
async fn blackbox_read(path: String) -> Res<tauri::ipc::Response> {
    blocking(move || blackbox::read(&path).map(tauri::ipc::Response::new)).await
}

#[tauri::command]
fn sitl_status(state: State<'_, sitl::SitlState>, dir: String) -> sitl::SitlStatus {
    state.status(Path::new(&dir))
}

/// Запустить симулятор (если ещё нет) — имя порта для link_start.
#[tauri::command]
async fn sitl_start(app: AppHandle, dir: String) -> Res<String> {
    blocking(move || app.state::<sitl::SitlState>().start(Path::new(&dir))).await
}

#[tauri::command]
async fn sitl_stop(app: AppHandle) -> Res<()> {
    blocking(move || {
        app.state::<link::LinkState>().stop()?;
        app.state::<sitl::SitlState>().stop();
        Ok(())
    })
    .await
}

#[tauri::command]
async fn sitl_reset(app: AppHandle) -> Res<()> {
    blocking(move || {
        app.state::<link::LinkState>().stop()?;
        app.state::<sitl::SitlState>().reset_settings()
    })
    .await
}

/// Собрать симулятор; вывод — событиями задачи "build", как у прошивки.
#[tauri::command]
async fn sitl_build(app: AppHandle, dir: String) -> Res<bool> {
    blocking(move || {
        app.state::<sitl::SitlState>().stop();
        sitl::build(&app, Path::new(&dir)).map(|(ok, _)| ok)
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // телефон: USB-OTG через Kotlin-плагин (порт платы и загрузчик DFU)
    #[cfg(target_os = "android")]
    let builder = builder.plugin(usb_android::init());
    builder
        .manage(link::LinkState::default())
        .manage(sitl::SitlState::default())
        .invoke_handler(tauri::generate_handler![
            link_start,
            link_stop,
            link_send,
            link_port,
            blackbox_list,
            blackbox_download,
            blackbox_files,
            blackbox_read,
            app_info,
            update_check,
            update_download,
            update_install,
            update_cleanup,
            radio_find_sd,
            radio_install_lua,
            radio_install_oplane,
            radio_read_logs,
            radio_read_last_gps,
            open_map,
            settings_load,
            settings_save,
            hangar_list,
            hangar_save,
            hangar_remove,
            hangar_snapshot,
            hangar_history,
            firmware_describe,
            firmware_commit,
            firmware_fetch_github,
            firmware_versions,
            firmware_prepare,
            firmware_apply,
            firmware_build,
            firmware_upload,
            firmware_export_bin,
            bf_board,
            path_exists,
            text_read,
            devices_list,
            board_identity,
            board_bootloader,
            firmware_flash_bin,
            firmware_release_bin,
            firmware_wifi_status,
            firmware_wifi_flash,
            firmware_wifi_wait,
            wifi_join,
            wifi_release,
            port_holders,
            port_holders_kill,
            dfu_driver_status,
            dfu_driver_install,
            platformio_install,
            setup_status,
            setup_run,
            sitl_status,
            sitl_start,
            sitl_stop,
            sitl_reset,
            sitl_build,
        ])
        .build(tauri::generate_context!())
        .expect("OpenPlane Studio не запустился")
        .run(|app, event| {
            // приложение закрыли — симулятор не остаётся висеть на порту
            if let tauri::RunEvent::Exit = event {
                app.state::<sitl::SitlState>().stop();
            }
        });
}
