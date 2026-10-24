//! Чёрный ящик: список полётов на плате и выгрузка полёта по той же связи
//! (link.rs держит порт). Протокол прошивки — BlackBoxCore.h, как у
//! `tools/blackbox.py download`:
//!
//!   ПК:  STX "bb list" '\n'  →  BB:STATE k=v …, BB:FLIGHT n=… sectors=… kb=… seconds=… start=…, BB:END
//!   ПК:  STX "bb get N" '\n' →  BB:SEND n=N sectors=K baud=B; ПК шлёт 'G';
//!        K кадров: A5 5A, u16 номер, 4096 байт сектора, u32 CRC-32; BB:DONE n=N crc=…
//!
//! Полёт сохраняется файлом .bbl (сектора подряд) — его читает и
//! tools/blackbox.py decode, и вкладка «Ящик».

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

use crate::util::{err, hangar_dir, Res};

pub const SECTOR: usize = 4096;
const FRAME: usize = 4 + SECTOR + 4;
const QUIET: Duration = Duration::from_secs(4);

pub enum Job {
    List,
    Get(u16),
}

pub enum Done {
    List(Value),
    Get(Vec<u8>),
}

#[derive(Clone, Serialize)]
struct Progress {
    flight: u16,
    done: usize,
    total: usize,
}

/// CRC-32 как zlib.crc32 (BlackBoxFormat::crc32 в прошивке).
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xEDB8_8320 & (0u32.wrapping_sub(crc & 1)));
        }
    }
    !crc
}

/// "BB:FLIGHT n=3 sectors=12 …" → {"n":3,"sectors":12,…}
fn fields(rest: &str) -> Map<String, Value> {
    let mut m = Map::new();
    for pair in rest.split_whitespace() {
        if let Some((k, v)) = pair.split_once('=') {
            let value = v.parse::<i64>().map(Value::from).unwrap_or_else(|_| Value::from(v));
            m.insert(k.to_string(), value);
        }
    }
    m
}

/// Ввод платы во время работы: строки и байты. Не ящику — в обычный разбор (on_line).
struct Reader<'a> {
    serial: &'a mut Box<dyn serialport::SerialPort>,
    pending: &'a mut Vec<u8>,
}

impl Reader<'_> {
    fn fill(&mut self) -> Res<usize> {
        let mut buf = [0u8; 8192];
        match self.serial.read(&mut buf) {
            Ok(n) => {
                self.pending.extend_from_slice(&buf[..n]);
                Ok(n)
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Ok(0),
            Err(e) => Err(e.to_string()),
        }
    }

    /// Следующая строка (без \r\n) или None, если платa молчит дольше QUIET.
    fn line(&mut self, on_line: &mut dyn FnMut(&str)) -> Res<Option<String>> {
        let mut last = Instant::now();
        loop {
            if let Some(pos) = self.pending.iter().position(|&b| b == b'\n') {
                let raw: Vec<u8> = self.pending.drain(..=pos).collect();
                let text = String::from_utf8_lossy(&raw).trim().to_string();
                if text.starts_with("BB:") {
                    return Ok(Some(text));
                }
                if !text.is_empty() {
                    on_line(&text);
                }
                continue;
            }
            if self.fill()? > 0 {
                last = Instant::now();
            } else if last.elapsed() > QUIET {
                return Ok(None);
            }
        }
    }
}

pub fn run(
    app: &AppHandle,
    serial: &mut Box<dyn serialport::SerialPort>,
    pending: &mut Vec<u8>,
    job: Job,
    on_line: &mut dyn FnMut(&str),
) -> Res<Done> {
    match job {
        Job::List => list(serial, pending, on_line).map(Done::List),
        Job::Get(n) => get(app, serial, pending, n, on_line).map(Done::Get),
    }
}

fn list(serial: &mut Box<dyn serialport::SerialPort>, pending: &mut Vec<u8>, on_line: &mut dyn FnMut(&str)) -> Res<Value> {
    serial.write_all(b"\x02bb list\n").map_err(|e| e.to_string())?;
    let mut r = Reader { serial, pending };
    let mut state = Map::new();
    let mut flights = Vec::new();
    loop {
        let Some(line) = r.line(on_line)? else { return Err("плата не ответила на bb list".into()) };
        if let Some(rest) = line.strip_prefix("BB:STATE ") {
            state = fields(rest);
        } else if let Some(rest) = line.strip_prefix("BB:FLIGHT ") {
            flights.push(Value::Object(fields(rest)));
        } else if line == "BB:END" {
            return Ok(json!({ "state": state, "flights": flights }));
        } else if let Some(rest) = line.strip_prefix("BB:ERR") {
            return Err(format!("плата: {}", rest.trim()));
        }
    }
}

fn get(
    app: &AppHandle,
    serial: &mut Box<dyn serialport::SerialPort>,
    pending: &mut Vec<u8>,
    flight: u16,
    on_line: &mut dyn FnMut(&str),
) -> Res<Vec<u8>> {
    serial.write_all(format!("\x02bb get {flight}\n").as_bytes()).map_err(|e| e.to_string())?;
    let mut r = Reader { serial, pending };
    let sectors = loop {
        let Some(line) = r.line(on_line)? else { return Err("плата не ответила на bb get".into()) };
        if let Some(rest) = line.strip_prefix("BB:SEND ") {
            let f = fields(rest);
            break f.get("sectors").and_then(Value::as_u64).ok_or("BB:SEND без sectors")? as usize;
        }
        if let Some(rest) = line.strip_prefix("BB:ERR") {
            return Err(format!("плата: {}", rest.trim()));
        }
    };
    r.serial.write_all(b"G").map_err(|e| e.to_string())?;

    let mut out = Vec::with_capacity(sectors * SECTOR);
    let mut last = Instant::now();
    let mut done = 0usize;
    while done < sectors {
        // кадр: ищем A5 5A — до него может прийти хвост строки
        if r.pending.len() >= 2 && !(r.pending[0] == 0xA5 && r.pending[1] == 0x5A) {
            match r.pending.windows(2).position(|w| w == [0xA5, 0x5A]) {
                Some(p) => {
                    r.pending.drain(..p);
                }
                None => {
                    let keep = r.pending.len() - 1;
                    r.pending.drain(..keep);
                }
            }
        }
        if r.pending.len() >= FRAME {
            let frame: Vec<u8> = r.pending.drain(..FRAME).collect();
            let index = u16::from_le_bytes([frame[2], frame[3]]) as usize;
            let data = &frame[4..4 + SECTOR];
            let crc = u32::from_le_bytes([frame[4 + SECTOR], frame[5 + SECTOR], frame[6 + SECTOR], frame[7 + SECTOR]]);
            if index != (done & 0xFFFF) {
                return Err(format!("кадр {index} вместо {done}: связь прервалась"));
            }
            if crc32(data) != crc {
                return Err(format!("сектор {done}: CRC не сошёлся — повторите выгрузку"));
            }
            out.extend_from_slice(data);
            done += 1;
            if done % 16 == 0 || done == sectors {
                let _ = app.emit("blackbox-progress", Progress { flight, done, total: sectors });
            }
            last = Instant::now();
            continue;
        }
        if r.fill()? > 0 {
            last = Instant::now();
        } else if last.elapsed() > QUIET {
            return Err(format!("плата замолчала на секторе {done} из {sectors}"));
        }
    }
    // BB:DONE — необязательно ждать долго: данные уже сверены по CRC
    let deadline = Instant::now() + Duration::from_millis(1500);
    while Instant::now() < deadline {
        if r.pending.windows(7).any(|w| w == b"BB:DONE") {
            break;
        }
        r.fill()?;
    }
    if let Some(pos) = r.pending.windows(7).position(|w| w == b"BB:DONE") {
        if let Some(end) = r.pending[pos..].iter().position(|&b| b == b'\n') {
            r.pending.drain(..pos + end + 1);
        }
    }
    Ok(out)
}

/// Папка журналов: <Ангар>/<проект>/blackbox, без проекта — Документы/OpenPlane/Blackbox.
pub fn logs_dir(app: &AppHandle, project: Option<&str>) -> Res<PathBuf> {
    let hangar = hangar_dir(app)?;
    match project.filter(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) {
        Some(id) => Ok(hangar.join(id).join("blackbox")),
        None => Ok(hangar.parent().map(Path::to_path_buf).unwrap_or(hangar).join("Blackbox")),
    }
}

pub fn save(app: &AppHandle, project: Option<&str>, flight: u16, data: &[u8]) -> Res<String> {
    let dir = logs_dir(app, project)?;
    std::fs::create_dir_all(&dir).map_err(err("создать папку"))?;
    let stamp = {
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        secs.to_string()
    };
    let path = dir.join(format!("flight_{flight:03}_{stamp}.bbl"));
    std::fs::write(&path, data).map_err(err("записать журнал"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
pub struct LogFile {
    path: String,
    name: String,
    bytes: u64,
    modified: u64,
}

/// Сохранённые журналы проекта и общей папки (Документы/OpenPlane/Blackbox), новые сверху.
pub fn files(app: &AppHandle, project: Option<&str>) -> Res<Vec<LogFile>> {
    let mut dirs = vec![logs_dir(app, project)?];
    if project.is_some() {
        dirs.push(logs_dir(app, None)?);
    }
    let mut out = Vec::new();
    for dir in dirs {
        scan(&dir, &mut out);
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

fn scan(dir: &Path, out: &mut Vec<LogFile>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("bbl")) != Some(true) {
            continue;
        }
        let meta = entry.metadata().ok();
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(LogFile {
            name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            path: path.to_string_lossy().into_owned(),
            bytes: meta.map(|m| m.len()).unwrap_or(0),
            modified,
        });
    }
}

pub fn read(path: &str) -> Res<Vec<u8>> {
    let p = Path::new(path);
    if p.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("bbl") || e.eq_ignore_ascii_case("bin")) != Some(true) {
        return Err("это не журнал ящика (.bbl)".into());
    }
    std::fs::read(p).map_err(err("прочитать журнал"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_zlib() {
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(&[]), 0);
    }

    #[test]
    fn flight_line_fields() {
        let f = fields("n=3 sectors=12 kb=48 seconds=20 start=1");
        assert_eq!(f["n"], 3);
        assert_eq!(f["sectors"], 12);
        let s = fields("state=idle free_kb=1000");
        assert_eq!(s["state"], "idle");
    }
}
