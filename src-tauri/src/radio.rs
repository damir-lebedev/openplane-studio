//! Настройка с пульта: Lua-скрипты Betaflight (betaflight-tx-lua-scripts,
//! GPL — не входят в приложение, качаются с их GitHub по кнопке) — на
//! SD-карту пульта EdgeTX, подключённого по USB как диск. Прошивка коптера
//! отвечает на их MSP через CRSF (plane: copter/CrsfMsp.h).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use tauri::AppHandle;

use crate::source::{download, http_get};
use crate::util::{cache_dir, command, err, run_capture, system_tool, Res};

pub const LUA_REPO: &str = "betaflight/betaflight-tx-lua-scripts";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LuaRelease {
    pub version: String,
    pub url: String,
}

/// Архив из ответа GitHub releases/latest: .zip-вложение, иначе архив исходников.
pub fn lua_release(release: &Value) -> Res<LuaRelease> {
    let version = release["tag_name"].as_str().unwrap_or("").to_string();
    if version.is_empty() {
        return Err("у betaflight-tx-lua-scripts нет выпусков".into());
    }
    let asset = release["assets"].as_array().and_then(|list| {
        list.iter().find_map(|a| {
            let name = a["name"].as_str()?;
            if name.to_lowercase().ends_with(".zip") {
                a["browser_download_url"].as_str()
            } else {
                None
            }
        })
    });
    let url = asset.or_else(|| release["zipball_url"].as_str()).ok_or("в выпуске нет архива")?;
    Ok(LuaRelease { version, url: url.to_string() })
}

/// Похоже на SD-карту EdgeTX/OpenTX: папка RADIO или файл версии карты.
pub fn is_radio_sd(root: &Path) -> bool {
    root.join("RADIO").is_dir() || root.join("edgetx.sdcard.version").is_file()
}

/// Подключённые диски, похожие на SD пульта (пульт — в режиме «USB-накопитель»).
pub fn find_radio_sd() -> Vec<String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for letter in b'D'..=b'Z' {
            roots.push(PathBuf::from(format!("{}:\\", letter as char)));
        }
    } else {
        let user = std::env::var("USER").unwrap_or_default();
        for base in ["/Volumes".to_string(), format!("/media/{user}"), format!("/run/media/{user}")] {
            if let Ok(dir) = fs::read_dir(base) {
                roots.extend(dir.flatten().map(|e| e.path()));
            }
        }
    }
    roots.into_iter().filter(|r| is_radio_sd(r)).map(|r| r.to_string_lossy().into_owned()).collect()
}

/// Папка SCRIPTS в распакованном архиве (на любой глубине — у архива исходников она в src/).
pub fn find_scripts(dir: &Path, depth: u8) -> Option<PathBuf> {
    let direct = dir.join("SCRIPTS");
    if direct.join("TOOLS").is_dir() || direct.join("BF").is_dir() {
        return Some(direct);
    }
    if depth == 0 {
        return None;
    }
    let mut subdirs: Vec<PathBuf> = fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    subdirs.sort();
    subdirs.iter().find_map(|d| find_scripts(d, depth - 1))
}

/// Скопировать папку поверх (свои файлы на карте остаются). Число файлов.
pub fn copy_tree(from: &Path, to: &Path) -> Res<usize> {
    fs::create_dir_all(to).map_err(err("папка на карте"))?;
    let mut n = 0;
    for entry in fs::read_dir(from).map_err(err("архив скриптов"))?.flatten() {
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            n += copy_tree(&src, &dst)?;
        } else {
            fs::copy(&src, &dst).map_err(err("запись на карту"))?;
            n += 1;
        }
    }
    Ok(n)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LuaInstalled {
    pub version: String,
    pub files: usize,
}

/// Скачать последний выпуск и положить SCRIPTS на карту `sd`.
pub fn install_lua(app: &AppHandle, sd: &str) -> Res<LuaInstalled> {
    let root = Path::new(sd);
    if !is_radio_sd(root) {
        return Err(format!("{sd} не похож на SD-карту пульта (нет папки RADIO)"));
    }
    let text = http_get(&format!("https://api.github.com/repos/{LUA_REPO}/releases/latest"))?;
    let release: Value = serde_json::from_str(&text).map_err(err("ответ GitHub"))?;
    let rel = lua_release(&release)?;
    let work = cache_dir(app)?.join("bf-lua");
    let _ = fs::remove_dir_all(&work);
    let archive = work.join("lua.zip");
    download(&rel.url, &archive)?;
    let unpack = work.join("unpack");
    fs::create_dir_all(&unpack).map_err(err("папка загрузки"))?;
    let mut cmd = command(system_tool("tar"));   // tar Windows 10+ и macOS понимает zip
    cmd.arg("-xf").arg(&archive).arg("-C").arg(&unpack);
    let out = run_capture(cmd, None)?;
    if out.code != 0 {
        return Err(format!("архив скриптов не распаковался: {}", out.stderr.trim()));
    }
    let scripts = find_scripts(&unpack, 3).ok_or("в архиве нет папки SCRIPTS")?;
    let files = copy_tree(&scripts, &root.join("SCRIPTS"))?;
    let _ = fs::remove_dir_all(&work);
    Ok(LuaInstalled { version: rel.version, files })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn release_prefers_zip_asset() {
        let r = json!({ "tag_name": "2.2.0", "zipball_url": "https://z", "assets": [
            { "name": "notes.txt", "browser_download_url": "https://t" },
            { "name": "betaflight-tx-lua-scripts_2.2.0.zip", "browser_download_url": "https://a" } ] });
        assert_eq!(lua_release(&r).unwrap(), LuaRelease { version: "2.2.0".into(), url: "https://a".into() });
        let r = json!({ "tag_name": "2.1.0", "zipball_url": "https://z", "assets": [] });
        assert_eq!(lua_release(&r).unwrap().url, "https://z");
        assert!(lua_release(&json!({})).is_err());
    }

    #[test]
    fn finds_scripts_and_copies_over() {
        let tmp = std::env::temp_dir().join(format!("op-radio-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let src = tmp.join("unpack/repo-abc/src/SCRIPTS");
        fs::create_dir_all(src.join("TOOLS")).unwrap();
        fs::create_dir_all(src.join("BF/PAGES")).unwrap();
        fs::write(src.join("TOOLS/bf.lua"), "x").unwrap();
        fs::write(src.join("BF/PAGES/pids.lua"), "y").unwrap();
        assert_eq!(find_scripts(&tmp.join("unpack"), 3), Some(src.clone()));
        assert_eq!(find_scripts(&tmp.join("unpack"), 1), None);

        let sd = tmp.join("sd");
        assert!(!is_radio_sd(&sd));
        fs::create_dir_all(sd.join("RADIO")).unwrap();
        fs::create_dir_all(sd.join("SCRIPTS/TOOLS")).unwrap();
        fs::write(sd.join("SCRIPTS/TOOLS/ExpressLRS.lua"), "elrs").unwrap();
        assert!(is_radio_sd(&sd));
        assert_eq!(copy_tree(&src, &sd.join("SCRIPTS")).unwrap(), 2);
        assert!(sd.join("SCRIPTS/TOOLS/bf.lua").is_file());
        assert!(sd.join("SCRIPTS/TOOLS/ExpressLRS.lua").is_file());   // своё на карте не трогаем
        let _ = fs::remove_dir_all(&tmp);
    }
}
