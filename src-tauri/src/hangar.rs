//! Ангар: самолёт = папка Документы/OpenPlane/Hangar/<id>/ с plane.json и
//! history/ (снимок конфигурации на каждую прошивку). Удаление — в .trash.

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tauri::AppHandle;

use crate::util::{config_dir, err, hangar_dir, write_atomic, Res};

fn check_id(id: &str) -> Res<()> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Ok(())
    } else {
        Err(format!("неверный id самолёта: {id}"))
    }
}

fn plane_dir(app: &AppHandle, id: &str) -> Res<PathBuf> {
    check_id(id)?;
    Ok(hangar_dir(app)?.join(id))
}

pub fn list(app: &AppHandle) -> Res<Vec<Value>> {
    let dir = hangar_dir(app)?;
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir(&dir) else { return Ok(out) };
    for entry in entries.flatten() {
        let file = entry.path().join("plane.json");
        if let Ok(text) = fs::read_to_string(&file) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                out.push(v);
            }
        }
    }
    Ok(out)
}

pub fn save(app: &AppHandle, plane: &Value) -> Res<()> {
    let id = plane.get("id").and_then(Value::as_str).ok_or("у самолёта нет id")?;
    let text = serde_json::to_string_pretty(plane).map_err(err("JSON"))?;
    write_atomic(&plane_dir(app, id)?.join("plane.json"), &text)
}

pub fn snapshot(app: &AppHandle, id: &str, label: &str, data: &Value) -> Res<String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let safe: String = label.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(24).collect();
    let file = plane_dir(app, id)?.join("history").join(format!("{stamp}-{safe}.json"));
    let text = serde_json::to_string_pretty(data).map_err(err("JSON"))?;
    write_atomic(&file, &text)?;
    Ok(file.to_string_lossy().into_owned())
}

/// Не стирает: переносит папку в Hangar/.trash/<id>-<время>.
pub fn remove(app: &AppHandle, id: &str) -> Res<()> {
    let from = plane_dir(app, id)?;
    if !from.is_dir() {
        return Ok(());
    }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let trash = hangar_dir(app)?.join(".trash");
    fs::create_dir_all(&trash).map_err(err("корзина"))?;
    fs::rename(&from, trash.join(format!("{id}-{stamp}"))).map_err(err("перенос в корзину"))
}

pub fn load_settings(app: &AppHandle) -> Res<Value> {
    let file = config_dir(app)?.join("settings.json");
    Ok(fs::read_to_string(file)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| Value::Object(Default::default())))
}

pub fn save_settings(app: &AppHandle, settings: &Value) -> Res<()> {
    let text = serde_json::to_string_pretty(settings).map_err(err("JSON"))?;
    write_atomic(&config_dir(app)?.join("settings.json"), &text)
}
