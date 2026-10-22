//! Подготовка компьютера: всё, без чего приложение не соберёт и не прошьёт
//! плату. Python и PlatformIO, исходники прошивки, инструменты сборки STM32 и
//! (на Windows) драйвер режима прошивки. Одни и те же шаги — из окна
//! приложения («Настройки», первое включение) и из установщика Windows
//! (`openplane-studio.exe --setup`, галочка «Установить всё необходимое»).
//!
//! Сначала — из установщика, без интернета: в ресурсах приложения папка
//! offline (tools/offline_bundle.py) — Python, колёса PlatformIO, исходники
//! прошивки, пакеты сборки STM32 и библиотеки прошивки. Чего там нет — из
//! интернета: Python ставит uv, PlatformIO — его официальный установщик.
//! Python в обоих случаях — своя копия в папке PlatformIO, без прав
//! администратора, без PATH и реестра: системный Python пользователя (или его
//! отсутствие) ни на что не влияет.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::source;
use crate::system;
use crate::util::{command, core_dir, err, find_pio, find_python, local_data_dir, run_capture, run_lines, Res};

/// Версия uv — закреплена: установщик не должен меняться сам по себе.
const UV_VERSION: &str = "0.12.21";
const PYTHON_VERSION: &str = "3.12";
const GET_PLATFORMIO: &str = "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py";
/// Среды прошивки на STM32 — их пакеты и библиотеки ставятся заранее.
const STM32_ENVS: &[&str] = &["stm32h743-devebox", "stm32h743", "matek-h743"];

pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Deserialize, Default, Clone)]
pub struct Options {
    /// Сразу скачать компилятор и ядро STM32 (около 2 ГБ на диске).
    #[serde(default)]
    pub tools: bool,
    /// Драйвер режима прошивки STM32 (только Windows; одно окно UAC).
    #[serde(default)]
    pub driver: bool,
    /// "en" — сообщения по-английски.
    #[serde(default)]
    pub lang: Option<String>,
}

#[derive(Serialize)]
pub struct Status {
    pub pio: Option<String>,
    pub python: Option<String>,
    /// Скачанные приложением исходники прошивки.
    pub source: Option<String>,
    /// Компилятор и ядро STM32 уже есть.
    pub tools: bool,
    /// Драйвер нужен на этой системе (Windows).
    pub driver_needed: bool,
    /// В установщике всё своё — интернет не нужен.
    pub offline: bool,
}

#[derive(Serialize)]
pub struct Report {
    pub pio: String,
    pub source: String,
    /// Что не получилось, но без чего можно жить (подтянется при первой прошивке).
    pub warnings: Vec<String>,
}

struct Ctx {
    log: Log,
    en: bool,
    data: PathBuf,
}

impl Ctx {
    fn say(&self, ru: &str, en: &str) {
        (self.log)(if self.en { en } else { ru });
    }
}

pub fn default_source(data: &Path) -> PathBuf {
    data.join("source").join("OpenPlaneProject")
}

fn tools_installed() -> bool {
    let p = core_dir().join("packages");
    p.join("framework-arduinoststm32").is_dir() && p.join("toolchain-gccarmnoneeabi").is_dir()
}

/// Папка offline в ресурсах приложения, если установщик её привёз.
fn offline_dir(resources: Option<&Path>) -> Option<PathBuf> {
    let dir = resources?.join("offline");
    dir.join("offline.json").is_file().then_some(dir)
}

pub fn status(data: &Path, resources: Option<&Path>) -> Status {
    let s = |p: PathBuf| p.to_string_lossy().into_owned();
    let src = default_source(data);
    Status {
        pio: find_pio().map(s),
        python: find_python().map(s),
        source: src.join("tools").join("opconfig.py").is_file().then(|| s(src)),
        tools: tools_installed(),
        driver_needed: cfg!(windows),
        offline: offline_dir(resources).is_some(),
    }
}

/// Распаковать архив (.tar.gz, .tar.xz) системным tar.
fn unpack(archive: &Path, dest: &Path) -> Res<()> {
    fs::create_dir_all(dest).map_err(err("папка распаковки"))?;
    let mut cmd = command(crate::util::system_tool("tar"));
    cmd.arg("-xf").arg(archive).arg("-C").arg(dest);
    let out = run_capture(cmd, None)?;
    if out.code != 0 {
        return Err(format!("{} не распаковался: {}", archive.display(), out.stderr.trim()));
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Библиотеки прошивки из установщика — в папку сборки, чтобы PlatformIO не шёл
/// за ними в сеть. Папка сборки уже со своими — не трогать.
pub fn seed_libdeps(build_dir: &Path, env: &str) {
    let target = build_dir.join(".pio").join("libdeps").join(env);
    let seed = local_data_dir().join("libdeps").join(env);
    if !target.exists() && seed.is_dir() {
        let _ = copy_dir(&seed, &target);
    }
}

/// Строки прогресса PlatformIO («Downloading [####   ] 45%») перерисовываются
/// десятки раз — в журнал идёт каждая четверть.
struct Throttle {
    last: Mutex<(String, i32)>,
}

impl Throttle {
    fn new() -> Self {
        Throttle { last: Mutex::new((String::new(), -100)) }
    }

    fn pass(&self, line: &str) -> bool {
        let t = line.trim();
        let (Some(open), true) = (t.find('['), t.ends_with('%')) else { return true };
        let prefix = t[..open].trim().to_string();
        let digits: String = t[..t.len() - 1].chars().rev().take_while(|c| c.is_ascii_digit()).collect();
        let pct: i32 = digits.chars().rev().collect::<String>().parse().unwrap_or(0);
        let mut last = self.last.lock().unwrap();
        if last.0 != prefix || pct >= last.1 + 25 || (pct == 100 && last.1 != 100) {
            *last = (prefix, pct);
            true
        } else {
            false
        }
    }
}

fn run_logged(ctx: &Ctx, cmd: std::process::Command) -> Res<(i32, String)> {
    let log = ctx.log.clone();
    let throttle = Arc::new(Throttle::new());
    run_lines(cmd, Arc::new(move |_stream: &str, line: &str| {
        if throttle.pass(line) {
            log(&format!("  {line}"));
        }
    }))
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn uv_asset() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("uv-x86_64-pc-windows-msvc.zip"),
        ("windows", "aarch64") => Some("uv-aarch64-pc-windows-msvc.zip"),
        ("macos", "aarch64") => Some("uv-aarch64-apple-darwin.tar.gz"),
        ("macos", "x86_64") => Some("uv-x86_64-apple-darwin.tar.gz"),
        ("linux", "x86_64") => Some("uv-x86_64-unknown-linux-gnu.tar.gz"),
        ("linux", "aarch64") => Some("uv-aarch64-unknown-linux-gnu.tar.gz"),
        _ => None,
    }
}

fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.is_dir() {
            if let Some(found) = find_file(&p, name) {
                return Some(found);
            }
        } else if p.file_name().is_some_and(|n| n == name) {
            return Some(p);
        }
    }
    None
}

/// uv — один файл: скачать архив и достать его.
fn uv(ctx: &Ctx) -> Res<PathBuf> {
    let dir = ctx.data.join("tools");
    let bin = dir.join(exe("uv"));
    if bin.is_file() {
        return Ok(bin);
    }
    let asset = uv_asset().ok_or("uv не собирается под эту систему")?;
    ctx.say("Скачиваю uv (ставит Python для PlatformIO)…", "Downloading uv (it installs Python for PlatformIO)…");
    let archive = dir.join(asset);
    source::download(&format!("https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/{asset}"), &archive)?;
    let unpack = dir.join("uv-unpack");
    let _ = fs::remove_dir_all(&unpack);
    fs::create_dir_all(&unpack).map_err(err("папка uv"))?;
    let mut cmd = command(crate::util::system_tool("tar"));
    cmd.arg("-xf").arg(&archive).arg("-C").arg(&unpack);
    let out = run_capture(cmd, None)?;
    if out.code != 0 {
        return Err(format!("архив uv не распаковался: {}", out.stderr.trim()));
    }
    let found = find_file(&unpack, &exe("uv")).ok_or("в архиве нет uv")?;
    fs::copy(&found, &bin).map_err(err("uv"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&bin, fs::Permissions::from_mode(0o755));
    }
    let _ = fs::remove_dir_all(&unpack);
    let _ = fs::remove_file(&archive);
    Ok(bin)
}

/// Python для PlatformIO: своя копия в папке PlatformIO (uv-python).
fn managed_python(ctx: &Ctx) -> Res<PathBuf> {
    let uv = uv(ctx)?;
    let install_dir = core_dir().join("uv-python");
    let with_env = |cmd: &mut std::process::Command| {
        cmd.env("UV_PYTHON_INSTALL_DIR", &install_dir).env("UV_CACHE_DIR", ctx.data.join("tools").join("uv-cache"));
    };
    let mut find = command(&uv);
    find.args(["python", "find", PYTHON_VERSION, "--managed-python"]);
    with_env(&mut find);
    if let Ok(out) = run_capture(find, None) {
        let p = PathBuf::from(out.stdout.trim());
        if out.code == 0 && p.is_file() {
            return Ok(p);
        }
    }
    ctx.say(&format!("Ставлю Python {PYTHON_VERSION} (около 30 МБ)…"), &format!("Installing Python {PYTHON_VERSION} (about 30 MB)…"));
    let mut install = command(&uv);
    install.args(["python", "install", PYTHON_VERSION, "--no-bin", "--no-registry"]);
    with_env(&mut install);
    let (code, tail) = run_logged(ctx, install)?;
    if code != 0 {
        return Err(format!("Python не установился (код {code}): {}", tail.lines().last().unwrap_or("")));
    }
    let mut find = command(&uv);
    find.args(["python", "find", PYTHON_VERSION, "--managed-python"]);
    with_env(&mut find);
    let out = run_capture(find, None)?;
    let p = PathBuf::from(out.stdout.trim());
    if out.code == 0 && p.is_file() {
        Ok(p)
    } else {
        Err("Python установился, но не найден".into())
    }
}

/// PlatformIO официальным установщиком (get-platformio.py) в ~/.platformio.
pub fn ensure_platformio(log: Log, lang_en: bool) -> Res<PathBuf> {
    let ctx = Ctx { log, en: lang_en, data: local_data_dir() };
    platformio(&ctx, None)
}

/// PlatformIO из установщика: Python распаковать, penv создать, колёса — pip без сети.
fn platformio_offline(ctx: &Ctx, offline: &Path) -> Res<PathBuf> {
    ctx.say("Ставлю PlatformIO из установщика — без интернета…", "Installing PlatformIO from the installer — no Internet needed…");
    let core = core_dir();
    let pyroot = core.join("uv-python");
    unpack(&offline.join("python.tar.gz"), &pyroot)?;
    let pydir = fs::read_dir(&pyroot)
        .map_err(err("Python"))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with(&format!("cpython-{PYTHON_VERSION}."))))
        .max()
        .ok_or("в установщике нет Python")?;
    let python = if cfg!(windows) { pydir.join("python.exe") } else { pydir.join("bin").join("python3") };
    let wheels = ctx.data.join("installer").join("wheels");
    let _ = fs::remove_dir_all(&wheels);
    unpack(&offline.join("wheels.tar.gz"), &wheels)?;
    let penv = core.join("penv");
    let _ = fs::remove_dir_all(&penv); // недоделанный прошлой попыткой
    let mut cmd = command(&python);
    cmd.args(["-m", "venv"]).arg(&penv);
    let (code, tail) = run_logged(ctx, cmd)?;
    if code != 0 {
        return Err(format!("не создалось окружение PlatformIO (код {code}): {}", tail.lines().last().unwrap_or("")));
    }
    let venv_python = crate::util::penv_scripts().join(exe("python"));
    let mut cmd = command(&venv_python);
    cmd.args(["-m", "pip", "install", "--no-index", "--find-links"]).arg(&wheels).arg("platformio");
    let (code, tail) = run_logged(ctx, cmd)?;
    let _ = fs::remove_dir_all(&wheels);
    if code != 0 {
        return Err(format!("PlatformIO не установился (код {code}): {}", tail.lines().last().unwrap_or("")));
    }
    find_pio().ok_or_else(|| "PlatformIO установился, но pio не найден".to_string())
}

fn platformio(ctx: &Ctx, offline: Option<&Path>) -> Res<PathBuf> {
    if let Some(pio) = find_pio() {
        ctx.say(&format!("PlatformIO уже установлен: {}", pio.display()), &format!("PlatformIO is already installed: {}", pio.display()));
        return Ok(pio);
    }
    if let Some(off) = offline {
        match platformio_offline(ctx, off) {
            Ok(pio) => {
                ctx.say(&format!("PlatformIO готов: {}", pio.display()), &format!("PlatformIO is ready: {}", pio.display()));
                return Ok(pio);
            }
            Err(e) => ctx.say(&format!("Из установщика не вышло ({e}) — пробую через интернет"), &format!("Could not install from the installer ({e}) — trying the Internet")),
        }
    }
    let python = match managed_python(ctx) {
        Ok(p) => p,
        Err(e) => {
            ctx.say(&format!("Свой Python не поставился ({e}) — пробую системный"), &format!("Could not install Python ({e}) — trying the system one"));
            system::real_python().ok_or(e)?
        }
    };
    ctx.say("Ставлю PlatformIO — им приложение собирает прошивку (несколько минут)…", "Installing PlatformIO — the app builds the firmware with it (a few minutes)…");
    let script = ctx.data.join("installer").join("get-platformio.py");
    source::download(GET_PLATFORMIO, &script)?;
    let mut cmd = command(&python);
    cmd.arg(&script);
    let (code, tail) = run_logged(ctx, cmd)?;
    if code != 0 {
        return Err(format!("PlatformIO не установился (код {code}): {}", tail.lines().last().unwrap_or("")));
    }
    let pio = find_pio().ok_or("установщик PlatformIO отработал, но pio не найден")?;
    ctx.say(&format!("PlatformIO готов: {}", pio.display()), &format!("PlatformIO is ready: {}", pio.display()));
    Ok(pio)
}

/// Исходники прошивки: уже скачанные — как есть; нет — из установщика, а без
/// него — с GitHub. Обновить до свежих — «Настройки» → «Скачать с GitHub».
fn firmware_source(ctx: &Ctx, offline: Option<&Path>) -> Res<PathBuf> {
    let root = ctx.data.join("source");
    let dest = default_source(&ctx.data);
    if dest.join("tools").join("opconfig.py").is_file() {
        ctx.say(&format!("Исходники прошивки уже есть: {}", dest.display()), &format!("Firmware sources are already here: {}", dest.display()));
        return Ok(dest);
    }
    fs::create_dir_all(&root).map_err(err("папка исходников"))?;
    if let Some(off) = offline {
        let _ = fs::remove_dir_all(&dest);
        match unpack(&off.join("firmware.tar.gz"), &root) {
            Ok(()) if dest.join("tools").join("opconfig.py").is_file() => {
                ctx.say(&format!("Исходники прошивки из установщика: {}", dest.display()), &format!("Firmware sources from the installer: {}", dest.display()));
                return Ok(dest);
            }
            Ok(()) => ctx.say("В установщике нет исходников — качаю с GitHub", "No sources in the installer — downloading from GitHub"),
            Err(e) => ctx.say(&format!("{e} — качаю с GitHub"), &format!("{e} — downloading from GitHub")),
        }
    }
    let log = ctx.log.clone();
    source::fetch(&root, None, &move |line: &str| log(line))
}

/// Библиотеки прошивки из установщика — в папку данных (seed_libdeps берёт их оттуда).
fn libdeps_offline(ctx: &Ctx, offline: &Path) {
    let dest = ctx.data.join("libdeps");
    if dest.is_dir() {
        return;
    }
    if let Err(e) = unpack(&offline.join("libdeps.tar.xz"), &dest) {
        let _ = fs::remove_dir_all(&dest);
        ctx.say(&format!("Библиотеки прошивки не распаковались ({e}) — скачаются при первой сборке"), &format!("Firmware libraries were not unpacked ({e}) — they will be downloaded on the first build"));
    }
}

fn build_tools(ctx: &Ctx, pio: &Path, source: &Path, offline: Option<&Path>) -> Res<()> {
    if let Some(off) = offline {
        libdeps_offline(ctx, off);
    }
    if tools_installed() {
        ctx.say("Инструменты сборки STM32 уже есть", "STM32 build tools are already installed");
        return Ok(());
    }
    if let Some(off) = offline {
        ctx.say(
            "Распаковываю инструменты сборки STM32 из установщика (около 2 ГБ на диске, без интернета)…",
            "Unpacking the STM32 build tools from the installer (about 2 GB on disk, no Internet needed)…",
        );
        match unpack(&off.join("pio-stm32.tar.xz"), &core_dir()) {
            Ok(()) if tools_installed() => {
                ctx.say("Инструменты сборки STM32 готовы", "STM32 build tools are ready");
                return Ok(());
            }
            Ok(()) => ctx.say("В установщике не всё — докачиваю", "The installer lacks some — downloading"),
            Err(e) => ctx.say(&format!("{e} — качаю из интернета"), &format!("{e} — downloading from the Internet")),
        }
    }
    ctx.say(
        "Скачиваю инструменты сборки STM32: компилятор и ядро (около 2 ГБ на диске; на медленном интернете — долго)…",
        "Downloading the STM32 build tools: compiler and core (about 2 GB on disk; slow on a slow connection)…",
    );
    let mut cmd = command(pio);
    cmd.args(["pkg", "install", "-d"]).arg(source);
    for env in STM32_ENVS {
        cmd.args(["-e", env]);
    }
    let (code, tail) = run_logged(ctx, cmd)?;
    if code != 0 {
        return Err(format!("инструменты не скачались (код {code}): {}", tail.lines().last().unwrap_or("")));
    }
    ctx.say("Инструменты сборки STM32 готовы", "STM32 build tools are ready");
    Ok(())
}

/// Всё по порядку. PlatformIO и исходники обязательны; инструменты и драйвер —
/// если не вышло, подтянутся при первой прошивке (предупреждение в отчёте).
pub fn run(resources: Option<PathBuf>, opts: &Options, log: Log) -> Res<Report> {
    let ctx = Ctx { log, en: opts.lang.as_deref() == Some("en"), data: local_data_dir() };
    fs::create_dir_all(&ctx.data).map_err(err("папка данных приложения"))?;
    let offline = offline_dir(resources.as_deref());
    if offline.is_some() {
        ctx.say("Всё нужное есть в установщике — интернет не понадобится.", "Everything needed is in the installer — no Internet required.");
    }
    let steps = 2 + opts.tools as usize + (opts.driver && cfg!(windows)) as usize;
    let mut step = 0;
    let mut next = |ru: &str, en: &str| {
        step += 1;
        ctx.say(&format!("[{step}/{steps}] {ru}"), &format!("[{step}/{steps}] {en}"));
    };

    next("PlatformIO", "PlatformIO");
    let pio = platformio(&ctx, offline.as_deref())?;
    next("Исходники прошивки", "Firmware sources");
    let source = firmware_source(&ctx, offline.as_deref())?;
    let mut warnings = Vec::new();
    if opts.tools {
        next("Инструменты сборки STM32", "STM32 build tools");
        if let Err(e) = build_tools(&ctx, &pio, &source, offline.as_deref()) {
            ctx.say(&format!("Не вышло: {e}. Скачаются при первой прошивке."), &format!("Failed: {e}. They will be downloaded on the first flash."));
            warnings.push(e);
        }
    }
    if opts.driver && cfg!(windows) {
        next("Драйвер режима прошивки STM32", "STM32 flashing-mode driver");
        // (по-русски, по-английски) — почему не вышло
        let failure = match resources.as_deref() {
            Some(r) => match system::preinstall_dfu_driver(&r.join("wdi-simple.exe"), &ctx.data.join("driver")) {
                Ok(r) if r.ok => None,
                Ok(r) => Some((r.message, format!("libwdi code {}", r.code))),
                Err(e) => Some((e.clone(), e)),
            },
            None => Some(("нет установщика драйвера".to_string(), "no driver installer".to_string())),
        };
        match failure {
            None => ctx.say("Драйвер установлен", "Driver installed"),
            Some((ru, en)) => {
                ctx.say(
                    &format!("Драйвер не установился: {ru}. Приложение предложит его при первой прошивке."),
                    &format!("Driver not installed ({en}). The app will offer it on the first flash."),
                );
                warnings.push(ru);
            }
        }
    }
    ctx.say("Готово — можно собирать и прошивать.", "Done — ready to build and flash.");
    Ok(Report {
        pio: pio.to_string_lossy().into_owned(),
        source: source.to_string_lossy().into_owned(),
        warnings,
    })
}

/// `openplane-studio --setup [--tools] [--driver] [--lang en] [--utf16] [--resources DIR]` —
/// для установщика: тот же run() без окна, вывод в stdout (установщик
/// Windows показывает его в журнале; --utf16 — его кодировка) и в setup.log.
/// Код выхода 0 — PlatformIO и исходники на месте.
pub fn cli(args: &[String]) -> i32 {
    let has = |flag: &str| args.iter().any(|a| a == flag);
    let lang = args.iter().position(|a| a == "--lang").and_then(|i| args.get(i + 1)).cloned();
    let utf16 = has("--utf16");
    let data = local_data_dir();
    let _ = fs::create_dir_all(&data);
    let file = Mutex::new(fs::OpenOptions::new().create(true).append(true).open(data.join("setup.log")).ok());
    let started = Mutex::new(false);
    let log: Log = Arc::new(move |line: &str| {
        let mut out = std::io::stdout().lock();
        if utf16 {
            let mut bytes = Vec::new();
            let mut first = started.lock().unwrap();
            if !*first {
                bytes.extend_from_slice(&[0xFF, 0xFE]);
                *first = true;
            }
            for u in format!("{line}\r\n").encode_utf16() {
                bytes.extend_from_slice(&u.to_le_bytes());
            }
            let _ = out.write_all(&bytes);
        } else {
            let _ = writeln!(out, "{line}");
        }
        let _ = out.flush();
        if let Some(f) = file.lock().unwrap().as_mut() {
            let _ = writeln!(f, "{line}");
        }
    });
    let opts = Options { tools: has("--tools"), driver: has("--driver"), lang };
    // --resources DIR — папка с offline/ (проверка без установки), иначе рядом с программой.
    let resources = args
        .iter()
        .position(|a| a == "--resources")
        .and_then(|i| args.get(i + 1))
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("resources"))));
    log(&format!("OpenPlane Studio {} — setup", env!("CARGO_PKG_VERSION")));
    match run(resources, &opts, log.clone()) {
        Ok(_) => 0,
        Err(e) => {
            log(&if opts.lang.as_deref() == Some("en") { format!("ERROR: {e}") } else { format!("ОШИБКА: {e}") });
            1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_are_thinned() {
        let t = Throttle::new();
        assert!(t.pass("Collecting platformio"));
        assert!(t.pass("Downloading  [------------------------------------]    0%"));
        assert!(!t.pass("Downloading  [###---------------------------------]   10%"));
        assert!(t.pass("Downloading  [#########---------------------------]   25%"));
        assert!(!t.pass("Downloading  [##########--------------------------]   30%"));
        assert!(t.pass("Downloading  [####################################]  100%"));
        assert!(t.pass("Unpacking  [###---------------------------------]   10%"));
    }
}
