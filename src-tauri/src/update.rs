//! Обновление приложения: при запуске (или по кнопке) — последний выпуск на
//! GitHub, установщик этой системы скачивается с проверкой SHA-256 из ответа
//! GitHub и ставится тем же установщиком NSIS в тихом режиме (`/P /UPDATE /R`
//! — окно с полосой, папка и ярлыки прежние, после установки приложение
//! запускается само). На macOS — открывается .dmg: перетащить в «Программы».
//! Качает curl, как и исходники прошивки (source.rs).

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::source::http_get;
use crate::util::{cache_dir, command, err, system_tool, Res};

pub const REPO: &str = "damir-lebedev/openplane-studio";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct UpdateInfo {
    /// версия выпуска без «v»
    pub version: String,
    pub current: String,
    /// выпуск новее этой версии
    pub newer: bool,
    /// «что нового» — текст выпуска (markdown)
    pub notes: String,
    pub page: String,
    pub published: String,
    /// установщик этой системы; нет — только страница выпуска
    pub asset: Option<Asset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Asset {
    pub name: String,
    pub url: String,
    pub size: u64,
    /// SHA-256 из ответа GitHub (поле digest), шестнадцатеричный, строчными
    pub sha256: Option<String>,
}

/// Имя установщика этой системы в выпуске (постоянные имена — installers.yml).
pub fn asset_name(os: &str, arch: &str) -> Option<&'static str> {
    match (os, arch) {
        ("windows", _) => Some("OpenPlane-Studio-Windows-Setup.exe"),
        ("macos", "aarch64") => Some("OpenPlane-Studio-macOS-AppleSilicon.dmg"),
        ("macos", _) => Some("OpenPlane-Studio-macOS-Intel.dmg"),
        _ => None,
    }
}

fn version_key(v: &str) -> Vec<u64> {
    // «1.2.0-rc1» — без хвоста: выпуск-кандидат сравнивается как сам выпуск
    let core = v.trim().trim_start_matches('v').split(['-', '+']).next().unwrap_or("");
    core.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// a новее b (1.10.0 новее 1.9.3; недостающие части — нули).
pub fn newer(a: &str, b: &str) -> bool {
    let (mut x, mut y) = (version_key(a), version_key(b));
    let n = x.len().max(y.len());
    x.resize(n, 0);
    y.resize(n, 0);
    x > y
}

/// Ответ `releases/latest` → что предложить.
pub fn parse_release(release: &Value, current: &str, os: &str, arch: &str) -> Res<UpdateInfo> {
    let tag = release["tag_name"].as_str().ok_or("в ответе GitHub нет версии выпуска")?;
    let version = tag.trim_start_matches('v').to_string();
    let want = asset_name(os, arch);
    let asset = release["assets"].as_array().into_iter().flatten().find(|a| Some(a["name"].as_str().unwrap_or("")) == want).map(|a| Asset {
        name: a["name"].as_str().unwrap_or("").into(),
        url: a["browser_download_url"].as_str().unwrap_or("").into(),
        size: a["size"].as_u64().unwrap_or(0),
        sha256: a["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).map(|h| h.to_ascii_lowercase()),
    });
    Ok(UpdateInfo {
        newer: newer(&version, current),
        version,
        current: current.into(),
        notes: release["body"].as_str().unwrap_or("").trim().into(),
        page: release["html_url"].as_str().unwrap_or("").into(),
        published: release["published_at"].as_str().unwrap_or("").into(),
        asset,
    })
}

pub fn check() -> Res<UpdateInfo> {
    let text = http_get(&format!("https://api.github.com/repos/{REPO}/releases/latest"))?;
    let release: Value = serde_json::from_str(&text).map_err(err("ответ GitHub"))?;
    parse_release(&release, env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH)
}

#[derive(Clone, Serialize)]
struct Progress {
    done: u64,
    total: u64,
}

pub fn sha256_file(path: &Path) -> Res<String> {
    let mut f = fs::File::open(path).map_err(err("файл обновления"))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = f.read(&mut buf).map_err(err("файл обновления"))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Скачать установщик (с докачкой оборванного) в папку данных приложения;
/// ход — событием "update-progress". Готовый и проверенный — не качается заново.
pub fn download(app: &AppHandle, asset: &Asset) -> Res<String> {
    if asset.name.is_empty() || asset.name.contains(['/', '\\']) || !asset.url.starts_with("https://github.com/") {
        return Err(format!("странный файл обновления: {}", asset.name));
    }
    let dir = cache_dir(app)?.join("updates");
    fs::create_dir_all(&dir).map_err(err("папка обновлений"))?;
    let dest = dir.join(&asset.name);
    let verified = |p: &Path| match &asset.sha256 {
        Some(want) => sha256_file(p).map(|got| &got == want),
        None => Ok(fs::metadata(p).map(|m| m.len() == asset.size).unwrap_or(false)),
    };
    if dest.is_file() && verified(&dest)? {
        let _ = app.emit("update-progress", Progress { done: asset.size, total: asset.size });
        return Ok(dest.to_string_lossy().into_owned());
    }
    let part = dir.join(format!("{}.part", asset.name));
    let mut cmd = command(system_tool("curl"));
    cmd.args(["-fsSL", "--retry", "3", "--connect-timeout", "30", "-H", "User-Agent: OpenPlane-Studio", "-C", "-", "-o"])
        .arg(&part)
        .arg(&asset.url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(err("curl"))?;
    let status = loop {
        if let Some(st) = child.try_wait().map_err(err("curl"))? {
            break st;
        }
        let done = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        let _ = app.emit("update-progress", Progress { done, total: asset.size });
        std::thread::sleep(Duration::from_millis(400));
    };
    if !status.success() {
        let mut text = String::new();
        if let Some(mut e) = child.stderr.take() {
            let _ = e.read_to_string(&mut text);
        }
        // докачка не удалась (файл на сервере сменился) — в другой раз с нуля
        if status.code() == Some(33) || text.contains("416") {
            let _ = fs::remove_file(&part);
        }
        return Err(format!("обновление не скачалось: {}", text.trim()));
    }
    if !verified(&part)? {
        let _ = fs::remove_file(&part);
        return Err("скачанный файл не совпал с выпуском (SHA-256) — удалён, попробуйте ещё раз".into());
    }
    let _ = fs::remove_file(&dest);
    fs::rename(&part, &dest).map_err(err("файл обновления"))?;
    let _ = app.emit("update-progress", Progress { done: asset.size, total: asset.size });
    Ok(dest.to_string_lossy().into_owned())
}

/// Запустить установку. Windows — установщик в тихом режиме, а приложение
/// закрывается (true); macOS — открыть .dmg (false: приложение остаётся).
pub fn install(app: &AppHandle, path: &str) -> Res<bool> {
    let path = PathBuf::from(path);
    let dir = cache_dir(app)?.join("updates");
    if !path.starts_with(&dir) || !path.is_file() {
        return Err("файла обновления нет — скачайте ещё раз".into());
    }
    if cfg!(windows) {
        // Не command(): установщику нужно своё окно с полосой.
        std::process::Command::new(&path).args(["/P", "/UPDATE", "/R"]).spawn().map_err(err("установщик"))?;
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(600));
            app.exit(0);
        });
        Ok(true)
    } else {
        std::process::Command::new("open").arg(&path).spawn().map_err(err("open"))?;
        Ok(false)
    }
}

/// Старые установщики из папки обновлений: остаётся только нужный сейчас.
pub fn cleanup(app: &AppHandle, keep: Option<&str>) -> Res<()> {
    let dir = cache_dir(app)?.join("updates");
    let Ok(list) = fs::read_dir(&dir) else { return Ok(()) };
    for e in list.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if keep.is_some_and(|k| name == k || name == format!("{k}.part")) {
            continue;
        }
        let _ = fs::remove_file(e.path());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn versions_compare_by_numbers() {
        assert!(newer("0.3.0", "0.2.0"));
        assert!(newer("v1.10.0", "1.9.3"));
        assert!(newer("1.0.1", "1.0"));
        assert!(!newer("0.2.0", "0.2.0"));
        assert!(!newer("0.2.0", "0.10.0"));
        assert!(!newer("0.3.0-rc1", "0.3.0"));
    }

    #[test]
    fn release_picks_installer_of_this_system() {
        let r = json!({
            "tag_name": "v0.3.0",
            "body": " Что нового \n",
            "html_url": "https://github.com/damir-lebedev/openplane-studio/releases/tag/v0.3.0",
            "published_at": "2026-11-03T10:00:00Z",
            "assets": [
                {"name": "OpenPlane-Studio-macOS-Intel.dmg", "browser_download_url": "https://github.com/x/i.dmg", "size": 10},
                {"name": "OpenPlane-Studio-macOS-AppleSilicon.dmg", "browser_download_url": "https://github.com/x/a.dmg", "size": 11},
                {"name": "OpenPlane-Studio-Windows-Setup.exe", "browser_download_url": "https://github.com/x/w.exe", "size": 12, "digest": "sha256:ABCD"}
            ]
        });
        let w = parse_release(&r, "0.2.0", "windows", "x86_64").unwrap();
        assert!(w.newer);
        assert_eq!(w.version, "0.3.0");
        assert_eq!(w.notes, "Что нового");
        let a = w.asset.unwrap();
        assert_eq!((a.url.as_str(), a.size, a.sha256.as_deref()), ("https://github.com/x/w.exe", 12, Some("abcd")));
        assert_eq!(parse_release(&r, "0.2.0", "macos", "aarch64").unwrap().asset.unwrap().size, 11);
        assert_eq!(parse_release(&r, "0.2.0", "macos", "x86_64").unwrap().asset.unwrap().sha256, None);
        assert_eq!(parse_release(&r, "0.2.0", "linux", "x86_64").unwrap().asset, None);
        assert!(!parse_release(&r, "0.3.0", "windows", "x86_64").unwrap().newer);
    }

    #[test]
    fn sha256_of_a_file() {
        let p = std::env::temp_dir().join("opl-update-sha.txt");
        fs::write(&p, b"abc").unwrap();
        assert_eq!(sha256_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = fs::remove_file(p);
    }
}
