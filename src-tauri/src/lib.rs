//! OpenPlane Studio — команды для окна приложения.
//!
//! Окно (React) решает, что показывать; здесь — всё, что требует доступа к
//! системе: USB и COM-порты, PlatformIO, файлы ангара.

mod devices;
mod firmware;
mod hangar;
mod link;
mod system;
mod util;

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

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
    ];
    candidates.into_iter().find(|p| p.join("tools").join("opconfig.py").is_file())
}

#[tauri::command]
fn app_info(app: AppHandle) -> Res<AppInfo> {
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        platform: std::env::consts::OS.into(),
        hangar_dir: s(util::hangar_dir(&app)?),
        cache_dir: s(util::cache_dir(&app)?),
        pio: find_pio().map(s),
        python: find_python().map(s),
        firmware_guess: guess_firmware().map(s),
    })
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
async fn firmware_fetch_github(app: AppHandle, version: Option<String>) -> Res<String> {
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

#[tauri::command]
async fn devices_list() -> Res<Vec<devices::Device>> {
    blocking(|| Ok(devices::list())).await
}

#[tauri::command]
async fn board_identity(port: String, stm32: bool) -> Res<Option<Value>> {
    blocking(move || devices::identity(&port, stm32)).await
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
async fn platformio_install(app: AppHandle) -> Res<String> {
    blocking(move || system::install_platformio(&app)).await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(link::LinkState::default())
        .invoke_handler(tauri::generate_handler![
            link_start,
            link_stop,
            link_send,
            link_port,
            app_info,
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
            devices_list,
            board_identity,
            board_bootloader,
            port_holders,
            port_holders_kill,
            dfu_driver_status,
            dfu_driver_install,
            platformio_install,
        ])
        .run(tauri::generate_context!())
        .expect("OpenPlane Studio не запустился");
}
