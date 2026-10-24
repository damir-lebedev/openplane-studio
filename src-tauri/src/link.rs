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
    let _ = app.emit("board-line", BoardLine { port, line: trimmed.to_string() });
    Got::Other
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
    // Сразу — паспорт и живые данные.
    let _ = serial.write_all(b"\x02id\n");
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
