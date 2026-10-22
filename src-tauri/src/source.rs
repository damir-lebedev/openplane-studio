//! Исходники прошивки с GitHub без git: список выпусков и снимок только тех
//! файлов, из которых прошивка собирается (include, src, lib, tools, *.ini,
//! *.csv), — около мегабайта вместо архива всего репозитория с моделями
//! планера. Качает curl, который есть и в Windows 10+, и в macOS.
//!
//! API GitHub бывает недоступен (сбой, 60 запросов в час на адрес): тогда
//! коммит берётся из ссылок git по HTTPS (без API и его лимита), а файлы —
//! архивом коммита целиком (дольше, лишнее не распаковывается).

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

/// Ссылки репозитория (имя → коммит) — как `git ls-remote`, по HTTPS без API.
/// У аннотированного тега берётся коммит (`^{}`), а не сам объект тега.
fn git_refs() -> Res<Vec<(String, String)>> {
    let text = http_get(&format!("https://github.com/{REPO}.git/info/refs?service=git-upload-pack"))?;
    Ok(parse_refs(&text))
}

fn parse_refs(text: &str) -> Vec<(String, String)> {
    let mut refs: Vec<(String, String)> = Vec::new();
    for line in text.split('\n') {
        let Some((head, rest)) = line.split_once(' ') else { continue };
        if head.len() < 40 {
            continue;
        }
        let sha = &head[head.len() - 40..];
        if !sha.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }
        let name = rest.split('\0').next().unwrap_or("").trim();
        if let Some(tag) = name.strip_suffix("^{}") {
            refs.retain(|(n, _)| n != tag);
            refs.push((tag.to_string(), sha.to_string()));
        } else if !refs.iter().any(|(n, _)| n == name) {
            refs.push((name.to_string(), sha.to_string()));
        }
    }
    refs
}

/// Выпуски прошивки — теги vX.Y.Z, новые первыми.
pub fn versions() -> Res<Vec<String>> {
    let mut tags: Vec<String> = match api("tags?per_page=100") {
        Ok(list) => list
            .as_array()
            .ok_or("GitHub: не список тегов")?
            .iter()
            .filter_map(|t| t["name"].as_str())
            .map(str::to_string)
            .collect(),
        Err(_) => git_refs()?.into_iter().filter_map(|(n, _)| n.strip_prefix("refs/tags/").map(str::to_string)).collect(),
    };
    tags.retain(|t| t.starts_with('v'));
    tags.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
    Ok(tags)
}

/// Коммит ветки или тега: API, а при его сбое — ссылки git.
fn resolve_commit(reference: &str) -> Res<String> {
    if let Some(sha) = api(&format!("commits/{reference}")).ok().and_then(|v| v["sha"].as_str().map(str::to_string)) {
        return Ok(sha);
    }
    let refs = git_refs()?;
    [format!("refs/tags/{reference}"), format!("refs/heads/{reference}")]
        .iter()
        .find_map(|want| refs.iter().find(|(n, _)| n == want).map(|(_, sha)| sha.clone()))
        .ok_or_else(|| format!("на GitHub нет {reference}"))
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
    let commit = resolve_commit(&reference)?;
    let dest = root.join("OpenPlaneProject");
    if marker_commit(&dest).as_deref() == Some(commit.as_str()) && dest.join("tools").join("opconfig.py").is_file() {
        log(&format!("Исходники прошивки уже скачаны ({reference}, {})", &commit[..7]));
        return Ok(dest);
    }

    let tmp = root.join(format!(".download-{}", &commit[..12]));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir_all(&tmp).map_err(err("папка загрузки"))?;
    let got = match api(&format!("git/trees/{commit}?recursive=1")) {
        Ok(tree) => download_files(root, &tmp, &commit, &reference, &tree, log),
        Err(e) => {
            log(&format!("API GitHub не ответил ({e}) — качаю архив коммита целиком, это дольше"));
            download_archive(root, &tmp, &commit)
        }
    };
    if let Err(e) = got {
        let _ = fs::remove_dir_all(&tmp);
        return Err(e);
    }
    if !tmp.join("tools").join("opconfig.py").is_file() {
        let _ = fs::remove_dir_all(&tmp);
        return Err("эта версия прошивки старая — без tools/opconfig.py, приложение с ней не работает".into());
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

/// Нужные файлы по списку из API — одним curl, параллельно.
fn download_files(root: &Path, tmp: &Path, commit: &str, reference: &str, tree: &Value, log: &dyn Fn(&str)) -> Res<()> {
    let files: Vec<(String, u64)> = tree["tree"]
        .as_array()
        .ok_or("GitHub: нет списка файлов")?
        .iter()
        .filter(|e| e["type"] == "blob")
        .filter_map(|e| Some((e["path"].as_str()?.to_string(), e["size"].as_u64().unwrap_or(0))))
        .filter(|(p, _)| needed(p))
        .collect();
    let total: u64 = files.iter().map(|(_, s)| s).sum();
    log(&format!("Скачиваю исходники прошивки {reference} ({}): {} файлов, {} КБ", &commit[..7], files.len(), total / 1024));

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
        return Err(format!("исходники не скачались: {}", out.stderr.trim()));
    }
    for (path, size) in &files {
        let got = fs::metadata(tmp.join(path)).map(|m| m.len()).unwrap_or(u64::MAX);
        if got != *size {
            return Err(format!("файл {path} скачался не целиком — повторите"));
        }
    }
    Ok(())
}

/// Архив коммита (без API): распаковать только нужное и поднять на уровень вверх.
fn download_archive(root: &Path, tmp: &Path, commit: &str) -> Res<()> {
    let archive = root.join(".download.tar.gz");
    download(&format!("https://codeload.github.com/{REPO}/tar.gz/{commit}"), &archive)?;
    let unpack = root.join(".download-unpack");
    let _ = fs::remove_dir_all(&unpack);
    fs::create_dir_all(&unpack).map_err(err("папка загрузки"))?;
    let mut cmd = command(system_tool("tar"));
    cmd.arg("-xzf").arg(&archive).arg("-C").arg(&unpack);
    for skip in ["*/airframe", "*/docs", "*/test", "*/.github"] {
        cmd.arg("--exclude").arg(skip);
    }
    let out = run_capture(cmd, None)?;
    let _ = fs::remove_file(&archive);
    if out.code != 0 {
        let _ = fs::remove_dir_all(&unpack);
        return Err(format!("архив исходников не распаковался: {}", out.stderr.trim()));
    }
    let top = fs::read_dir(&unpack)
        .map_err(err("архив исходников"))?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_dir())
        .ok_or("архив исходников пустой")?;
    let _ = fs::remove_dir_all(tmp);
    fs::rename(&top, tmp).map_err(err("папка исходников"))?;
    let _ = fs::remove_dir_all(&unpack);
    Ok(())
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
    fn git_refs_from_https_advertisement() {
        let text = "001e# service=git-upload-pack\n0000015ffb6fa22e9bdfcbaa4ef098b735e24108719ad62b HEAD\0multi_ack symref=HEAD:refs/heads/main\n\
003dfb6fa22e9bdfcbaa4ef098b735e24108719ad62b refs/heads/main\n\
003f1111111111111111111111111111111111111111 refs/tags/v1.0.0\n\
00422222222222222222222222222222222222222222 refs/tags/v1.0.0^{}\n0000";
        let refs = parse_refs(text);
        assert!(refs.contains(&("refs/heads/main".into(), "fb6fa22e9bdfcbaa4ef098b735e24108719ad62b".into())));
        assert!(refs.contains(&("refs/tags/v1.0.0".into(), "2222222222222222222222222222222222222222".into())));
        assert!(refs.iter().any(|(n, _)| n == "HEAD"));
    }

    #[test]
    fn url_paths_are_escaped() {
        assert_eq!(url_path("include/a b+c.h"), "include/a%20b%2Bc.h");
        assert_eq!(version_key("v1.10.2"), vec![1, 10, 2]);
    }
}
