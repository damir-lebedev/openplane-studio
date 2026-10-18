//! Кто держит COM-порт (монитор порта PlatformIO) и есть ли драйвер DFU.

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::util::{command, run_capture, Res};

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
