//! Постоянная связь с платой по COM-порту: приложение держит порт, раз в
//! секунду просит живые данные ("live", AppLink.h прошивки) и разбирает
//! строки платы: "@live {...}", "@id {...}", "@scan {...}" и обычный текст
//! консоли. Порт в Windows открывается одной программой — пока связь есть,
//! все запросы к плате идут через неё. Перед прошивкой связь отпускается.
//! Чёрный ящик (список полётов, выгрузка) — тоже через неё: поток на время
//! выгрузки перестаёт спрашивать живые данные (blackbox.rs).

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::blackbox;
use crate::util::Res;

/// Что поток связи делает по просьбе приложения.
enum Msg {
    Bytes(Vec<u8>),
    Blackbox(blackbox::Job, Sender<Res<blackbox::Done>>),
}

struct Handle {
    port: String,
    stop: Arc<AtomicBool>,
    tx: Sender<Msg>,
    thread: Option<thread::JoinHandle<()>>,
}

#[derive(Default)]
pub struct LinkState(Mutex<Option<Handle>>);

#[derive(Clone, Serialize)]
struct LinkStatus<'a> {
    port: &'a str,
    state: &'a str, // "open" | "closed" | "error"
    error: Option<String>,
}

#[derive(Clone, Serialize)]
struct BoardLine<'a> {
    port: &'a str,
    line: String,
}

#[derive(Clone, Serialize)]
struct BoardJson<'a> {
    port: &'a str,
    data: Value,
}

fn open(port: &str, stm32: bool) -> Res<Box<dyn serialport::SerialPort>> {
    let mut p = serialport::new(port, 115_200)
        .timeout(Duration::from_millis(30))
        .dtr_on_open(stm32)
        .open()
        .map_err(|e| {
            let text = e.to_string();
            if text.contains("Access is denied") || text.contains("Отказано в доступе") || text.contains("os error 5") {
                format!("PORT_BUSY: {port} занят другой программой")
            } else {
                format!("{port}: {text}")
            }
        })?;
    if !stm32 {
        let _ = p.write_request_to_send(false);
    }
    Ok(p)
}

#[derive(PartialEq)]
enum Got {
    Nothing,
    Live,
    Other,
    /// Старая прошивка не знает команду приложения ("live", "scan"...).
    Refused,
}

/// Так старая прошивка отвечает на незнакомую команду ПК (её разбирает чёрный ящик).
const REFUSED: &str = "BB:ERR неизвестная команда";

/// Ответы коптера на команды настроек (CopterLink.h прошивки) — событием
/// "board-msg"; "@param" (их сотни на "params") в консоль не идут.
const COPTER_MSGS: &[&str] = &["params", "param", "rc", "modes", "set", "save", "revert", "profile", "error", "motor", "dshot"];

#[derive(Clone, Serialize)]
struct BoardMsg<'a> {
    port: &'a str,
    kind: &'a str,
    data: Value,
}

fn handle_line(app: &AppHandle, port: &str, line: &str) -> Got {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Got::Nothing;
    }
    if trimmed == REFUSED {
        return Got::Refused;
    }
    for (prefix, event) in [("@live ", "board-live"), ("@id ", "board-id"), ("@scan ", "board-scan")] {
        if let Some(json) = trimmed.strip_prefix(prefix) {
            if let Ok(data) = serde_json::from_str::<Value>(json) {
                let _ = app.emit(event, BoardJson { port, data });
                return if event == "board-live" { Got::Live } else { Got::Other };
            }
        }
    }
    if let Some((kind, data)) = copter_msg(trimmed) {
        let _ = app.emit("board-msg", BoardMsg { port, kind, data });
        if kind == "param" {
            return Got::Other;
        }
    }
    let _ = app.emit("board-line", BoardLine { port, line: trimmed.to_string() });
    Got::Other
}

/// "@set {...}" → ("set", JSON), если это ответ коптера.
fn copter_msg(line: &str) -> Option<(&'static str, Value)> {
    let (kind, json) = line.strip_prefix('@')?.split_once(' ')?;
    let kind = COPTER_MSGS.iter().find(|k| **k == kind)?;
    serde_json::from_str::<Value>(json).ok().map(|v| (*kind, v))
}

// ---- MSP: что за прошивка, если не наша (Betaflight) ----

const MSP_FC_VARIANT: u8 = 2;
const MSP_FC_VERSION: u8 = 3;
const MSP_BOARD_INFO: u8 = 4;

fn msp_request(cmd: u8) -> [u8; 6] {
    [b'$', b'M', b'<', 0, cmd, cmd]
}

/// Вынуть из потока ответы MSP v1 ('$M>' размер команда данные xor):
/// (команда, данные). Неполный кадр остаётся ждать хвоста.
fn take_msp(pending: &mut Vec<u8>) -> Vec<(u8, Vec<u8>)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 3 <= pending.len() {
        if &pending[i..i + 3] != b"$M>" {
            i += 1;
            continue;
        }
        if i + 5 > pending.len() {
            break;
        }
        let size = pending[i + 3] as usize;
        let end = i + 5 + size;
        if end >= pending.len() {
            break;
        }
        let cmd = pending[i + 4];
        let payload = pending[i + 5..end].to_vec();
        let x = payload.iter().fold((size as u8) ^ cmd, |a, b| a ^ b);
        if x == pending[end] {
            out.push((cmd, payload));
            pending.drain(i..=end);
        } else {
            i += 3;
        }
    }
    out
}

/// Строка «длина + текст» из ответа MSP.
fn msp_text(p: &[u8], pos: &mut usize) -> Option<String> {
    let n = *p.get(*pos)? as usize;
    let s = p.get(*pos + 1..*pos + 1 + n)?;
    *pos += 1 + n;
    Some(String::from_utf8_lossy(s).into_owned())
}

/// Поля ответа MSP — в JSON события "board-fc".
fn msp_fields(fc: &mut serde_json::Map<String, Value>, cmd: u8, p: &[u8]) {
    match cmd {
        MSP_FC_VARIANT if p.len() >= 4 => {
            fc.insert("variant".into(), Value::String(String::from_utf8_lossy(&p[..4]).into_owned()));
        }
        MSP_FC_VERSION if p.len() >= 3 => {
            fc.insert("version".into(), Value::String(format!("{}.{}.{}", p[0], p[1], p[2])));
        }
        MSP_BOARD_INFO if p.len() >= 8 => {
            fc.insert("id".into(), Value::String(String::from_utf8_lossy(&p[..4]).into_owned()));
            let mut pos = 8;
            for key in ["target", "board", "manufacturer"] {
                match msp_text(p, &mut pos) {
                    Some(s) => {
                        fc.insert(key.into(), Value::String(s));
                    }
                    None => break,
                }
            }
        }
        _ => {}
    }
}

// ---- MAVLink: ArduPilot и PX4 сами шлют HEARTBEAT раз в секунду ----

/// Контрольная сумма MAVLink (CRC-16/MCRF4XX) с «лишним байтом» сообщения.
fn mav_crc(bytes: &[u8], extra: u8) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in bytes.iter().chain(std::iter::once(&extra)) {
        let mut tmp = b ^ (crc as u8);
        tmp ^= tmp << 4;
        crc = (crc >> 8) ^ ((tmp as u16) << 8) ^ ((tmp as u16) << 3) ^ ((tmp as u16) >> 4);
    }
    crc
}

/// HEARTBEAT (сообщение 0) в потоке: (тип аппарата MAV_TYPE, автопилот MAV_AUTOPILOT).
/// Кадры MAVLink 1 (0xFE) и 2 (0xFD); сумма проверяется — текст и MSP не спутаются.
fn find_heartbeat(data: &[u8]) -> Option<(u8, u8)> {
    const HEARTBEAT_EXTRA: u8 = 50;
    for i in 0..data.len() {
        let (head, v2) = match data[i] {
            0xFD => (10, true),
            0xFE => (6, false),
            _ => continue,
        };
        let Some(&len) = data.get(i + 1) else { break };
        let len = len as usize;
        let end = i + head + len + 2;
        if end > data.len() || len > 9 {
            continue;
        }
        let msgid = if v2 {
            data[i + 7] as u32 | (data[i + 8] as u32) << 8 | (data[i + 9] as u32) << 16
        } else {
            data[i + 5] as u32
        };
        if msgid != 0 {
            continue;
        }
        let crc = mav_crc(&data[i + 1..i + head + len], HEARTBEAT_EXTRA);
        if crc.to_le_bytes() != [data[end - 2], data[end - 1]] {
            continue;
        }
        // MAVLink 2 обрезает нули в конце данных — дополняем.
        let mut payload = [0u8; 9];
        payload[..len].copy_from_slice(&data[i + head..i + head + len]);
        return Some((payload[4], payload[5]));
    }
    None
}

/// Поля "board-fc" по HEARTBEAT: variant ARDU (ArduPilot), PX4 или MAVL (прочий MAVLink).
fn mav_fields(fc: &mut serde_json::Map<String, Value>, kind: u8, autopilot: u8) {
    let variant = match autopilot {
        3 => "ARDU",
        12 => "PX4",
        _ => "MAVL",
    };
    fc.insert("variant".into(), Value::String(variant.into()));
    fc.insert("vehicle".into(), Value::from(kind));
}

fn run(app: AppHandle, port: String, mut serial: Box<dyn serialport::SerialPort>, stop: Arc<AtomicBool>, rx: Receiver<Msg>) {
    let _ = app.emit("board-link", LinkStatus { port: &port, state: "open", error: None });
    let mut buf = [0u8; 2048];
    let mut pending: Vec<u8> = Vec::new();
    let mut next_live = Instant::now();
    let mut error: Option<String> = None;
    // Прошивка без живых данных отвечает на "live" ошибкой — дважды, и больше не спрашиваем.
    let mut live_seen = false;
    let mut refused = 0u32;
    let mut polling = true;
    let mut mavlink = false;
    // Сразу — паспорт и живые данные; и MSP: если на плате Betaflight, он
    // ответит, кто он (наша прошивка тоже ответит — её узнают по "@id").
    let _ = serial.write_all(b"\x02id\n");
    let mut fc = serde_json::Map::new();
    for cmd in [MSP_FC_VARIANT, MSP_FC_VERSION, MSP_BOARD_INFO] {
        let _ = serial.write_all(&msp_request(cmd));
    }
    while !stop.load(Ordering::Relaxed) {
        if polling && Instant::now() >= next_live {
            if let Err(e) = serial.write_all(b"\x02live\n") {
                error = Some(e.to_string());
                break;
            }
            next_live = Instant::now() + Duration::from_millis(1000);
        }
        while let Ok(msg) = rx.try_recv() {
            match msg {
                Msg::Bytes(bytes) => {
                    if let Err(e) = serial.write_all(&bytes) {
                        error = Some(e.to_string());
                        break;
                    }
                }
                Msg::Blackbox(job, reply) => {
                    let (app2, port2) = (app.clone(), port.clone());
                    let mut on_line = |line: &str| {
                        handle_line(&app2, &port2, line);
                    };
                    let result = blackbox::run(&app, &mut serial, &mut pending, job, &mut on_line);
                    let _ = reply.send(result);
                    next_live = Instant::now() + Duration::from_millis(300);
                }
            }
        }
        if error.is_some() {
            break;
        }
        match serial.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                let answers = take_msp(&mut pending);
                if !answers.is_empty() {
                    let info = answers.iter().any(|(cmd, _)| *cmd == MSP_BOARD_INFO);
                    for (cmd, p) in answers {
                        msp_fields(&mut fc, cmd, &p);
                    }
                    if info {
                        let _ = app.emit("board-fc", BoardJson { port: &port, data: Value::Object(fc.clone()) });
                    }
                }
                // ArduPilot/PX4: поток MAVLink — не строки консоли; живые данные не спрашиваем.
                if mavlink {
                    pending.clear();
                    continue;
                }
                if let Some((kind, autopilot)) = find_heartbeat(&pending) {
                    mav_fields(&mut fc, kind, autopilot);
                    let _ = app.emit("board-fc", BoardJson { port: &port, data: Value::Object(fc.clone()) });
                    mavlink = true;
                    polling = false;
                    pending.clear();
                    continue;
                }
                while let Some(pos) = pending.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = pending.drain(..=pos).collect();
                    match handle_line(&app, &port, &String::from_utf8_lossy(&line)) {
                        Got::Live => live_seen = true,
                        Got::Refused if !live_seen => {
                            refused += 1;
                            if refused >= 2 && polling {
                                polling = false;
                                let _ = app.emit("board-nolive", BoardLine { port: &port, line: REFUSED.into() });
                            }
                        }
                        _ => {}
                    }
                }
                if pending.len() > 16 * 1024 {
                    pending.clear();
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
            Err(e) => {
                error = Some(e.to_string());
                break;
            }
        }
    }
    // Прощание: плате больше не нужно слать живые данные.
    if polling {
        let _ = serial.write_all(b"\x02live 0\n");
    }
    let state = if error.is_some() { "error" } else { "closed" };
    let _ = app.emit("board-link", LinkStatus { port: &port, state, error });
}

impl LinkState {
    pub fn start(&self, app: &AppHandle, port: &str, stm32: bool) -> Res<()> {
        let mut guard = self.0.lock().map_err(|_| "связь: блокировка")?;
        if let Some(h) = guard.as_ref() {
            if h.port == port && h.thread.as_ref().map(|t| !t.is_finished()).unwrap_or(false) {
                return Ok(());
            }
        }
        if let Some(mut old) = guard.take() {
            old.stop.store(true, Ordering::Relaxed);
            if let Some(t) = old.thread.take() {
                let _ = t.join();
            }
        }
        let serial = open(port, stm32)?;
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = channel::<Msg>();
        let (app2, port2, stop2) = (app.clone(), port.to_string(), stop.clone());
        let thread = thread::spawn(move || run(app2, port2, serial, stop2, rx));
        *guard = Some(Handle { port: port.to_string(), stop, tx, thread: Some(thread) });
        Ok(())
    }

    pub fn stop(&self) -> Res<()> {
        let mut guard = self.0.lock().map_err(|_| "связь: блокировка")?;
        if let Some(mut h) = guard.take() {
            h.stop.store(true, Ordering::Relaxed);
            if let Some(t) = h.thread.take() {
                let _ = t.join();
            }
        }
        Ok(())
    }

    pub fn send(&self, bytes: Vec<u8>) -> Res<()> {
        let guard = self.0.lock().map_err(|_| "связь: блокировка")?;
        match guard.as_ref() {
            Some(h) if h.thread.as_ref().map(|t| !t.is_finished()).unwrap_or(false) => {
                h.tx.send(Msg::Bytes(bytes)).map_err(|_| "связь закрыта".to_string())
            }
            _ => Err("плата не подключена".into()),
        }
    }

    /// Чёрный ящик через поток связи; ждать ответа долго нельзя только из UI —
    /// команды Tauri зовут это в отдельном потоке (lib.rs, blocking).
    pub fn blackbox(&self, job: blackbox::Job) -> Res<blackbox::Done> {
        let (reply, answer) = channel::<Res<blackbox::Done>>();
        {
            let guard = self.0.lock().map_err(|_| "связь: блокировка")?;
            match guard.as_ref() {
                Some(h) if h.thread.as_ref().map(|t| !t.is_finished()).unwrap_or(false) => {
                    h.tx.send(Msg::Blackbox(job, reply)).map_err(|_| "связь закрыта".to_string())?;
                }
                _ => return Err("плата не подключена".into()),
            }
        }
        answer.recv_timeout(Duration::from_secs(30 * 60)).map_err(|_| "чёрный ящик: нет ответа от потока связи".to_string())?
    }

    pub fn port(&self) -> Option<String> {
        let guard = self.0.lock().ok()?;
        guard
            .as_ref()
            .filter(|h| h.thread.as_ref().map(|t| !t.is_finished()).unwrap_or(false))
            .map(|h| h.port.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn answer(cmd: u8, payload: &[u8]) -> Vec<u8> {
        let mut f = vec![b'$', b'M', b'>', payload.len() as u8, cmd];
        f.extend_from_slice(payload);
        f.push(payload.iter().fold((payload.len() as u8) ^ cmd, |a, b| a ^ b));
        f
    }

    #[test]
    fn msp_answers_are_taken_out_of_the_stream() {
        let mut stream = b"@id {}\n".to_vec();
        stream.extend(answer(2, b"BTFL"));
        stream.extend(b"text\n");
        let mut info = b"S405\0\0\0\0".to_vec();
        info.extend(b"\x0cGETFUNF405V3\x0cGETFUNF405V3\x04GETF");
        let tail = answer(4, &info);
        stream.extend(&tail[..10]);
        let got = take_msp(&mut stream);
        assert_eq!(got, vec![(2, b"BTFL".to_vec())]);
        assert_eq!(stream, [b"@id {}\ntext\n".as_slice(), &tail[..10]].concat());   // хвост ждёт
        stream.extend(&tail[10..]);
        let got = take_msp(&mut stream);
        assert_eq!(got.len(), 1);
        let mut fc = serde_json::Map::new();
        msp_fields(&mut fc, got[0].0, &got[0].1);
        msp_fields(&mut fc, 2, b"BTFL");
        assert_eq!(fc["board"], "GETFUNF405V3");
        assert_eq!(fc["manufacturer"], "GETF");
        assert_eq!(fc["variant"], "BTFL");
        // испорченная сумма — не ответ
        let mut bad = answer(3, &[4, 5, 1]);
        *bad.last_mut().unwrap() ^= 0xFF;
        assert!(take_msp(&mut bad).is_empty());
    }

    /// Кадр HEARTBEAT, как его шлёт ArduPilot: MAVLink 2, нули в конце обрезаны.
    fn heartbeat_v2(kind: u8, autopilot: u8) -> Vec<u8> {
        let mut payload = vec![0, 0, 0, 0, kind, autopilot, 0x51, 3, 3];
        while payload.last() == Some(&0) {
            payload.pop();
        }
        let mut f = vec![0xFD, payload.len() as u8, 0, 0, 7, 1, 1, 0, 0, 0];
        f.extend(&payload);
        let crc = mav_crc(&f[1..], 50);
        f.extend(crc.to_le_bytes());
        f
    }

    #[test]
    fn mavlink_heartbeat_tells_ardupilot() {
        let mut stream = b"garbage \xFD\x01 text\n".to_vec();
        stream.extend(heartbeat_v2(2, 3));
        assert_eq!(find_heartbeat(&stream), Some((2, 3)));
        let mut fc = serde_json::Map::new();
        mav_fields(&mut fc, 2, 3);
        assert_eq!(fc["variant"], "ARDU");
        assert_eq!(fc["vehicle"], 2);
        // MAVLink 1, самолёт PX4
        let mut v1 = vec![0xFE, 9, 3, 1, 1, 0, 0, 0, 0, 0, 1, 12, 0, 3, 3];
        let crc = mav_crc(&v1[1..], 50);
        v1.extend(crc.to_le_bytes());
        assert_eq!(find_heartbeat(&v1), Some((1, 12)));
        // испорченная сумма и неполный кадр — не HEARTBEAT
        let mut bad = heartbeat_v2(2, 3);
        *bad.last_mut().unwrap() ^= 1;
        assert_eq!(find_heartbeat(&bad), None);
        let full = heartbeat_v2(2, 3);
        assert_eq!(find_heartbeat(&full[..full.len() - 1]), None);
    }

    #[test]
    fn copter_answers_are_recognised() {
        let (kind, v) = copter_msg("@set {\"name\":\"p_roll\",\"ok\":true}").unwrap();
        assert_eq!(kind, "set");
        assert_eq!(v["name"], "p_roll");
        assert_eq!(copter_msg("@modes [[0,\"ARM\",true]]").unwrap().0, "modes");
        assert!(copter_msg("@live {}").is_none());
        assert!(copter_msg("@param не json").is_none());
        assert!(copter_msg("Мотор 1").is_none());
    }
}
