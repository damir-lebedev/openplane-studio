//! Пути, поиск программ и запуск процессов без консольного окна.

use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub type Res<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(context: &str) -> impl FnOnce(E) -> String + '_ {
    move |e| format!("{context}: {e}")
}

pub fn home() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Программа в PATH (с учётом .exe на Windows).
pub fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe(name)))
        .find(|p| p.is_file())
}

/// Папка penv PlatformIO: там pio и Python, которым PlatformIO работает сам.
pub fn penv_scripts() -> PathBuf {
    let base = home().join(".platformio").join("penv");
    if cfg!(windows) {
        base.join("Scripts")
    } else {
        base.join("bin")
    }
}

pub fn find_pio() -> Option<PathBuf> {
    ["pio", "platformio"]
        .iter()
        .map(|n| penv_scripts().join(exe(n)))
        .find(|p| p.is_file())
        .or_else(|| which("pio"))
        .or_else(|| which("platformio"))
}

pub fn find_python() -> Option<PathBuf> {
    let penv = penv_scripts().join(exe("python"));
    if penv.is_file() {
        return Some(penv);
    }
    which("python").or_else(|| which("python3"))
}

pub fn hangar_dir(app: &AppHandle) -> Res<PathBuf> {
    let docs = app.path().document_dir().map_err(err("папка «Документы»"))?;
    Ok(docs.join("OpenPlane").join("Hangar"))
}

pub fn cache_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().app_local_data_dir().map_err(err("папка данных приложения"))
}

pub fn config_dir(app: &AppHandle) -> Res<PathBuf> {
    app.path().app_config_dir().map_err(err("папка настроек приложения"))
}

/// Команда без мигающего консольного окна и с UTF-8 у Python.
pub fn command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1");
    c
}

pub struct Output {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Запустить и дождаться; stdin — текст (или ничего).
pub fn run_capture(mut cmd: Command, stdin: Option<&str>) -> Res<Output> {
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(err("не запускается"))?;
    if let (Some(text), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(text.as_bytes()).map_err(err("stdin"))?;
    }
    let out = child.wait_with_output().map_err(err("процесс"))?;
    Ok(Output {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
    })
}

#[derive(Clone, Serialize)]
pub struct LogLine<'a> {
    pub task: &'a str,
    pub stream: &'a str,
    pub line: String,
}

/// Читать поток по строкам: и '\n', и '\r' (прогресс dfu-util и esptool
/// перерисовывает строку через '\r').
fn pump<R: Read + Send + 'static>(app: AppHandle, task: String, stream: &'static str, mut reader: R) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut tail = String::new();
        let mut buf = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();
        let flush = |line: &mut Vec<u8>, tail: &mut String| {
            if line.is_empty() {
                return;
            }
            let text = String::from_utf8_lossy(line).trim_end().to_string();
            line.clear();
            if text.is_empty() {
                return;
            }
            let _ = app.emit("task-log", LogLine { task: &task, stream, line: text.clone() });
            tail.push_str(&text);
            tail.push('\n');
            if tail.len() > 64 * 1024 {
                let cut = tail.len() - 32 * 1024;
                let cut = (cut..tail.len()).find(|&i| tail.is_char_boundary(i)).unwrap_or(cut);
                tail.drain(..cut);
            }
        };
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    for &b in &buf[..n] {
                        if b == b'\n' || b == b'\r' {
                            flush(&mut line, &mut tail);
                        } else {
                            line.push(b);
                        }
                    }
                }
            }
        }
        flush(&mut line, &mut tail);
        tail
    })
}

/// Запустить, каждую строку вывода отдать окну событием "task-log".
/// Возвращает код выхода и хвост вывода (для разбора ошибок).
pub fn run_streaming(app: &AppHandle, task: &str, mut cmd: Command) -> Res<(i32, String)> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(err("не запускается"))?;
    let out = pump(app.clone(), task.to_string(), "out", child.stdout.take().expect("stdout"));
    let errs = pump(app.clone(), task.to_string(), "err", child.stderr.take().expect("stderr"));
    let status = child.wait().map_err(err("процесс"))?;
    let mut tail = out.join().unwrap_or_default();
    tail.push_str(&errs.join().unwrap_or_default());
    Ok((status.code().unwrap_or(-1), tail))
}

pub fn write_atomic(path: &Path, text: &str) -> Res<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(err("создать папку"))?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(err("запись"))?;
    std::fs::rename(&tmp, path).map_err(err("запись"))
}
