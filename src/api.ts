// Команды Rust-части приложения (src-tauri/src/lib.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

import { Manifest } from "./core/manifest";
import { FirmwareConfig, PlaneProject } from "./core/project";

export interface AppInfo {
  version: string;
  platform: string;
  hangar_dir: string;
  cache_dir: string;
  pio: string | null;
  python: string | null;
  firmware_guess: string | null;
}

export interface Settings {
  firmwareSource?: string;
  mode?: "simple" | "full";
  currentPlane?: string;
}

export interface Device {
  kind: "stm32-cdc" | "stm32-dfu" | "esp32-usb" | "usb-serial" | "serial";
  port: string | null;
  vid: number | null;
  pid: number | null;
  product: string | null;
  manufacturer: string | null;
  serial: string | null;
  title: string;
}

export interface Identity {
  fw: string;
  proto: number;
  board: string;
  commit: string;
  config: string;
  plane: string;
  armed: boolean;
}

export interface TaskResult {
  ok: boolean;
  code: number;
  tail: string;
  firmware: string | null;
}

export interface ApplyResult {
  ok: boolean;
  errors?: string[];
  changed?: string[];
  board?: string;
}

export interface PortHolder {
  pid: number;
  name: string;
  command: string;
}

export interface DriverStatus {
  present: boolean;
  ok: boolean;
  status: string;
  problem: number | null;
}

export interface LogLine {
  task: string;
  stream: "out" | "err";
  line: string;
}

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  settingsLoad: () => invoke<Settings>("settings_load"),
  settingsSave: (settings: Settings) => invoke<void>("settings_save", { settings }),
  hangarList: () => invoke<PlaneProject[]>("hangar_list"),
  hangarSave: (plane: PlaneProject) => invoke<void>("hangar_save", { plane }),
  hangarRemove: (id: string) => invoke<void>("hangar_remove", { id }),
  hangarSnapshot: (id: string, label: string, data: unknown) => invoke<string>("hangar_snapshot", { id, label, data }),
  firmwareDescribe: (source: string) => invoke<Manifest>("firmware_describe", { source }),
  firmwareCommit: (source: string) => invoke<string | null>("firmware_commit", { source }),
  firmwareFetchGithub: () => invoke<string>("firmware_fetch_github"),
  firmwarePrepare: (source: string, planeId: string) =>
    invoke<{ dir: string; copied: number; removed: number }>("firmware_prepare", { source, planeId }),
  firmwareApply: (source: string, dir: string, config: FirmwareConfig) =>
    invoke<ApplyResult>("firmware_apply", { source, dir, config }),
  firmwareBuild: (dir: string, env: string) => invoke<TaskResult>("firmware_build", { dir, env }),
  firmwareUpload: (dir: string, env: string, port: string | null) =>
    invoke<TaskResult>("firmware_upload", { dir, env, port }),
  devicesList: () => invoke<Device[]>("devices_list"),
  boardIdentity: (port: string, stm32: boolean) => invoke<Identity | null>("board_identity", { port, stm32 }),
  boardBootloader: (port: string) => invoke<void>("board_bootloader", { port }),
  portHolders: () => invoke<PortHolder[]>("port_holders"),
  portHoldersKill: (pids: number[]) => invoke<number>("port_holders_kill", { pids }),
  dfuDriverStatus: () => invoke<DriverStatus>("dfu_driver_status"),
};

export function onTaskLog(handler: (line: LogLine) => void): Promise<UnlistenFn> {
  return listen<LogLine>("task-log", (e) => handler(e.payload));
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
