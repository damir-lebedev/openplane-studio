//! Прошивка STM32 через системный загрузчик USB DFU (0483:DF11, протокол
//! DfuSe — расширение ST: команды «стереть сектор» 0x41 и «адрес» 0x21).
//!
//! Здесь только протокол и проверки — без USB: передачи делает `Transport`
//! (на Android — Kotlin-плагин по USB-OTG, usb_android.rs; в тестах — фейк
//! загрузчика). Поведение — по AN3156 (ST) и нашему веб-флешеру (git
//! 4b93d79:tools/web-flasher/flasher.js); код чужих конфигураторов не брали.
//!
//! Главное правило: стираются только секторы под образ, и образ не может
//! заходить в сектор настроек коптера (H743 — 0x081E0000, F405 — 0x080E0000).

// На ПК прошивка идёт через PlatformIO (dfu-util), модуль нужен телефону и тестам.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::time::Duration;

use crate::util::Res;

pub const FLASH_BASE: u32 = 0x0800_0000;
/// Начало сектора настроек коптера (Params): прошивка туда не пишет.
pub const LIMIT_H743: u32 = 0x081E_0000;
pub const LIMIT_F405: u32 = 0x080E_0000;

const DNLOAD: u8 = 1;
const UPLOAD: u8 = 2;
const GETSTATUS: u8 = 3;
const CLRSTATUS: u8 = 4;
const ABORT: u8 = 6;

const ST_IDLE: u8 = 2;
const ST_DNBUSY: u8 = 4;
const ST_DNLOAD_IDLE: u8 = 5;
const ST_MANIFEST: u8 = 7;
const ST_ERROR: u8 = 10;

const CMD_ERASE: u8 = 0x41;
const CMD_ADDRESS: u8 = 0x21;

/// Сектор флеша из строки интерфейса загрузчика.
#[derive(Debug, Clone, PartialEq)]
pub struct Sector {
    pub start: u32,
    pub size: u32,
    pub erasable: bool,
    pub writable: bool,
}

/// "@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg" → секторы.
pub fn parse_layout(desc: &str) -> Vec<Sector> {
    let mut out = Vec::new();
    // сегменты: "/<адрес>/<группы>"; после адреса может идти следующий "/0x…"
    let parts: Vec<&str> = desc.split('/').collect();
    let mut i = 1;
    while i + 1 < parts.len() {
        let addr_text = parts[i].trim();
        let Some(hex) = addr_text.strip_prefix("0x").or_else(|| addr_text.strip_prefix("0X")) else {
            i += 1;
            continue;
        };
        let Ok(mut addr) = u32::from_str_radix(hex, 16) else {
            i += 1;
            continue;
        };
        for group in parts[i + 1].split(',') {
            // "04*016Kg": количество * размер, множитель (пробел/B/K/M), буква прав a..g
            let g = group.trim();
            let Some((count, rest)) = g.split_once('*') else { continue };
            let Ok(count) = count.trim().parse::<u32>() else { continue };
            let rest = rest.trim();
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            let Ok(size) = digits.parse::<u32>() else { continue };
            let tail: Vec<char> = rest[digits.len()..].chars().collect();
            let (mult, perm) = match tail.as_slice() {
                [m, p, ..] if matches!(m, ' ' | 'B' | 'K' | 'M') && p.is_ascii_lowercase() => (*m, *p),
                [p, ..] if p.is_ascii_lowercase() => (' ', *p),
                _ => continue,
            };
            let size = size
                * match mult {
                    'K' => 1024,
                    'M' => 1024 * 1024,
                    _ => 1,
                };
            let p = (perm as u8).wrapping_sub(b'a' - 1);
            for _ in 0..count {
                out.push(Sector { start: addr, size, erasable: p & 2 != 0, writable: p & 4 != 0 });
                addr = addr.wrapping_add(size);
            }
        }
        i += 2;
    }
    out
}

/// Какой это чип — по карте флеша: F405 (16K-секторы, ≤1 МБ), H743 (128K, 2 МБ).
pub fn chip_from_layout(sectors: &[Sector]) -> &'static str {
    let total: u64 = sectors.iter().map(|s| s.size as u64).sum();
    match sectors.first() {
        Some(s) if s.size == 16 * 1024 && total <= 1024 * 1024 => "f405",
        Some(s) if s.size == 128 * 1024 && total == 2 * 1024 * 1024 => "h743",
        _ => "unknown",
    }
}

pub fn limit_for(chip: &str) -> Option<u32> {
    match chip {
        "f405" => Some(LIMIT_F405),
        "h743" => Some(LIMIT_H743),
        _ => None,
    }
}

/// Размер блока передачи из функционального DFU-дескриптора (тип 0x21)
/// в сырых дескрипторах устройства; нет — None.
pub fn transfer_size(raw: &[u8]) -> Option<u16> {
    let mut o = 0;
    while o + 1 < raw.len() {
        let len = raw[o] as usize;
        if len == 0 {
            break;
        }
        if raw[o + 1] == 0x21 && len >= 7 && o + 6 < raw.len() {
            return Some(u16::from_le_bytes([raw[o + 5], raw[o + 6]]));
        }
        o += len;
    }
    None
}

/// Интерфейс DFU, который выбрал телефон/ПК.
#[derive(Debug, Clone)]
pub struct Alt {
    pub interface: u8,
    pub alt: u8,
    pub name: String,
}

/// Альтернатива "@Internal Flash" среди интерфейсов загрузчика.
pub fn pick_internal_flash(alts: &[Alt]) -> Option<&Alt> {
    alts.iter().find(|a| a.name.to_ascii_lowercase().contains("internal flash"))
}

/// USB-передачи класса DFU к выбранному интерфейсу.
pub trait Transport {
    fn control_out(&mut self, request: u8, value: u16, data: &[u8]) -> Res<()>;
    fn control_in(&mut self, request: u8, value: u16, len: usize) -> Res<Vec<u8>>;
    fn sleep(&mut self, d: Duration) {
        std::thread::sleep(d);
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Status {
    pub status: u8,
    pub poll_ms: u32,
    pub state: u8,
}

/// Этап и доля (0..1) — для полосы прогресса.
pub type Progress<'a> = &'a mut dyn FnMut(&str, f32);

pub struct Dfu<T: Transport> {
    pub t: T,
    pub sectors: Vec<Sector>,
    pub chip: &'static str,
    pub xfer: usize,
}

impl<T: Transport> Dfu<T> {
    pub fn new(t: T, layout: &str, xfer: Option<u16>) -> Self {
        let sectors = parse_layout(layout);
        let chip = chip_from_layout(&sectors);
        let xfer = xfer.filter(|&x| x >= 64).unwrap_or(1024) as usize;
        Dfu { t, sectors, chip, xfer }
    }

    fn status(&mut self) -> Res<Status> {
        let d = self.t.control_in(GETSTATUS, 0, 6)?;
        if d.len() < 5 {
            return Err(format!("DFU: короткий ответ GETSTATUS ({} байт)", d.len()));
        }
        Ok(Status { status: d[0], poll_ms: u32::from_le_bytes([d[1], d[2], d[3], 0]), state: d[4] })
    }

    fn poll_until(&mut self, done: impl Fn(u8) -> bool) -> Res<Status> {
        let mut st = self.status()?;
        let mut guard = 0;
        while !done(st.state) && st.state != ST_ERROR {
            guard += 1;
            if guard > 2000 {
                return Err(format!("DFU: загрузчик завис в состоянии {}", st.state));
            }
            self.t.sleep(Duration::from_millis(st.poll_ms.clamp(5, 5000) as u64));
            st = self.status()?;
        }
        Ok(st)
    }

    fn to_idle(&mut self) -> Res<()> {
        let mut st = self.status()?;
        if st.state == ST_ERROR {
            self.t.control_out(CLRSTATUS, 0, &[])?;
            st = self.status()?;
        }
        if st.state != ST_IDLE {
            self.t.control_out(ABORT, 0, &[])?;
            st = self.status()?;
        }
        if st.state == ST_ERROR {
            self.t.control_out(CLRSTATUS, 0, &[])?;
            st = self.status()?;
        }
        if st.state != ST_IDLE {
            return Err(format!("DFU: загрузчик не готов (состояние {})", st.state));
        }
        Ok(())
    }

    fn command(&mut self, cmd: u8, addr: u32) -> Res<()> {
        let a = addr.to_le_bytes();
        self.t.control_out(DNLOAD, 0, &[cmd, a[0], a[1], a[2], a[3]])?;
        let st = self.poll_until(|s| s != ST_DNBUSY)?;
        if st.status != 0 || st.state == ST_ERROR {
            let what = if cmd == CMD_ERASE { "стирание" } else { "адрес" };
            return Err(format!("DFU: {what} 0x{addr:08X} — ошибка {}", st.status));
        }
        Ok(())
    }

    /// Секторы, которые задевает образ [start, start+len).
    pub fn touched(&self, start: u32, len: usize) -> Vec<Sector> {
        let end = start as u64 + len as u64;
        self.sectors
            .iter()
            .filter(|s| (s.start as u64) < end && s.start as u64 + s.size as u64 > start as u64)
            .cloned()
            .collect()
    }

    /// Проверки до первого стирания: адрес, размер, предел настроек, чип.
    pub fn check(&self, start: u32, len: usize, want_chip: Option<&str>) -> Res<()> {
        if len == 0 {
            return Err("EMPTY_IMAGE: файл прошивки пустой".into());
        }
        if let Some(want) = want_chip {
            if self.chip != "unknown" && want != self.chip {
                return Err(format!(
                    "WRONG_CHIP: прошивка для {}, а на столе {}",
                    want.to_uppercase(),
                    self.chip.to_uppercase()
                ));
            }
        }
        if let Some(limit) = limit_for(self.chip) {
            if start as u64 + len as u64 > limit as u64 {
                return Err(format!(
                    "TOO_BIG: образ {} КБ заходит в сектор настроек (0x{limit:08X}) — не пишем",
                    len / 1024
                ));
            }
        }
        let touched = self.touched(start, len);
        let covered: u64 = touched.iter().map(|s| s.size as u64).sum();
        if touched.is_empty()
            || touched.iter().any(|s| !s.erasable || !s.writable)
            || touched[0].start > start
            || (touched[0].start as u64 + covered) < start as u64 + len as u64
        {
            return Err(format!("DFU: адреса 0x{start:08X}+{len} нельзя записать"));
        }
        Ok(())
    }

    /// Стереть нужные секторы, записать, сверить чтением. Образ дополняется
    /// 0xFF до кратного 32 байтам (слово флеша H7).
    pub fn flash(&mut self, start: u32, image: &[u8], want_chip: Option<&str>, progress: Progress) -> Res<()> {
        let mut data = image.to_vec();
        if data.len() % 32 != 0 {
            data.resize(data.len().div_ceil(32) * 32, 0xFF);
        }
        self.check(start, data.len(), want_chip)?;
        self.to_idle()?;
        let touched = self.touched(start, data.len());
        for (i, s) in touched.iter().enumerate() {
            progress("erase", i as f32 / touched.len() as f32);
            self.command(CMD_ERASE, s.start)?;
        }
        progress("erase", 1.0);
        let mut off = 0;
        while off < data.len() {
            progress("write", off as f32 / data.len() as f32);
            let end = (off + self.xfer).min(data.len());
            self.command(CMD_ADDRESS, start + off as u32)?;
            self.t.control_out(DNLOAD, 2, &data[off..end])?;
            let st = self.poll_until(|s| s == ST_DNLOAD_IDLE)?;
            if st.status != 0 || st.state == ST_ERROR {
                return Err(format!("DFU: запись 0x{:08X} — ошибка {}", start + off as u32, st.status));
            }
            off = end;
        }
        progress("write", 1.0);
        if let Some(bad) = self.verify(start, &data, progress)? {
            return Err(format!("VERIFY: не совпало по адресу 0x{bad:08X} — прошейте ещё раз"));
        }
        Ok(())
    }

    /// Сверка чтением (UPLOAD). Some(адрес) первого несовпавшего байта.
    pub fn verify(&mut self, start: u32, data: &[u8], progress: Progress) -> Res<Option<u32>> {
        self.to_idle()?;
        self.command(CMD_ADDRESS, start)?;
        self.t.control_out(ABORT, 0, &[])?;
        let mut off = 0;
        let mut block: u16 = 2;
        while off < data.len() {
            progress("verify", off as f32 / data.len() as f32);
            let want = self.xfer.min(data.len() - off);
            let got = self.t.control_in(UPLOAD, block, self.xfer)?;
            for i in 0..want {
                if got.get(i) != Some(&data[off + i]) {
                    return Ok(Some(start + (off + i) as u32));
                }
            }
            off += want;
            block = block.wrapping_add(1);
        }
        self.t.control_out(ABORT, 0, &[])?;
        progress("verify", 1.0);
        Ok(None)
    }

    /// Выйти из загрузчика в новую прошивку (manifest).
    pub fn leave(&mut self, start: u32) -> Res<()> {
        self.to_idle()?;
        self.command(CMD_ADDRESS, start)?;
        self.t.control_out(DNLOAD, 0, &[])?;
        // плата уходит в прошивку и может пропасть с шины посреди ответа — это успех
        let _ = self.poll_until(|s| s == ST_MANIFEST);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const H743: &str = "@Internal Flash   /0x08000000/16*128Kg";
    const F405: &str = "@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg";

    /// Системный загрузчик STM32 в памяти: флеш, состояния, команды DfuSe.
    struct FakeLoader {
        flash: Vec<u8>,
        sectors: Vec<Sector>,
        state: u8,
        status: u8,
        addr: u32,
        erased: Vec<u32>,
        busy_polls: u8,
        manifested: bool,
        corrupt_at: Option<usize>,
    }

    impl FakeLoader {
        fn new(layout: &str) -> Self {
            let sectors = parse_layout(layout);
            let total: u32 = sectors.iter().map(|s| s.size).sum();
            // флеш «грязный»: старые данные, чтобы запись без стирания была видна
            FakeLoader {
                flash: vec![0x5A; total as usize],
                sectors,
                state: ST_IDLE,
                status: 0,
                addr: 0,
                erased: Vec::new(),
                busy_polls: 0,
                manifested: false,
                corrupt_at: None,
            }
        }
        fn fail(&mut self) {
            self.state = ST_ERROR;
            self.status = 0x0A;
        }
    }

    impl Transport for &mut FakeLoader {
        fn control_out(&mut self, request: u8, value: u16, data: &[u8]) -> Res<()> {
            match request {
                CLRSTATUS => {
                    self.state = ST_IDLE;
                    self.status = 0;
                }
                ABORT => self.state = ST_IDLE,
                DNLOAD if value == 0 && data.is_empty() => self.state = ST_MANIFEST,
                DNLOAD if value == 0 => {
                    let addr = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
                    match data[0] {
                        CMD_ERASE => match self.sectors.iter().find(|s| s.start == addr) {
                            Some(s) => {
                                let o = (s.start - FLASH_BASE) as usize;
                                self.flash[o..o + s.size as usize].fill(0xFF);
                                self.erased.push(addr);
                            }
                            None => self.fail(),
                        },
                        CMD_ADDRESS => self.addr = addr,
                        _ => self.fail(),
                    }
                    if self.state != ST_ERROR {
                        self.state = ST_DNBUSY;
                        self.busy_polls = 2;
                    }
                }
                DNLOAD => {
                    // блок value: адрес = addr + (value-2)*xfer; у нас перед каждым блоком свой адрес
                    let o = (self.addr - FLASH_BASE) as usize;
                    for (i, b) in data.iter().enumerate() {
                        if self.flash[o + i] != 0xFF {
                            self.fail();
                            return Ok(());
                        }
                        self.flash[o + i] = *b;
                    }
                    self.state = ST_DNBUSY;
                    self.busy_polls = 1;
                }
                _ => return Err(format!("fake: неизвестный запрос {request}")),
            }
            Ok(())
        }

        fn control_in(&mut self, request: u8, value: u16, len: usize) -> Res<Vec<u8>> {
            match request {
                GETSTATUS => {
                    if self.state == ST_DNBUSY {
                        if self.busy_polls > 0 {
                            self.busy_polls -= 1;
                        } else {
                            self.state = ST_DNLOAD_IDLE;
                        }
                    }
                    if self.state == ST_MANIFEST {
                        self.manifested = true;
                    }
                    Ok(vec![self.status, 3, 0, 0, self.state, 0])
                }
                UPLOAD => {
                    let o = (self.addr - FLASH_BASE) as usize + (value as usize - 2) * len;
                    let mut out = self.flash[o..o + len].to_vec();
                    if let Some(c) = self.corrupt_at {
                        if c >= o && c < o + len {
                            out[c - o] ^= 0xFF;
                        }
                    }
                    Ok(out)
                }
                _ => Err(format!("fake: неизвестный запрос {request}")),
            }
        }

        fn sleep(&mut self, _d: Duration) {}
    }

    fn image(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i * 7 + 3) as u8).collect()
    }

    fn quiet() -> impl FnMut(&str, f32) {
        |_, _| {}
    }

    #[test]
    fn layouts_of_our_chips() {
        let h = parse_layout(H743);
        assert_eq!(h.len(), 16);
        assert_eq!(h[15].start, 0x081E_0000);
        assert!(h.iter().all(|s| s.erasable && s.writable && s.size == 128 * 1024));
        assert_eq!(chip_from_layout(&h), "h743");
        let f = parse_layout(F405);
        assert_eq!(f.len(), 12);
        assert_eq!(f[4], Sector { start: 0x0801_0000, size: 64 * 1024, erasable: true, writable: true });
        assert_eq!(f[11].start, 0x080E_0000);
        assert_eq!(chip_from_layout(&f), "f405");
        // option bytes "a" — только чтение
        let ob = parse_layout("@Option Bytes  /0x1FFFC000/01*016 a");
        assert_eq!(ob.len(), 1);
        assert!(!ob[0].erasable && !ob[0].writable);
        assert_eq!(chip_from_layout(&parse_layout("@Internal Flash /0x08000000/8*002Kg")), "unknown");
        assert!(parse_layout("мусор").is_empty());
    }

    #[test]
    fn transfer_size_from_functional_descriptor() {
        // интерфейс (9 байт) + функциональный DFU 0x21: attrs, timeout, wTransferSize=2048
        let raw = [9, 4, 0, 0, 0, 0xFE, 1, 2, 4, 9, 0x21, 0x0B, 0xFF, 0, 0x00, 0x08, 0x1A, 0x01];
        assert_eq!(transfer_size(&raw), Some(2048));
        assert_eq!(transfer_size(&raw[..9]), None);
        assert_eq!(transfer_size(&[0, 0, 0]), None);
    }

    #[test]
    fn picks_internal_flash_alt() {
        let alts = vec![
            Alt { interface: 0, alt: 1, name: "@Option Bytes /0x5200201C/01*128 e".into() },
            Alt { interface: 0, alt: 0, name: "@Internal Flash /0x08000000/16*128Kg".into() },
        ];
        assert_eq!(pick_internal_flash(&alts).unwrap().alt, 0);
        assert!(pick_internal_flash(&alts[..1]).is_none());
    }

    #[test]
    fn h743_flash_writes_verifies_and_keeps_settings() {
        let mut fake = FakeLoader::new(H743);
        // в секторе настроек — данные пользователя
        let settings = (LIMIT_H743 - FLASH_BASE) as usize;
        fake.flash[settings..settings + 4].copy_from_slice(b"PRMS");
        let img = image(300 * 1024 + 5);
        let mut phases = Vec::new();
        {
            let mut dfu = Dfu::new(&mut fake, H743, Some(2048));
            assert_eq!(dfu.chip, "h743");
            dfu.flash(FLASH_BASE, &img, Some("h743"), &mut |p, _| {
                if phases.last().map(|s: &String| s.as_str()) != Some(p) {
                    phases.push(p.to_string());
                }
            })
            .unwrap();
            dfu.leave(FLASH_BASE).unwrap();
        }
        assert_eq!(phases, ["erase", "write", "verify"]);
        // 300 КБ = 3 сектора по 128 КБ, остальные не стирались
        assert_eq!(fake.erased, vec![0x0800_0000, 0x0802_0000, 0x0804_0000]);
        assert_eq!(&fake.flash[..img.len()], &img[..]);
        // хвост до 32 байт — 0xFF
        assert!(fake.flash[img.len()..img.len().div_ceil(32) * 32].iter().all(|&b| b == 0xFF));
        assert_eq!(&fake.flash[settings..settings + 4], b"PRMS");
        assert!(fake.manifested);
    }

    #[test]
    fn f405_erases_only_small_sectors_under_image() {
        let mut fake = FakeLoader::new(F405);
        let img = image(40 * 1024);
        Dfu::new(&mut fake, F405, Some(2048)).flash(FLASH_BASE, &img, None, &mut quiet()).unwrap();
        assert_eq!(fake.erased, vec![0x0800_0000, 0x0800_4000, 0x0800_8000]);
        assert_eq!(&fake.flash[..img.len()], &img[..]);
    }

    #[test]
    fn refuses_image_into_settings_sector() {
        let mut fake = FakeLoader::new(H743);
        let img = image((LIMIT_H743 - FLASH_BASE) as usize + 1);
        let e = Dfu::new(&mut fake, H743, Some(2048)).flash(FLASH_BASE, &img, None, &mut quiet()).unwrap_err();
        assert!(e.starts_with("TOO_BIG"), "{e}");
        assert!(fake.erased.is_empty(), "ничего не стёрто до проверки");
        // ровно по предел — можно
        let mut fake = FakeLoader::new(F405);
        let img = image((LIMIT_F405 - FLASH_BASE) as usize);
        assert!(Dfu::new(&mut fake, F405, Some(2048)).check(FLASH_BASE, img.len(), None).is_ok());
        assert!(Dfu::new(&mut fake, F405, Some(2048)).check(FLASH_BASE, img.len() + 32, None).is_err());
    }

    #[test]
    fn refuses_wrong_chip_and_empty_image() {
        let mut fake = FakeLoader::new(F405);
        let dfu = Dfu::new(&mut fake, F405, None);
        assert!(dfu.check(FLASH_BASE, 1024, Some("h743")).unwrap_err().starts_with("WRONG_CHIP"));
        assert!(dfu.check(FLASH_BASE, 0, None).unwrap_err().starts_with("EMPTY_IMAGE"));
        assert!(dfu.check(0x2000_0000, 1024, None).is_err(), "ОЗУ — не флеш");
        assert_eq!(dfu.xfer, 1024, "нет функционального дескриптора — 1024");
    }

    #[test]
    fn recovers_from_error_state_and_reports_bad_verify() {
        let mut fake = FakeLoader::new(H743);
        fake.fail(); // загрузчик остался в ошибке после прошлой попытки
        fake.corrupt_at = Some(5000);
        let e = Dfu::new(&mut fake, H743, Some(2048)).flash(FLASH_BASE, &image(8192), None, &mut quiet()).unwrap_err();
        assert!(e.starts_with("VERIFY") && e.contains("0x08001388"), "{e}");
    }

    #[test]
    fn write_error_is_reported() {
        let mut fake = FakeLoader::new(H743);
        {
            let mut dfu = Dfu::new(&mut fake, H743, Some(2048));
            // пишем без стирания — загрузчик отвечает ошибкой
            dfu.to_idle().unwrap();
            dfu.command(CMD_ADDRESS, FLASH_BASE).unwrap();
            dfu.t.control_out(DNLOAD, 2, &[1, 2, 3]).unwrap();
            let st = dfu.poll_until(|s| s == ST_DNLOAD_IDLE).unwrap();
            assert_eq!(st.state, ST_ERROR);
        }
    }
}
