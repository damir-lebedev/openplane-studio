// Что за полётник на USB (P02): какая прошивка — наша (@id), Betaflight и
// INAV (MSP), ArduPilot и PX4 (MAVLink HEARTBEAT), голая плата в DFU; какая
// это плата в нашей базе; что нашлось на борту по дампу CLI родной
// прошивки; что из её diff не переносится и почему.

import type { Device, FcInfo, Identity } from "../api";
import { N_ } from "../i18n";
import type { CopterEnv } from "./copter";

export type FcFirmware = "openplane" | "betaflight" | "inav" | "ardupilot" | "px4" | "mavlink" | "dfu" | "unknown";

export interface FcDetected {
  port: string | null;
  firmware: FcFirmware;
  /** как прошивку называть человеку */
  name: string;
  version?: string;
  /** плата: env нашей прошивки, board_name BF/INAV */
  board?: string;
  /** на чём летает, если прошивка сказала */
  vehicle?: "copter" | "plane" | "vtol" | "other";
  /** сборка коптера в нашей базе для этой платы */
  env?: CopterEnv;
  identity?: Identity;
  device: Device;
}

export const FIRMWARE_NAMES: Record<FcFirmware, string> = {
  openplane: "OpenPlane",
  betaflight: "Betaflight",
  inav: "INAV",
  ardupilot: "ArduPilot",
  px4: "PX4",
  mavlink: "MAVLink",
  dfu: N_("режим прошивки (DFU)"),
  unknown: N_("не узнали"),
};

const VARIANTS: Record<string, FcFirmware> = { BTFL: "betaflight", INAV: "inav", ARDU: "ardupilot", PX4: "px4", MAVL: "mavlink" };

/** Прошивки, у которых есть CLI в духе BF: дамп, diff all, уход в загрузчик командой. */
export const CLI_FIRMWARES: FcFirmware[] = ["betaflight", "inav"];

export function firmwareOf(fc: FcInfo | undefined): FcFirmware | undefined {
  return fc?.variant ? VARIANTS[fc.variant] : undefined;
}

/** MAV_TYPE из HEARTBEAT — на чём летает ArduPilot/PX4. */
export function mavVehicle(type: number | undefined): FcDetected["vehicle"] {
  if (type === undefined) return undefined;
  if (type === 1) return "plane";
  if ([2, 3, 4, 13, 14, 15, 29].includes(type)) return "copter";
  if (type >= 19 && type <= 25) return "vtol";
  return "other";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Сборка коптера под плату по её имени (board_name BF, env нашей прошивки). */
export function matchCopterEnv(envs: CopterEnv[], board: string | undefined): CopterEnv | undefined {
  if (!board) return undefined;
  const want = norm(board);
  return envs.find((e) => {
    const names = [e.env, e.env.replace(/-quad$/, ""), e.boardFile?.split("/").pop()?.replace(/\.h$/, "") ?? ""];
    return names.some((n) => n && norm(n) === want);
  });
}

/**
 * Всё, что на USB, — карточками «что за полётник». Наш паспорт главнее MSP
 * (наша прошивка тоже отвечает на MSP); порт без ответа — «не узнали».
 */
export function detectFcs(
  devices: Device[],
  ports: Record<string, { identity: Identity | null } | undefined>,
  fc: Record<string, FcInfo>,
  envs: CopterEnv[],
): FcDetected[] {
  const out: FcDetected[] = [];
  for (const device of devices) {
    const port = device.port ?? null;
    if (device.kind === "stm32-dfu") {
      out.push({ port: null, firmware: "dfu", name: FIRMWARE_NAMES.dfu, device });
      continue;
    }
    if (!port) continue;
    const identity = ports[port]?.identity ?? undefined;
    if (identity) {
      const copter = identity.vehicle === "copter";
      out.push({
        port,
        firmware: "openplane",
        name: FIRMWARE_NAMES.openplane,
        version: identity.commit?.slice(0, 7),
        board: identity.board,
        vehicle: copter ? "copter" : "plane",
        env: copter ? envs.find((e) => e.env === identity.board) : undefined,
        identity,
        device,
      });
      continue;
    }
    const info = fc[port];
    const firmware = firmwareOf(info);
    if (firmware) {
      const board = info?.board || info?.target;
      const mav = info?.vehicle !== undefined;
      out.push({
        port,
        firmware,
        name: FIRMWARE_NAMES[firmware],
        version: info?.version,
        board,
        vehicle: mav ? mavVehicle(info?.vehicle) : undefined,
        env: matchCopterEnv(envs, board),
        device,
      });
      continue;
    }
    out.push({ port, firmware: "unknown", name: FIRMWARE_NAMES.unknown, device });
  }
  return out;
}

// ---------------- что на борту: дамп CLI Betaflight/INAV ----------------

export interface OnBoard {
  firmware?: string;
  version?: string;
  mcu?: string;
  board?: string;
  manufacturer?: string;
  gyro?: string;
  acc?: string;
  baro?: string;
  mag?: string;
  osd?: string;
  /** память чёрного ящика: «флеш 16 МБ», «SD» */
  storage?: string;
  /** приёмник: протокол (serialrx_provider) и UART */
  rx?: { protocol?: string; uart?: number };
  gps?: { uart?: number; provider?: string };
  vtx?: { protocol: string; uart?: number };
  esc?: { protocol?: string; bidir?: boolean; telemetryUart?: number };
  features: string[];
}

/** Функции порта BF (serial N маска …): бит → роль. */
const SERIAL_BITS: [number, string][] = [
  [64, "rx"],
  [2, "gps"],
  [2048, "SmartAudio"],
  [8192, "Tramp"],
  [131072, "MSP"],
  [1024, "esc"],
];

/** Номер порта BF → UART (0 — UART1; 20 — USB, 30+ — программные). */
const uartOf = (port: number) => (port >= 0 && port < 10 ? port + 1 : undefined);

/** Разбор файла `bf_board.py read` (### status, ### diff all…) или голого diff. */
export function parseBoardDump(text: string): OnBoard {
  const b: OnBoard = { features: [] };
  const sets: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    let m = l.match(/^#\s*(Betaflight|INAV)\s*\/\s*(\S+)\s*\((\w+)\)\s*([\d.]+)/i);
    if (m) {
      b.firmware = m[1];
      b.mcu = m[2];
      b.version = m[4];
      continue;
    }
    if ((m = l.match(/^board_name\s+(\S+)/))) b.board = m[1];
    else if ((m = l.match(/^manufacturer_id\s+(\S+)/))) b.manufacturer = m[1];
    else if ((m = l.match(/^feature\s+(-?)(\w+)/))) {
      if (!m[1] && !b.features.includes(m[2])) b.features.push(m[2]);
    } else if ((m = l.match(/^serial\s+(\d+)\s+(\d+)\s/))) {
      const uart = uartOf(Number(m[1]));
      const mask = Number(m[2]);
      for (const [bit, role] of SERIAL_BITS) {
        if (!(mask & bit)) continue;
        if (role === "rx") b.rx = { ...b.rx, uart };
        else if (role === "gps") b.gps = { ...b.gps, uart };
        else if (role === "esc") b.esc = { ...b.esc, telemetryUart: uart };
        else b.vtx = { protocol: role, uart };
      }
    } else if ((m = l.match(/^set\s+(\w+)\s*=\s*(.*)$/))) sets[m[1].toLowerCase()] = m[2].trim();
    else if (/(GYRO|ACC|BARO|MAG)=/.test(l)) {
      for (const [, key, value] of l.matchAll(/(GYRO|ACC|BARO|MAG)=([A-Za-z0-9_]+)/g)) {
        if (value === "NONE") continue;
        b[key.toLowerCase() as "gyro" | "acc" | "baro" | "mag"] = value;
      }
    } else if ((m = l.match(/^OSD:\s*(\S+)/))) b.osd = m[1];
    else if ((m = l.match(/^Flash:.*?(\d+)\s*([MK])/i))) b.storage = `flash ${m[1]}${m[2].toUpperCase()}`;
    else if (/^SD card:/i.test(l) && !/none|not/i.test(l)) b.storage = "SD";
  }
  if (sets.serialrx_provider) b.rx = { ...b.rx, protocol: sets.serialrx_provider };
  if (sets.gps_provider && b.gps) b.gps.provider = sets.gps_provider;
  if (sets.motor_pwm_protocol) b.esc = { ...b.esc, protocol: sets.motor_pwm_protocol };
  if (sets.dshot_bidir) b.esc = { ...b.esc, bidir: sets.dshot_bidir.toUpperCase() === "ON" };
  if (!b.osd && sets.osd_displayport_device && sets.osd_displayport_device !== "AUTO") b.osd = sets.osd_displayport_device;
  if (!b.storage && sets.blackbox_device) b.storage = sets.blackbox_device;
  return b;
}

// ---------------- что из diff не переносится ----------------

export interface NotMoved {
  key: string;
  /** что это и почему не переносим — по-человечески */
  title: string;
  lines: string[];
}

const NOT_MOVED: { key: string; words: string[]; title: string }[] = [
  { key: "pins", words: ["resource", "timer", "dma"], title: N_("распиновка — у нас в заголовке платы (снят с дампа)") },
  { key: "serial", words: ["serial"], title: N_("порты UART — у нас по плате и описанию коптера") },
  { key: "feature", words: ["feature"], title: N_("функции BF (feature) — у нас включаются настройками") },
  { key: "frame", words: ["mixer", "mmix", "smix", "servo"], title: N_("рама и миксер — у нас в описании коптера") },
  { key: "led", words: ["led", "color", "mode_color"], title: N_("LED-лента — настроим, когда появится (пункт 155)") },
  { key: "adjrange", words: ["adjrange"], title: N_("подстройки крутилками — настроим, когда появятся (пункт 121)") },
  { key: "vtxtable", words: ["vtxtable"], title: N_("таблица VTX — у нас своя, по ответу передатчика") },
];

/** Непонятые строки diff — группами «вот что настроим заново». */
export function notMoved(unknown: string[]): NotMoved[] {
  const groups = new Map<string, NotMoved>();
  for (const line of unknown) {
    const word = line.split(/\s+/)[0].toLowerCase();
    const known = NOT_MOVED.find((g) => g.words.includes(word));
    const key = known?.key ?? (word === "set" ? "set" : "other");
    const title = known?.title ?? (word === "set" ? N_("настроек с такими именами у нас нет") : N_("прочие команды"));
    const g = groups.get(key) ?? { key, title, lines: [] };
    g.lines.push(word === "set" ? line.replace(/^set\s+/i, "").split(/\s*=\s*/)[0] : line);
    groups.set(key, g);
  }
  return [...groups.values()];
}
