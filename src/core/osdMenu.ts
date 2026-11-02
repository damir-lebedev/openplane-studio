// Меню настроек в очках (CMS, пункт 151): те же страницы и тот же экран
// 30×16, что рисует прошивка (copter/OsdMenu.h), — чтобы попробовать меню
// клавишами до полёта. Тренажёр: правки здесь на плату не уходят.

import { CopterBoard, ParamValue } from "./copterParams";

export type MenuKey = "up" | "down" | "left" | "right" | "back";
export type MenuExit = "save" | "discard" | null;

type Item =
  | { label: string; kind: "page"; page: number }
  | { label: string; kind: "param"; name: string }
  | { label: string; kind: "pid_profile" | "rate_profile" | "save_exit" | "exit" };

export const PAGE_MAIN = 0;
export const PAGE_PID = 2;
export const PAGE_VTX = 5;

const PAGE_NAMES = ["MENU", "PROFILES", "PID", "RATES", "SLIDERS", "VTX", "TRAINING"];

const param = (label: string, name: string): Item => ({ label, kind: "param", name });

/** Страницы — порядок строк как в прошивке. */
export const MENU_PAGES: Item[][] = [
  [
    { label: "PROFILES", kind: "page", page: 1 },
    { label: "PID", kind: "page", page: 2 },
    { label: "RATES", kind: "page", page: 3 },
    { label: "SLIDERS", kind: "page", page: 4 },
    { label: "VTX", kind: "page", page: 5 },
    { label: "TRAINING", kind: "page", page: 6 },
    { label: "SAVE+EXIT", kind: "save_exit" },
    { label: "EXIT", kind: "exit" },
  ],
  [
    { label: "PID PROFILE", kind: "pid_profile" },
    { label: "RATE PROFILE", kind: "rate_profile" },
  ],
  ["ROLL", "PITCH", "YAW"].flatMap((axis) => ["P", "I", "D", "F"].map((term) => param(`${axis} ${term}`, `${term.toLowerCase()}_${axis.toLowerCase()}`))),
  ["ROLL", "PITCH", "YAW"].flatMap((axis) => {
    const a = axis.toLowerCase();
    return [param(`${axis} RC RATE`, `${a}_rc_rate`), param(`${axis} SUPER`, `${a}_srate`), param(`${axis} EXPO`, `${a}_expo`)];
  }),
  [
    param("PIDS MODE", "simplified_pids_mode"),
    param("MASTER", "simplified_master_multiplier"),
    param("PI GAIN", "simplified_pi_gain"),
    param("I GAIN", "simplified_i_gain"),
    param("D GAIN", "simplified_d_gain"),
    param("D MAX GAIN", "simplified_dmax_gain"),
    param("FF GAIN", "simplified_feedforward_gain"),
    param("PITCH D", "simplified_pitch_d_gain"),
    param("PITCH PI", "simplified_pitch_pi_gain"),
    param("GYRO FILTER", "simplified_gyro_filter_multiplier"),
    param("DTERM FILTER", "simplified_dterm_filter_multiplier"),
  ],
  [param("BAND", "vtx_band"), param("CHANNEL", "vtx_channel"), param("POWER", "vtx_power"), param("LOW POWER DISARM", "vtx_low_power_disarm")],
  [
    param("LIMITS", "training_limits"),
    param("MAX ALT M", "training_max_alt"),
    param("MAX DIST M", "training_max_dist"),
    param("MAX ANGLE", "training_max_angle"),
    param("MAX KMH", "training_max_speed"),
  ],
];

export interface MenuState {
  page: number;
  cursor: number;
  top: number;
  pidProfile: number;
  rateProfile: number;
  /** правки в тренажёре: имя → значение */
  edits: Record<string, ParamValue>;
}

export const COLS = 30;
const FIRST_ROW = 2;
const VTX_BANDS = "ABEFRLXVGS";

export function menuStart(board: CopterBoard): MenuState {
  return { page: PAGE_MAIN, cursor: 0, top: 0, pidProfile: board.header?.profile ?? 0, rateProfile: board.header?.rateprofile ?? 0, edits: {} };
}

function visibleRows(rows: number): number {
  return Math.max(1, rows - FIRST_ROW - 2);
}

function scrolled(s: MenuState): MenuState {
  const visible = visibleRows(13); // NTSC — самый тесный, как в прошивке
  let top = s.top;
  if (s.cursor < top) top = s.cursor;
  if (s.cursor >= top + visible) top = s.cursor - visible + 1;
  return { ...s, top };
}

function valueOf(board: CopterBoard, s: MenuState, name: string): number {
  const v = name in s.edits ? s.edits[name] : board.params[name]?.value;
  return typeof v === "number" ? v : Number(v ?? 0);
}

/** Значение строки, как его пишет прошивка (format в Params.h). */
export function menuValue(board: CopterBoard, s: MenuState, it: Item): string | null {
  switch (it.kind) {
    case "page":
      return ">";
    case "pid_profile":
      return String(s.pidProfile + 1);
    case "rate_profile":
      return String(s.rateProfile + 1);
    case "param": {
      const p = board.params[it.name];
      const v = valueOf(board, s, it.name);
      if (it.name === "vtx_band") return v >= 1 && v <= VTX_BANDS.length ? VTX_BANDS[v - 1] : "U";
      if (p?.type === "enum") return p.options?.[v] ?? "?";
      if (p?.type === "float") return String(Math.round(v * 1000) / 1000);
      return String(Math.round(v));
    }
    default:
      return null;
  }
}

/** Экран меню — строки по 30 знаков (rows: 16 PAL, 13 NTSC). */
export function menuScreen(board: CopterBoard, s: MenuState, rows = 16): string[] {
  const out = Array.from({ length: rows }, () => " ".repeat(COLS).split(""));
  const print = (r: number, c: number, text: string) => {
    for (let i = 0; i < text.length && c + i < COLS && r < rows; i++) out[r][c + i] = text[i];
  };
  const profile = s.page === 2 || s.page === 4 ? s.pidProfile : s.page === 3 ? s.rateProfile : -1;
  const title = profile >= 0 ? `${PAGE_NAMES[s.page]}  PROFILE ${profile + 1}` : PAGE_NAMES[s.page];
  print(0, Math.floor((COLS - title.length) / 2), title);
  const items = MENU_PAGES[s.page];
  const visible = visibleRows(rows);
  for (let i = 0; i < visible && s.top + i < items.length; i++) {
    const it = items[s.top + i];
    const row = FIRST_ROW + i;
    if (s.top + i === s.cursor) print(row, 1, ">");
    print(row, 2, it.label);
    const v = menuValue(board, s, it);
    if (v !== null) print(row, COLS - 1 - v.length, v);
  }
  if (s.top > 0) print(FIRST_ROW - 1, COLS - 2, "^");
  if (s.top + visible < items.length) print(FIRST_ROW + visible, COLS - 2, "v");
  if (rows > FIRST_ROW + visible + 1) print(rows - 1, 0, "PITCH MOVE  ROLL SET  YAW BACK");
  return out.map((r) => r.join(""));
}

/** Нажатие (стик): новое состояние и выход, если меню закрылось. */
export function menuPress(board: CopterBoard, s: MenuState, key: MenuKey): { state: MenuState; exit: MenuExit } {
  const items = MENU_PAGES[s.page];
  const profiles = board.header?.profiles ?? 4;
  const done = (state: MenuState, exit: MenuExit = null) => ({ state, exit });
  switch (key) {
    case "up":
      return done(scrolled({ ...s, cursor: s.cursor === 0 ? items.length - 1 : s.cursor - 1 }));
    case "down":
      return done(scrolled({ ...s, cursor: (s.cursor + 1) % items.length }));
    case "back":
      if (s.page === PAGE_MAIN) return done(s, "discard");
      return done(scrolled({ ...s, page: PAGE_MAIN, cursor: MENU_PAGES[PAGE_MAIN].findIndex((it) => it.kind === "page" && it.page === s.page) }));
    case "left":
    case "right": {
      const it = items[s.cursor];
      const dir = key === "right" ? 1 : -1;
      switch (it.kind) {
        case "page":
          return done(key === "right" ? { ...s, page: it.page, cursor: 0, top: 0 } : s);
        case "save_exit":
          return done(s, key === "right" ? "save" : null);
        case "exit":
          return done(s, key === "right" ? "discard" : null);
        case "pid_profile":
          return done({ ...s, pidProfile: (s.pidProfile + dir + profiles) % profiles });
        case "rate_profile":
          return done({ ...s, rateProfile: (s.rateProfile + dir + profiles) % profiles });
        case "param": {
          const p = board.params[it.name];
          if (!p) return done(s);
          const inc = p.type === "float" ? 0.1 : 1;
          const v = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, valueOf(board, s, it.name) + dir * inc));
          return done({ ...s, edits: { ...s.edits, [it.name]: p.type === "float" ? Math.round(v * 1000) / 1000 : v } });
        }
      }
    }
  }
  return done(s);
}

/** Что изменено в тренажёре — строками «было → стало». */
export function menuChanges(board: CopterBoard, s: MenuState): { name: string; from: ParamValue; to: ParamValue }[] {
  return Object.entries(s.edits)
    .filter(([name, v]) => board.params[name] && board.params[name].value !== v)
    .map(([name, to]) => ({ name, from: board.params[name].value, to }));
}
