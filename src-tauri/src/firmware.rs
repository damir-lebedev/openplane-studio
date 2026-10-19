//! Прошивка как исходники: описание (opconfig describe), копия для сборки,
//! запись конфигурации (opconfig apply), сборка и заливка через PlatformIO.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::util::{cache_dir, command, err, find_pio, find_python, run_capture, run_streaming, Res};

/// Что копировать из репозитория прошивки: только то, из чего она собирается.
const COPY_DIRS: &[&str] = &["include", "src", "lib"];
const COPY_ROOT_EXT: &[&str] = &["ini", "csv"];
/// Файлы, которые пишет приложение, — их нет в исходниках, синхронизация их не удаляет.
const GENERATED: &[&str] = &["include/config/Project.h"];

fn opconfig(source: &Path) -> Res<PathBuf> {
    let script = source.join("tools").join("opconfig.py");
    if script.is_file() {
        Ok(script)
    } else {
        Err(format!(
            "в {} нет tools/opconfig.py — это не исходники OpenPlane или они старые",
            source.display()
        ))
    }
}

fn python() -> Res<PathBuf> {
    find_python().ok_or_else(|| "не найден Python (ставится вместе с PlatformIO)".to_string())
}

pub fn pio() -> Res<PathBuf> {
    find_pio().ok_or_else(|| "не найден PlatformIO (pio)".to_string())
}

/// Всё о прошивке одним JSON — tools/opconfig.py describe.
pub fn describe(source: &Path) -> Res<Value> {
    let mut cmd = command(python()?);
    cmd.arg(opconfig(source)?).arg("describe").arg("--root").arg(source);
    let out = run_capture(cmd, None)?;
    if out.code != 0 {
        return Err(format!("opconfig describe: {}{}", out.stderr.trim(), out.stdout.trim()));
    }
    serde_json::from_str(&out.stdout).map_err(err("opconfig describe: не JSON"))
}

/// Записать конфигурацию в копию исходников — tools/opconfig.py apply.
/// Ошибки конфигурации — {"ok": false, "errors": [...]}, не Err.
pub fn apply(source: &Path, root: &Path, config: &Value) -> Res<Value> {
    let mut cmd = command(python()?);
    cmd.arg(opconfig(source)?).args(["apply", "--config", "-", "--root"]).arg(root);
    let out = run_capture(cmd, Some(&config.to_string()))?;
    match serde_json::from_str::<Value>(out.stdout.trim()) {
        Ok(v) => Ok(v),
        Err(_) => Err(format!("opconfig apply (код {}): {}{}", out.code, out.stderr.trim(), out.stdout.trim())),
    }
}

/// Выпуски прошивки на GitHub — теги vX.Y.Z, новые первыми.
pub fn versions() -> Res<Vec<String>> {
    crate::source::versions()
}

/// Исходники с GitHub в папку приложения: выпуск (тег) или ветка main —
/// только файлы, из которых собирается прошивка. Возвращает путь к исходникам.
pub fn fetch_github(app: &AppHandle, version: Option<&str>) -> Res<String> {
    let root = cache_dir(app)?.join("source");
    fs::create_dir_all(&root).map_err(err("папка исходников"))?;
    crate::source::fetch(&root, version, &|_| {}).map(|p| p.to_string_lossy().into_owned())
}

/// git-коммит исходников; "-dirty" — есть незакоммиченные правки в том, из
/// чего собирается прошивка (модели планера, документация и т. п. не в счёт).
/// Снимок, скачанный приложением, — коммит из его метки.
pub fn source_commit(source: &Path) -> Option<String> {
    let mut cmd = command("git");
    cmd.arg("-C").arg(source).args(["rev-parse", "--short", "HEAD"]);
    let head = match run_capture(cmd, None).ok().filter(|o| o.code == 0) {
        Some(out) => out.stdout.trim().to_string(),
        None => return crate::source::marker_commit(source).map(|c| c.chars().take(7).collect()),
    };
    let mut cmd = command("git");
    cmd.arg("-C").arg(source).args(["status", "--porcelain", "--untracked-files=no", "--"]);
    cmd.args(COPY_DIRS).args(["*.ini", "*.csv"]);
    let dirty = run_capture(cmd, None).map(|o| !o.stdout.trim().is_empty()).unwrap_or(false);
    Some(if dirty { format!("{head}-dirty") } else { head })
}

fn same_content(a: &Path, b: &Path) -> bool {
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(ma), Ok(mb)) if ma.len() == mb.len() => fs::read(a).ok() == fs::read(b).ok(),
        _ => false,
    }
}

fn collect(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) -> Res<()> {
    for entry in fs::read_dir(dir).map_err(err("чтение папки"))? {
        let entry = entry.map_err(err("чтение папки"))?;
        let path = entry.path();
        if path.is_dir() {
            collect(&path, base, out)?;
        } else {
            out.push(path.strip_prefix(base).unwrap().to_path_buf());
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Prepared {
    pub dir: String,
    pub copied: usize,
    pub removed: usize,
}

/// Копия исходников для сборки этого самолёта: копируется только то, что
/// изменилось, — PlatformIO не пересобирает лишнего (.pio остаётся).
pub fn prepare(app: &AppHandle, source: &Path, plane_id: &str) -> Res<Prepared> {
    if plane_id.is_empty() || !plane_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("неверный id самолёта".into());
    }
    let dest = cache_dir(app)?.join("builds").join(plane_id);
    fs::create_dir_all(&dest).map_err(err("папка сборки"))?;

    let mut wanted: Vec<PathBuf> = Vec::new();
    for d in COPY_DIRS {
        let dir = source.join(d);
        if dir.is_dir() {
            collect(&dir, source, &mut wanted)?;
        }
    }
    for entry in fs::read_dir(source).map_err(err("исходники"))? {
        let path = entry.map_err(err("исходники"))?.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if path.is_file() && COPY_ROOT_EXT.contains(&ext) {
            wanted.push(path.strip_prefix(source).unwrap().to_path_buf());
        }
    }

    let mut copied = 0;
    for rel in &wanted {
        let from = source.join(rel);
        let to = dest.join(rel);
        if !same_content(&from, &to) {
            if let Some(parent) = to.parent() {
                fs::create_dir_all(parent).map_err(err("папка сборки"))?;
            }
            fs::copy(&from, &to).map_err(err("копирование исходников"))?;
            copied += 1;
        }
    }

    // Лишнее (удалённое из исходников) — убрать, кроме .pio и файлов приложения.
    let mut existing = Vec::new();
    for d in COPY_DIRS {
        let dir = dest.join(d);
        if dir.is_dir() {
            collect(&dir, &dest, &mut existing)?;
        }
    }
    let mut removed = 0;
    for rel in existing {
        let generated = GENERATED.iter().any(|g| Path::new(g) == rel);
        if !generated && !wanted.contains(&rel) {
            let _ = fs::remove_file(dest.join(&rel));
            removed += 1;
        }
    }
    Ok(Prepared { dir: dest.to_string_lossy().into_owned(), copied, removed })
}

#[derive(Serialize)]
pub struct TaskResult {
    pub ok: bool,
    pub code: i32,
    pub tail: String,
    pub firmware: Option<String>,
}

fn firmware_file(dir: &Path, env: &str) -> Option<String> {
    let build = dir.join(".pio").join("build").join(env);
    ["firmware.bin", "firmware.hex", "firmware.elf"]
        .iter()
        .map(|f| build.join(f))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

pub fn build(app: &AppHandle, dir: &Path, env: &str) -> Res<TaskResult> {
    let mut cmd = command(pio()?);
    cmd.args(["run", "-e", env, "-d"]).arg(dir);
    let (code, tail) = run_streaming(app, "build", cmd)?;
    Ok(TaskResult { ok: code == 0, code, tail, firmware: firmware_file(dir, env) })
}

pub fn upload(app: &AppHandle, dir: &Path, env: &str, port: Option<&str>) -> Res<TaskResult> {
    let mut cmd = command(pio()?);
    cmd.args(["run", "-e", env, "-t", "nobuild", "-t", "upload", "-d"]).arg(dir);
    if let Some(port) = port {
        cmd.args(["--upload-port", port]);
    }
    let (code, tail) = run_streaming(app, "upload", cmd)?;
    Ok(TaskResult { ok: code == 0, code, tail, firmware: firmware_file(dir, env) })
}
