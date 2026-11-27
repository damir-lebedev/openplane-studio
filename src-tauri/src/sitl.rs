//! Симулятор (SITL): прошивка коптера, собранная для ПК (env "sitl" в
//! platformio.ini прошивки, src/sitl/main.cpp), — настоящий CLI, настройки,
//! живые кадры, а вместо железа модель полёта. Приложение собирает её из той
//! же копии исходников, что и прошивку платы, запускает и подключается по
//! TCP, как к COM-порту (link.rs, порт "tcp:127.0.0.1:5761"). Настройки
//! симулятора — свой «флеш» в папке данных приложения.

use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::AppHandle;

use crate::util::{command, home, local_data_dir, run_streaming, Res};

pub const PORT: u16 = 5761;

#[derive(Default)]
pub struct SitlState(Mutex<Option<Child>>);

#[derive(Serialize)]
pub struct SitlStatus {
    /// Собранный симулятор (путь к exe) или None — сначала собрать.
    pub exe: Option<String>,
    pub running: bool,
    pub port: String,
}

pub fn port_name() -> String {
    format!("tcp:127.0.0.1:{PORT}")
}

fn exe_path(dir: &Path) -> PathBuf {
    let name = if cfg!(windows) { "program.exe" } else { "program" };
    dir.join(".pio").join("build").join("sitl").join(name)
}

fn data_dir() -> PathBuf {
    local_data_dir().join("sitl")
}

impl SitlState {
    fn running(&self) -> bool {
        let Ok(mut guard) = self.0.lock() else { return false };
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                _ => {
                    *guard = None;
                    false
                }
            },
            None => false,
        }
    }

    pub fn status(&self, dir: &Path) -> SitlStatus {
        let exe = exe_path(dir);
        SitlStatus {
            exe: exe.is_file().then(|| exe.to_string_lossy().into_owned()),
            running: self.running(),
            port: port_name(),
        }
    }

    pub fn start(&self, dir: &Path) -> Res<String> {
        if self.running() {
            return Ok(port_name());
        }
        let exe = exe_path(dir);
        if !exe.is_file() {
            return Err("SITL_NOT_BUILT: симулятор ещё не собран".into());
        }
        // сирота от упавшего/убитого прошлого Studio занял бы порт и папку
        if let Some(build) = exe.parent() {
            crate::system::kill_running_from(build);
        }
        let data = data_dir();
        std::fs::create_dir_all(&data).map_err(|e| format!("{}: {e}", data.display()))?;
        let mut cmd = command(&exe);
        with_mingw(&mut cmd);
        let child = cmd
            .args(["--port", &PORT.to_string(), "--eeprom"])
            .arg(data.join("eeprom.bin"))
            .current_dir(&data)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("{}: {e}", exe.display()))?;
        *self.0.lock().map_err(|_| "симулятор: блокировка")? = Some(child);
        Ok(port_name())
    }

    /// Остановить (родитель SITL держит ребёнка в задании Windows — уходят оба).
    pub fn stop(&self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// Стереть настройки симулятора (как новая плата).
    pub fn reset_settings(&self) -> Res<()> {
        self.stop();
        let f = data_dir().join("eeprom.bin");
        if f.is_file() {
            std::fs::remove_file(&f).map_err(|e| format!("{}: {e}", f.display()))?;
        }
        Ok(())
    }
}

/// Собрать симулятор: pio run -e sitl в копии исходников. Нужен компилятор
/// C++ для ПК (на Windows — MinGW/WinLibs: ~/tools/mingw64 или в PATH).
pub fn build(app: &AppHandle, dir: &Path) -> Res<(bool, String)> {
    let mut cmd = command(crate::firmware::pio()?);
    cmd.args(["run", "-e", "sitl", "-d"]).arg(dir);
    with_mingw(&mut cmd);
    let (code, tail) = run_streaming(app, "build", cmd)?;
    Ok((code == 0, tail))
}

/// MinGW (~/tools/mingw64/bin) первым в PATH: компилятор для сборки и его DLL
/// (libstdc++-6, libgcc_s_seh-1, libwinpthread-1) для запуска. Прошивка
/// собирает симулятор статически (tools/sitl_link.py), но exe из копий
/// исходников до этого без DLL не стартует: Studio из меню «Пуск» MinGW в
/// PATH не видит, и Windows показывает «libstdc++-6.dll was not found».
fn with_mingw(cmd: &mut std::process::Command) {
    let mingw = home().join("tools").join("mingw64").join("bin");
    if !mingw.is_dir() {
        return;
    }
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut parts = vec![mingw];
    parts.extend(std::env::split_paths(&path));
    if let Ok(joined) = std::env::join_paths(parts) {
        cmd.env("PATH", joined);
    }
}
