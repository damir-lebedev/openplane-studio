//! Исходники прошивки с GitHub без git: список выпусков и снимок только тех
//! файлов, из которых прошивка собирается (include, src, lib, tools, *.ini,
//! *.csv), — около мегабайта вместо архива всего репозитория с моделями
//! планера. Качает curl, который есть и в Windows 10+, и в macOS.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::util::{command, err, run_capture, system_tool, Res};

pub const REPO: &str = "damir-lebedev/OpenPlaneProject";
/// Что прошивке нужно из репозитория.
const NEEDED_DIRS: &[&str] = &["include", "src", "lib", "tools"];
const NEEDED_ROOT_EXT: &[&str] = &[".ini", ".csv"];
/// Метка снимка в папке исходников: откуда он и какой коммит.
pub const MARKER: &str = ".openplane-source.json";

fn curl() -> std::process::Command {
    let mut cmd = command(system_tool("curl"));
    cmd.args(["-fsSL", "--retry", "3", "--connect-timeout", "30", "-H", "User-Agent: OpenPlane-Studio"]);
    cmd
}

/// GET и тело ответа текстом.
pub fn http_get(url: &str) -> Res<String> {
    let mut cmd = curl();
    cmd.arg(url);
    let out = run_capture(cmd, None).map_err(|e| format!("curl: {e}"))?;
    if out.code != 0 {
        return Err(format!("нет ответа от {url}: {}", out.stderr.trim()));
    }
    Ok(out.stdout)
}

/// Скачать файл (папки создаются).
pub fn download(url: &str, dest: &Path) -> Res<()> {
    if let Some(dir) = dest.parent() {
        fs::create_dir_all(dir).map_err(err("папка загрузки"))?;
    }
    let mut cmd = curl();
    cmd.arg("-o").arg(dest).arg(url);
    let out = run_capture(cmd, None).map_err(|e| format!("curl: {e}"))?;
    if out.code != 0 {
        return Err(format!("не скачалось {url}: {}", out.stderr.trim()));
    }
    Ok(())
}

fn api(path: &str) -> Res<Value> {
    let text = http_get(&format!("https://api.github.com/repos/{REPO}/{path}"))?;
    serde_json::from_str(&text).map_err(err("ответ GitHub"))
}

fn version_key(tag: &str) -> Vec<u64> {
    tag.trim_start_matches('v').split(|c: char| !c.is_ascii_digit()).filter_map(|p| p.parse().ok()).collect()
}

/// Выпуски прошивки — теги vX.Y.Z, новые первыми.
pub fn versions() -> Res<Vec<String>> {
    let list = api("tags?per_page=100")?;
    let mut tags: Vec<String> = list
        .as_array()
        .ok_or("GitHub: не список тегов")?
        .iter()
        .filter_map(|t| t["name"].as_str())
        .filter(|t| t.starts_with('v'))
        .map(str::to_string)
        .collect();
    tags.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
    Ok(tags)
}

/// Коммит снимка в папке, если она скачана этим модулем.
pub fn marker_commit(dir: &Path) -> Option<String> {
    let text = fs::read_to_string(dir.join(MARKER)).ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    v["commit"].as_str().map(str::to_string)
}

fn needed(path: &str) -> bool {
    match path.split_once('/') {
        Some((top, _)) => NEEDED_DIRS.contains(&top),
        None => NEEDED_ROOT_EXT.iter().any(|ext| path.ends_with(ext)),
    }
}

/// Пробелы и прочее в пути — в %XX для URL.
fn url_path(path: &str) -> String {
    path.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Снимок исходников в `root/OpenPlaneProject`: выпуск (тег), а без него —
/// последний выпуск или ветка main. Уже скачанный тот же коммит не качается
/// заново. Возвращает папку исходников.
pub fn fetch(root: &Path, version: Option<&str>, log: &dyn Fn(&str)) -> Res<PathBuf> {
    let reference = match version {
        Some(v) if !v.is_empty() => v.to_string(),
        _ => versions().ok().and_then(|v| v.into_iter().next()).unwrap_or_else(|| "main".into()),
    };
    let commit = api(&format!("commits/{reference}"))?["sha"]
        .as_str()
        .ok_or_else(|| format!("GitHub: нет коммита для {reference}"))?
        .to_string();
    let dest = root.join("OpenPlaneProject");
    if marker_commit(&dest).as_deref() == Some(commit.as_str()) && dest.join("tools").join("opconfig.py").is_file() {
        log(&format!("Исходники прошивки уже скачаны ({reference}, {})", &commit[..7]));
        return Ok(dest);
    }

    let tree = api(&format!("git/trees/{commit}?recursive=1"))?;
    let files: Vec<(String, u64)> = tree["tree"]
        .as_array()
        .ok_or("GitHub: нет списка файлов")?
        .iter()
        .filter(|e| e["type"] == "blob")
        .filter_map(|e| Some((e["path"].as_str()?.to_string(), e["size"].as_u64().unwrap_or(0))))
        .filter(|(p, _)| needed(p))
        .collect();
    if !files.iter().any(|(p, _)| p == "tools/opconfig.py") {
        return Err("эта версия прошивки старая — без tools/opconfig.py, приложение с ней не работает".into());
    }
    let total: u64 = files.iter().map(|(_, s)| s).sum();
    log(&format!("Скачиваю исходники прошивки {reference} ({}): {} файлов, {} КБ", &commit[..7], files.len(), total / 1024));

    // Все файлы — одним curl, параллельно: список адресов в файле настроек.
    let tmp = root.join(format!(".download-{}", &commit[..12]));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(err("папка загрузки"))?;
    let mut config = String::new();
    for (path, _) in &files {
        let out = tmp.join(path).to_string_lossy().replace('\\', "/");
        config.push_str(&format!(
            "url = \"https://raw.githubusercontent.com/{REPO}/{commit}/{}\"\noutput = \"{}\"\n",
            url_path(path),
            out.replace('"', "\\\"")
        ));
    }
    let list = root.join(".download-list.txt");
    fs::write(&list, config).map_err(err("список загрузки"))?;
    let mut cmd = curl();
    cmd.args(["--parallel", "--parallel-max", "8", "--create-dirs", "-K"]).arg(&list);
    let out = run_capture(cmd, None).map_err(|e| format!("curl: {e}"))?;
    let _ = fs::remove_file(&list);
    if out.code != 0 {
        let _ = fs::remove_dir_all(&tmp);
        return Err(format!("исходники не скачались: {}", out.stderr.trim()));
    }
    for (path, size) in &files {
        let got = fs::metadata(tmp.join(path)).map(|m| m.len()).unwrap_or(u64::MAX);
        if got != *size {
            let _ = fs::remove_dir_all(&tmp);
            return Err(format!("файл {path} скачался не целиком — повторите"));
        }
    }

    // Прежний снимок (или старая git-копия) — заменить целиком.
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("не удалить прежние исходники {}: {e} — закройте программы, открывшие эту папку", dest.display()))?;
    }
    fs::rename(&tmp, &dest).map_err(err("папка исходников"))?;
    let marker = serde_json::json!({ "repo": REPO, "ref": reference, "commit": commit });
    fs::write(dest.join(MARKER), serde_json::to_string_pretty(&marker).unwrap_or_default()).map_err(err("метка исходников"))?;
    log(&format!("Исходники прошивки: {}", dest.display()));
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_what_the_firmware_is_built_from() {
        assert!(needed("include/config/Config.h"));
        assert!(needed("tools/opconfig.py"));
        assert!(needed("platformio.ini"));
        assert!(needed("partitions_blackbox.csv"));
        assert!(!needed("airframe/stl/AC v3.3 (Wing mount & gears stronger).stl"));
        assert!(!needed("docs/PILOT_GUIDE.md"));
        assert!(!needed("README.md"));
        assert!(!needed("test/native/test_rc/test_main.cpp"));
    }

    #[test]
    fn url_paths_are_escaped() {
        assert_eq!(url_path("include/a b+c.h"), "include/a%20b%2Bc.h");
        assert_eq!(version_key("v1.10.2"), vec![1, 10, 2]);
    }
}
