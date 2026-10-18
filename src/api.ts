// Команды Rust-части приложения (src-tauri/src/lib.rs).

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

import { Manifest } from "./core/manifest";
import { FirmwareFingerprint } from "./core/migrate";
import { FirmwareConfig, FlashRecord, PlaneProject } from "./core/project";

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

/** Живое состояние платы — строка "@live {...}" (AppLink.h прошивки). */
export interface LiveFrame {
  t: number;
  arm: boolean;
  mode: string;
  rx: "ok" | "lost" | "fs";
  ch: number[];
  /** элерон Л, элерон П, руль высоты, руль направления, газ, AUX1, AUX2 — мкс */
  out: [number, number, number, number, number, number, number];
  rev: boolean;
  imu: "ok" | "none" | "noresp" | "check";
  /** крен, тангаж, курс, ° */
  att?: [number, number, number];
  /** установка IMU измерена (три позы) */
  mount?: boolean;
  /** стоянка сохранена (наземная калибровка) */
  park?: boolean;
  baro: "ok" | "none" | "noresp";
  alt?: number;
  vz?: number;
  mag: "ok" | "none" | "noresp";
  hdg?: number;
  magcal?: boolean;
  gps: "ok" | "none" | "noresp";
  fix?: number;
  sats?: number;
  pitot: "ok" | "none" | "noresp";
  ias?: number;
  block: string | null;
  cal: "LEVEL" | "PARK" | null;
  feat: string[];
  hz: number;
}

/** Снимок самолёта на прошивку (Hangar/<id>/history). Старые — без plane. */
export interface Snapshot {
  file: string;
  record?: FlashRecord;
  config?: FirmwareConfig;
  plane?: PlaneProject;
  /** калибровки на плате до прошивки и после */
  calib?: { before: CalibFlags | null; after: CalibFlags | null };
  /** отпечаток прошивки, которой прошит самолёт: по нему видно, что поменялось в новой */
  firmware?: FirmwareFingerprint;
}

export interface CalibFlags {
  mount?: boolean;
  park?: boolean;
  magcal?: boolean;
}

export interface ScanResult {
  sensor?: { a: number; g: string }[];
  screen?: { a: number; g: string }[] | null;
  error?: string;
}

export interface LinkStatus {
  port: string;
  state: "open" | "closed" | "error";
  error: string | null;
}

export const STX = "\u0002";

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  settingsLoad: () => invoke<Settings>("settings_load"),
  settingsSave: (settings: Settings) => invoke<void>("settings_save", { settings }),
  hangarList: () => invoke<PlaneProject[]>("hangar_list"),
  hangarSave: (plane: PlaneProject) => invoke<void>("hangar_save", { plane }),
  hangarRemove: (id: string) => invoke<void>("hangar_remove", { id }),
  hangarSnapshot: (id: string, label: string, data: unknown) => invoke<string>("hangar_snapshot", { id, label, data }),
  hangarHistory: (id: string) => invoke<Snapshot[]>("hangar_history", { id }),
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
  dfuDriverInstall: () => invoke<{ ok: boolean; code: number; message: string }>("dfu_driver_install"),
  platformioInstall: () => invoke<string>("platformio_install"),
  linkStart: (port: string, stm32: boolean) => invoke<void>("link_start", { port, stm32 }),
  linkStop: () => invoke<void>("link_stop"),
  linkSend: (text: string) => invoke<void>("link_send", { text }),
  /** Команда ПК: STX, строка, перевод строки. */
  linkCommand: (command: string) => invoke<void>("link_send", { text: `${STX}${command}\n` }),
  linkPort: () => invoke<string | null>("link_port"),
};

export function onBoardEvents(handlers: {
  live: (port: string, data: LiveFrame) => void;
  id: (port: string, data: Identity) => void;
  scan: (port: string, data: ScanResult) => void;
  line: (port: string, line: string) => void;
  link: (status: LinkStatus) => void;
  /** прошивка на плате не умеет живые данные (старше приложения) */
  noLive: (port: string) => void;
}): Promise<UnlistenFn[]> {
  return Promise.all([
    listen<{ port: string; data: LiveFrame }>("board-live", (e) => handlers.live(e.payload.port, e.payload.data)),
    listen<{ port: string; data: Identity }>("board-id", (e) => handlers.id(e.payload.port, e.payload.data)),
    listen<{ port: string; data: ScanResult }>("board-scan", (e) => handlers.scan(e.payload.port, e.payload.data)),
    listen<{ port: string; line: string }>("board-line", (e) => handlers.line(e.payload.port, e.payload.line)),
    listen<LinkStatus>("board-link", (e) => handlers.link(e.payload)),
    listen<{ port: string }>("board-nolive", (e) => handlers.noLive(e.payload.port)),
  ]);
}

export function onTaskLog(handler: (line: LogLine) => void): Promise<UnlistenFn> {
  return listen<LogLine>("task-log", (e) => handler(e.payload));
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
