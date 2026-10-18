//! Кто держит COM-порт (монитор порта PlatformIO) и есть ли драйвер DFU.

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

use crate::util::{cache_dir, command, err, run_capture, Res};

#[derive(Serialize)]
pub struct PortHolder {
    pub pid: u32,
    pub name: String,
    pub command: String,
}

fn is_monitor(cmd: &str) -> bool {
    let c = cmd.to_lowercase();
    (c.contains("pio") || c.contains("platformio")) && c.contains("device") && c.contains("monitor")
}

/// Процессы монитора порта PlatformIO (`pio device monitor`): он держит
/// COM-порт, и ни прошить, ни спросить плату нельзя.
pub fn port_holders() -> Vec<PortHolder> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut out = Vec::new();
    for (pid, p) in sys.processes() {
        let cmd = p.cmd().iter().map(|s| s.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");
        if is_monitor(&cmd) {
            out.push(PortHolder {
                pid: pid.as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                command: cmd.chars().take(160).collect(),
            });
        }
    }
    out
}

/// Закрыть только мониторы порта — чужие процессы не трогаем.
pub fn kill_port_holders(pids: &[u32]) -> Res<usize> {
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let mut killed = 0;
    for &pid in pids {
        if let Some(p) = sys.process(Pid::from_u32(pid)) {
            let cmd = p.cmd().iter().map(|s| s.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" ");
            if is_monitor(&cmd) && p.kill() {
                killed += 1;
            }
        }
    }
    Ok(killed)
}

#[derive(Serialize)]
pub struct DriverStatus {
    /// Плата в загрузчике видна Windows.
    pub present: bool,
    /// Драйвер стоит (Windows пишет Status = OK).
    pub ok: bool,
    pub status: String,
    pub problem: Option<i64>,
}

#[derive(Serialize)]
pub struct DriverInstall {
    pub ok: bool,
    /// Код libwdi (0 — успех) или -1000, если окно UAC закрыли.
    pub code: i64,
    pub message: String,
}

fn wdi_message(code: i64) -> &'static str {
    match code {
        0 => "Драйвер установлен",
        -4 => "Плата не в режиме прошивки — включите его и повторите",
        -6 | -9 => "Windows занята другой установкой драйвера — подождите и повторите",
        -7 => "Установка не уложилась во время",
        -14 | -1000 => "Установку отменили",
        -15 => "Нужны права администратора",
        -18 | -19 => "Windows не приняла подпись драйвера",
        _ => "Драйвер не установился",
    }
}

/// Поставить WinUSB для «STM32 BOOTLOADER» встроенным wdi-simple (libwdi):
/// INF, каталог, самоподписанный сертификат в доверенные — как Zadig. Одно
/// окно UAC. Плата должна быть в режиме прошивки.
pub fn install_dfu_driver(app: &AppHandle) -> Res<DriverInstall> {
    if !cfg!(windows) {
        return Ok(DriverInstall { ok: true, code: 0, message: "На этой системе драйвер не нужен".into() });
    }
    let exe = app
        .path()
        .resolve("resources/wdi-simple.exe", BaseDirectory::Resource)
        .map_err(err("ресурсы приложения"))?;
    if !exe.is_file() {
        return Err(format!("нет установщика драйвера: {}", exe.display()));
    }
    let dest = cache_dir(app)?.join("driver");
    std::fs::create_dir_all(&dest).map_err(err("папка драйвера"))?;
    let q = |s: &str| s.replace('\'', "''");
    let args = format!(
        "--vid 0x0483 --pid 0xDF11 --name \"STM32 BOOTLOADER\" --manufacturer \"STMicroelectronics\" --type 0 --dest \"{}\" --progressbar --timeout 120000",
        dest.display()
    );
    let script = format!(
        "try {{ $p = Start-Process -FilePath '{}' -ArgumentList '{}' -Verb RunAs -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode }} catch {{ exit -1000 }}",
        q(&exe.to_string_lossy()),
        q(&args)
    );
    let mut cmd = command("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    let out = run_capture(cmd, None)?;
    let code = out.code as i64;
    Ok(DriverInstall { ok: code == 0, code, message: wdi_message(code).into() })
}

/// Настоящий Python 3 (а не заглушка магазина Windows из WindowsApps).
fn real_python() -> Option<std::path::PathBuf> {
    let mut candidates: Vec<std::path::PathBuf> = ["python", "python3", "py"]
        .iter()
        .filter_map(|n| crate::util::which(n))
        .filter(|p| !p.to_string_lossy().contains("WindowsApps"))
        .collect();
    // Только что поставленный winget'ом Python ещё не в PATH этого процесса.
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let base = std::path::PathBuf::from(local).join("Programs").join("Python");
        if let Ok(dirs) = std::fs::read_dir(&base) {
            let mut found: Vec<_> = dirs.flatten().map(|d| d.path().join("python.exe")).filter(|p| p.is_file()).collect();
            found.sort();
            candidates.extend(found.into_iter().rev());
        }
    }
    candidates.into_iter().find(|p| {
        let mut cmd = command(p);
        cmd.args(["-c", "import sys, venv; print(sys.version_info[0])"]);
        run_capture(cmd, None).map(|o| o.code == 0 && o.stdout.trim() == "3").unwrap_or(false)
    })
}

/// Поставить PlatformIO официальным установщиком (get-platformio.py) в
/// ~/.platformio; нет Python — сначала Python через winget. Вывод — событиями
/// "task-log" с task = "pio-install". Возвращает путь к pio.
pub fn install_platformio(app: &AppHandle) -> Res<String> {
    use crate::util::{find_pio, run_streaming};
    if let Some(pio) = find_pio() {
        return Ok(pio.to_string_lossy().into_owned());
    }
    let python = match real_python() {
        Some(p) => p,
        None => {
            let mut cmd = command("winget");
            cmd.args([
                "install", "--id", "Python.Python.3.13", "--exact", "--silent", "--scope", "user",
                "--accept-package-agreements", "--accept-source-agreements",
            ]);
            let (code, tail) = run_streaming(app, "pio-install", cmd).map_err(|e| format!("winget: {e}"))?;
            if code != 0 {
                return Err(format!("Python не установился (winget, код {code}): {}", tail.lines().last().unwrap_or("")));
            }
            real_python().ok_or("Python установился, но не найден — перезапустите приложение")?
        }
    };
    let dir = cache_dir(app)?.join("installer");
    std::fs::create_dir_all(&dir).map_err(err("папка установщика"))?;
    let script = dir.join("get-platformio.py");
    let mut cmd = command(&python);
    cmd.args([
        "-c",
        "import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])",
        "https://raw.githubusercontent.com/platformio/platformio-core-installer/master/get-platformio.py",
    ])
    .arg(&script);
    let out = run_capture(cmd, None)?;
    if out.code != 0 {
        return Err(format!("не скачался установщик PlatformIO: {}", out.stderr.trim()));
    }
    let mut cmd = command(&python);
    cmd.arg(&script);
    let (code, tail) = run_streaming(app, "pio-install", cmd)?;
    if code != 0 {
        return Err(format!("PlatformIO не установился (код {code}): {}", tail.lines().last().unwrap_or("")));
    }
    find_pio()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "установщик отработал, но pio не найден".to_string())
}

/// Драйвер WinUSB у «STM32 BOOTLOADER» (0483:DF11). Без него dfu-util
/// плату не видит, хотя Windows её показывает.
pub fn dfu_driver() -> Res<DriverStatus> {
    if !cfg!(windows) {
        return Ok(DriverStatus { present: true, ok: true, status: "OK".into(), problem: None });
    }
    let script = "$d = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | \
                  Where-Object { $_.InstanceId -like 'USB\\VID_0483&PID_DF11*' } | Select-Object -First 1; \
                  if ($d) { $p = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data; \
                  Write-Output ($d.Status + '|' + $p) } else { Write-Output 'ABSENT|' }";
    let mut cmd = command("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    let out = run_capture(cmd, None)?;
    let line = out.stdout.trim().to_string();
    let (status, problem) = line.split_once('|').unwrap_or((line.as_str(), ""));
    Ok(DriverStatus {
        present: status != "ABSENT",
        ok: status == "OK",
        status: status.to_string(),
        problem: problem.trim().parse().ok(),
    })
}
