//! Настройка с пульта: Lua-скрипты Betaflight (betaflight-tx-lua-scripts,
//! GPL — не входят в приложение, качаются с их GitHub по кнопке) — на
//! SD-карту пульта EdgeTX, подключённого по USB как диск. Прошивка коптера
//! отвечает на их MSP через CRSF (plane: copter/CrsfMsp.h). Свой скрипт
//! OpenPlane (188b: GPS Rescue, учебные ограничения, страницы OSD, экран
//! телеметрии `oplan`) лежит в исходниках прошивки (`tools/edgetx/SCRIPTS`)
//! и копируется оттуда (`install_oplane`), без интернета.
//!
//! «Найти упавший» (P11): журналы телеметрии EdgeTX (`LOGS/*.csv` на SD
//! пульта) — начало и конец свежих файлов; последнюю точку GPS ищет
//! `src/core/findLost.ts`. Карта открывается в браузере (`open_map`).

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

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

/// Журнал EdgeTX: имя, время записи (с UNIX), начало (заголовок) и хвост.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioLog {
    pub name: String,
    pub modified: u64,
    pub size: u64,
    pub head: String,
    pub tail: String,
}

const LOG_HEAD: u64 = 4 * 1024;
const LOG_TAIL: u64 = 512 * 1024;

fn read_range(path: &Path, from: u64, len: u64) -> Res<String> {
    let mut f = fs::File::open(path).map_err(err("журнал пульта"))?;
    f.seek(SeekFrom::Start(from)).map_err(err("журнал пульта"))?;
    let mut buf = Vec::new();
    f.take(len).read_to_end(&mut buf).map_err(err("журнал пульта"))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Свежие журналы телеметрии с карты пульта, новые первыми (не больше `max`).
pub fn read_logs(sd: &str, max: usize) -> Res<Vec<RadioLog>> {
    let root = Path::new(sd);
    let dir = ["LOGS", "logs", "Logs"].iter().map(|d| root.join(d)).find(|d| d.is_dir());
    let Some(dir) = dir else { return Ok(Vec::new()) };
    let mut files: Vec<(u64, u64, PathBuf)> = fs::read_dir(&dir)
        .map_err(err("папка LOGS"))?
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let csv = p.extension().map(|x| x.eq_ignore_ascii_case("csv")).unwrap_or(false);
            let meta = e.metadata().ok()?;
            if !csv || !meta.is_file() || meta.len() == 0 {
                return None;
            }
            let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs();
            Some((modified, meta.len(), p))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files
        .into_iter()
        .take(max)
        .map(|(modified, size, p)| {
            let head = read_range(&p, 0, LOG_HEAD)?;
            let tail = if size > LOG_HEAD { read_range(&p, size.saturating_sub(LOG_TAIL).max(LOG_HEAD), LOG_TAIL)? } else { String::new() };
            let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            Ok(RadioLog { name, modified, size, head, tail })
        })
        .collect()
}

/// Ссылка на карту — только известные сайты карт (точку открывает браузер).
pub fn map_url_allowed(url: &str) -> bool {
    ["https://www.openstreetmap.org/", "https://www.google.com/maps/", "https://yandex.ru/maps/"].iter().any(|p| url.starts_with(p))
        && !url.chars().any(|c| c.is_whitespace() || c == '"' || c == '\'' || c == '`')
}

pub fn open_map(url: &str) -> Res<()> {
    if !map_url_allowed(url) {
        return Err("эту ссылку приложение не открывает".into());
    }
    let mut cmd = if cfg!(windows) {
        let mut c = command("rundll32");
        c.arg("url.dll,FileProtocolHandler");
        c
    } else if cfg!(target_os = "macos") {
        command("open")
    } else {
        command("xdg-open")
    };
    cmd.arg(url);
    cmd.spawn().map_err(err("браузер"))?;
    Ok(())
}

/// Папка своего Lua-скрипта в исходниках прошивки.
pub fn oplane_scripts(source: &Path) -> PathBuf {
    source.join("tools").join("edgetx").join("SCRIPTS")
}

/// Скрипт OpenPlane из исходников `source` — на карту `sd`. Число файлов.
pub fn install_oplane(source: &str, sd: &str) -> Res<usize> {
    let root = Path::new(sd);
    if !is_radio_sd(root) {
        return Err(format!("{sd} не похож на SD-карту пульта (нет папки RADIO)"));
    }
    let scripts = oplane_scripts(Path::new(source));
    if !scripts.join("TOOLS").join("OpenPlane.lua").is_file() {
        return Err(format!(
            "в исходниках {source} нет скрипта пульта (tools/edgetx): обновите их в «Настройках»"
        ));
    }
    copy_tree(&scripts, &root.join("SCRIPTS"))
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

    #[test]
    fn copies_own_script_from_sources() {
        let tmp = std::env::temp_dir().join(format!("op-oplane-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let source = tmp.join("plane");
        let sd = tmp.join("sd");
        fs::create_dir_all(sd.join("RADIO")).unwrap();
        let (src, card) = (source.to_string_lossy().into_owned(), sd.to_string_lossy().into_owned());
        assert!(install_oplane(&src, &card).unwrap_err().contains("tools/edgetx"));   // старые исходники
        let scripts = oplane_scripts(&source);
        for f in ["TOOLS/OpenPlane.lua", "OPLANE/msp.lua", "TELEMETRY/oplan.lua"] {
            let p = scripts.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, "--").unwrap();
        }
        assert_eq!(install_oplane(&src, &card).unwrap(), 3);
        assert!(sd.join("SCRIPTS/TELEMETRY/oplan.lua").is_file());
        assert!(install_oplane(&src, &tmp.to_string_lossy()).is_err());   // не карта пульта
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn reads_newest_logs_head_and_tail() {
        let tmp = std::env::temp_dir().join(format!("op-radio-logs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        assert!(read_logs(tmp.to_str().unwrap(), 3).unwrap().is_empty());   // нет LOGS — пусто
        let logs = tmp.join("LOGS");
        fs::create_dir_all(&logs).unwrap();
        fs::write(logs.join("Quad-2026-11-17.csv"), "Date,Time,GPS\n2026-11-17,10:00:00.000,55.1 37.1\n").unwrap();
        fs::write(logs.join("notes.txt"), "x").unwrap();
        let mut big = String::from("Date,Time,GPS\n");
        while (big.len() as u64) < LOG_TAIL + LOG_HEAD * 2 {
            big.push_str("2026-11-18,10:00:00.000,55.2 37.2\n");
        }
        big.push_str("2026-11-18,10:05:00.000,55.3 37.3\n");
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(logs.join("Quad-2026-11-18.csv"), &big).unwrap();
        let r = read_logs(tmp.to_str().unwrap(), 5).unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].name, "Quad-2026-11-18.csv");
        assert!(r[0].head.starts_with("Date,Time,GPS"));
        assert!(r[0].tail.ends_with("55.3 37.3\n"));
        assert!((r[0].tail.len() as u64) <= LOG_TAIL);
        assert!(r[1].tail.is_empty() && r[1].head.contains("55.1 37.1"));
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn only_map_links_open() {
        assert!(map_url_allowed("https://www.openstreetmap.org/?mlat=55.75&mlon=37.61#map=18/55.75/37.61"));
        assert!(map_url_allowed("https://www.google.com/maps/search/?api=1&query=55.75,37.61"));
        assert!(!map_url_allowed("https://evil.example/maps"));
        assert!(!map_url_allowed("file:///C:/Windows"));
        assert!(!map_url_allowed("https://www.google.com/maps/ \" & calc"));
    }
}
