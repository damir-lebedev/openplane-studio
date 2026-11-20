//! Прошивка самолёта на ESP32 по WiFi (P50): плата держит точку доступа
//! (`WIFI_AP_SSID`, http://192.168.4.1), окно прошивки открывают на земле
//! (консоль 'u', команда "ota" по USB, жест стиков) — прошивка
//! `include/telemetry/WifiOta.h` + `OtaGate.h`.
//!
//! `GET /ota` — паспорт и окно, `POST /update` — образ формой
//! multipart/form-data (поле `firmware`), ответ "OK" или код отказа.
//! HTTP — свой, на `TcpStream`, без зависимостей: один запрос, один ответ.
//! На Android сокет идёт в сеть платы, потому что Kotlin-плагин привязал к
//! ней процесс (`wifiConnect` → `bindProcessToNetwork`).

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

pub type Res<T> = Result<T, String>;

/// Адрес точки доступа ESP32 (softAP по умолчанию).
pub const DEFAULT_HOST: &str = "192.168.4.1";
/// Больше области app (2 МБ) образ не бывает.
pub const IMAGE_MAX: usize = 2 * 1024 * 1024;
const BOUNDARY: &str = "----openplane-ota-7f3a9c";
const CHUNK: usize = 4096;

/// Ответ `GET /ota`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OtaStatus {
    pub board: String,
    pub commit: String,
    pub config: String,
    pub open: bool,
    pub left_ms: u64,
    pub receiving: bool,
    pub armed: bool,
}

fn addr(host: &str) -> Res<SocketAddr> {
    let with_port = if host.contains(':') { host.to_string() } else { format!("{host}:80") };
    with_port
        .to_socket_addrs()
        .map_err(|e| format!("NO_BOARD: адрес {host}: {e}"))?
        .next()
        .ok_or_else(|| format!("NO_BOARD: адрес {host}"))
}

fn connect(host: &str, timeout: Duration) -> Res<TcpStream> {
    let stream = TcpStream::connect_timeout(&addr(host)?, timeout).map_err(|e| format!("NO_BOARD: {host} не отвечает ({e})"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(20)));
    Ok(stream)
}

/// Код и тело HTTP-ответа (без chunked: WebServer ESP32 отвечает с Content-Length).
pub fn parse_response(raw: &[u8]) -> Res<(u16, String)> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text.split_once("\r\n\r\n").ok_or("плата ответила не HTTP")?;
    let code = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or("плата ответила не HTTP")?;
    Ok((code, body.to_string()))
}

fn read_all(mut stream: TcpStream) -> Res<Vec<u8>> {
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).map_err(|e| format!("NO_ANSWER: ответ платы ({e})"))?;
    Ok(raw)
}

/// `GET /ota`: паспорт прошивки и окно.
pub fn status(host: &str, timeout: Duration) -> Res<OtaStatus> {
    let mut stream = connect(host, timeout)?;
    let _ = stream.set_read_timeout(Some(timeout.max(Duration::from_secs(2))));
    write!(stream, "GET /ota HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").map_err(|e| format!("NO_BOARD: {e}"))?;
    let (code, body) = parse_response(&read_all(stream)?)?;
    if code == 404 {
        return Err("NO_OTA: на плате прошивка без WiFi-обновления — один раз прошейте по USB".into());
    }
    if code != 200 {
        return Err(format!("NO_OTA: плата ответила {code}"));
    }
    serde_json::from_str(&body).map_err(|e| format!("NO_OTA: не наша плата ({e})"))
}

/// Начало и конец формы вокруг байтов образа.
pub fn multipart(file_name: &str) -> (String, String) {
    let name: String = file_name.chars().filter(|c| c.is_ascii_graphic() && *c != '"' && *c != '\\').collect();
    let name = if name.is_empty() { "firmware.bin".to_string() } else { name };
    let head = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"firmware\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
    );
    let tail = format!("\r\n--{BOUNDARY}--\r\n");
    (head, tail)
}

/// Первый байт образа приложения ESP32 (esp_image_header_t.magic).
pub const ESP_IMAGE_MAGIC: u8 = 0xE9;

/// `POST /update`: отправить образ. `progress(доля 0..1)` — по мере отправки.
/// Ок — `Ok(())`, иначе ошибка с кодом платы впереди (`CLOSED: …`, `ARMED: …`).
pub fn upload(host: &str, file_name: &str, image: &[u8], mut progress: impl FnMut(f32)) -> Res<()> {
    if image.is_empty() || image.len() > IMAGE_MAX {
        return Err(format!("TOO_BIG: файл {} байт — не прошивка ESP32", image.len()));
    }
    if image[0] != ESP_IMAGE_MAGIC {
        return Err("NOT_ESP: файл не прошивка ESP32 (нет заголовка образа)".into());
    }
    let (head, tail) = multipart(file_name);
    let len = head.len() + image.len() + tail.len();
    let mut stream = connect(host, Duration::from_secs(5))?;
    // стирание флеша на плате держит приём — ждём ответа подольше
    let _ = stream.set_read_timeout(Some(Duration::from_secs(60)));
    let request = format!(
        "POST /update HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nContent-Type: multipart/form-data; boundary={BOUNDARY}\r\nContent-Length: {len}\r\n\r\n{head}"
    );
    let broken = |e: std::io::Error| format!("LOST: связь с платой оборвалась ({e})");
    stream.write_all(request.as_bytes()).map_err(broken)?;
    progress(0.0);
    let mut sent = 0;
    for chunk in image.chunks(CHUNK) {
        if let Err(e) = stream.write_all(chunk) {
            // плата могла ответить отказом и закрыть сокет — прочитать её код
            if let Ok((code, body)) = read_all(stream).and_then(|r| parse_response(&r)) {
                return Err(board_error(code, &body));
            }
            return Err(broken(e));
        }
        sent += chunk.len();
        progress(sent as f32 / image.len() as f32);
    }
    stream.write_all(tail.as_bytes()).map_err(broken)?;
    let (code, body) = parse_response(&read_all(stream)?)?;
    if code == 200 && body.trim() == "OK" {
        return Ok(());
    }
    Err(board_error(code, &body))
}

/// "ARMED" → "ARMED: …", "IMAGE Magic byte is wrong" → "IMAGE: Magic byte is wrong".
fn board_error(code: u16, body: &str) -> String {
    let body = body.trim();
    if code == 404 {
        return "NO_OTA: на плате прошивка без WiFi-обновления — один раз прошейте по USB".into();
    }
    let (key, rest) = body.split_once(' ').unwrap_or((body, ""));
    let key = if key.is_empty() { format!("HTTP{code}") } else { key.to_string() };
    if rest.is_empty() {
        format!("{key}: плата ответила {code}")
    } else {
        format!("{key}: {rest}")
    }
}

/// После "OK" плата перезагружается (~1 с) и поднимает точку заново:
/// ждать, пока `GET /ota` снова ответит, до `timeout`.
pub fn wait_back(host: &str, timeout: Duration) -> Res<OtaStatus> {
    let started = Instant::now();
    std::thread::sleep(Duration::from_millis(1500));
    let mut last = String::new();
    while started.elapsed() < timeout {
        match status(host, Duration::from_secs(2)) {
            Ok(s) => return Ok(s),
            Err(e) => last = e,
        }
        std::thread::sleep(Duration::from_millis(700));
    }
    Err(format!("NO_RETURN: плата не вернулась в сеть за {} с ({last})", timeout.as_secs()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// Фейковая плата: принимает одно соединение, отдаёт `reply(запрос)`.
    fn board(reply: impl Fn(&[u8]) -> String + Send + 'static) -> (String, thread::JoinHandle<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let host = listener.local_addr().unwrap().to_string();
        let handle = thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 8192];
            loop {
                match s.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        got.extend_from_slice(&buf[..n]);
                        let text = String::from_utf8_lossy(&got);
                        if text.starts_with("GET") && text.contains("\r\n\r\n") {
                            break;
                        }
                        if text.contains(&format!("--{BOUNDARY}--")) {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let body = reply(&got);
            let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
            got
        });
        (host, handle)
    }

    #[test]
    fn status_reads_passport_and_window() {
        let (host, h) = board(|_| r#"{"board":"esp32-s3","commit":"abc","config":"c0ffee","open":true,"left_ms":120000,"receiving":false,"armed":false}"#.into());
        let s = status(&host, Duration::from_secs(2)).unwrap();
        assert_eq!(s.board, "esp32-s3");
        assert!(s.open && !s.armed);
        assert_eq!(s.left_ms, 120000);
        let req = String::from_utf8(h.join().unwrap()).unwrap();
        assert!(req.starts_with("GET /ota HTTP/1.1\r\n"));
    }

    #[test]
    fn upload_sends_multipart_and_reports_progress() {
        let (host, h) = board(|_| "OK".into());
        let mut image = vec![0u8; 10_000];
        image[0] = ESP_IMAGE_MAGIC;
        image[9_999] = 0x5A;
        let mut steps = Vec::new();
        upload(&host, "Планер-esp32-s3.bin", &image, |f| steps.push(f)).unwrap();
        assert_eq!(steps.first(), Some(&0.0));
        assert_eq!(steps.last(), Some(&1.0));
        let req = h.join().unwrap();
        let text = String::from_utf8_lossy(&req);
        assert!(text.starts_with("POST /update HTTP/1.1\r\n"));
        assert!(text.contains("name=\"firmware\"; filename=\"-esp32-s3.bin\""), "кириллица из имени выброшена");
        // Content-Length совпадает с телом
        let (head, body) = text.split_once("\r\n\r\n").unwrap();
        let len: usize = head.lines().find_map(|l| l.strip_prefix("Content-Length: ")).unwrap().parse().unwrap();
        assert_eq!(len, req.len() - head.len() - 4);
        assert!(body.ends_with(&format!("\r\n--{BOUNDARY}--\r\n")));
    }

    #[test]
    fn upload_refuses_non_esp_image_before_network() {
        let err = upload("127.0.0.1:1", "x.bin", &[0x00, 1, 2], |_| {}).unwrap_err();
        assert!(err.starts_with("NOT_ESP"), "{err}");
        let err = upload("127.0.0.1:1", "x.bin", &[], |_| {}).unwrap_err();
        assert!(err.starts_with("TOO_BIG"), "{err}");
    }

    #[test]
    fn board_refusal_codes_come_first() {
        assert_eq!(board_error(403, "CLOSED"), "CLOSED: плата ответила 403");
        assert_eq!(board_error(400, "IMAGE Magic byte is wrong"), "IMAGE: Magic byte is wrong");
        assert!(board_error(404, "404 - Not Found").starts_with("NO_OTA"));
        assert_eq!(board_error(500, ""), "HTTP500: плата ответила 500");
    }

    #[test]
    fn parse_response_needs_http() {
        assert_eq!(parse_response(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 5\r\n\r\nARMED").unwrap(), (403, "ARMED".into()));
        assert!(parse_response(b"garbage").is_err());
    }

    #[test]
    fn status_without_board_is_no_board() {
        // порт, где никто не слушает
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().to_string();
        let err = status(&free, Duration::from_millis(300)).unwrap_err();
        assert!(err.starts_with("NO_BOARD"), "{err}");
    }
}
