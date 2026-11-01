// Настройки коптера с платы: ответы прошивки на "params" (CopterLink.h) —
// "@params" (заголовок), "@param" на каждую настройку, "@rc" (порядок
// каналов, режимы на тумблерах, VTX с тумблера, rxfail), "@modes" (режимы
// BF), ответы "@set", "@save", "@revert", "@profile", "@error", "@motor".
// Всё здесь — без React и без связи: разбор, вкладки, кривые, импорт diff BF.

import { N_ } from "../i18n";

export type ParamValue = number | string;

export interface CopterParam {
  name: string;
  type: "int" | "float" | "enum" | "string";
  /** группа = вкладка (Params.h прошивки) */
  group: string;
  /** master — одна на коптер; pid / rate — своя в каждом профиле */
  scope: "master" | "pid" | "rate";
  min?: number;
  max?: number;
  maxlen?: number;
  options?: string[];
  default: ParamValue;
  /** откуда умолчание: table — таблица, tune — вывод из модели коптера, build — из сборки, battery — из батареи */
  from: "table" | "tune" | "build" | "battery";
  units: string;
  text: string;
  value: ParamValue;
  /** задана явно (иначе действует умолчание) */
  set: boolean;
  profiles?: ParamValue[];
}

/** Мотор рамы: x — к носу, y — вправо (в долях плеча), куда крутится, нижний в соосной паре. */
export type FrameMotor = [number, number, "cw" | "ccw", boolean];

export interface ParamsHeader {
  count: number;
  profiles: number;
  profile: number;
  rateprofile: number;
  build: string;
  source: "MODEL" | "BETAFLIGHT";
  unsaved: boolean;
  frame?: { type: string; motors: FrameMotor[] };
  motorTestMax?: number;
}

/** Строка aux: [№, режим, канал AUX (0 = AUX1), от, до, логика, связь] — как в CLI BF. */
export type AuxRow = [number, number, number, number, number, number, number];
/** Строка vtx: [№, канал AUX, полоса, канал, мощность, от, до]. */
export type VtxRow = [number, number, number, number, number, number, number];

export interface RcState {
  map: string;
  channels: number;
  rxrange: [number, number][];
  aux: AuxRow[];
  /** тумблеры прошивки (CopterConfig.h) — действуют, пока своя таблица пуста */
  fallback: AuxRow[];
  usingFallback: boolean;
  vtx: VtxRow[];
  rxfail: [number, string, number][];
}

/** Режим BF: номер, имя, есть ли он у нас. */
export type ModeInfo = [number, string, boolean];

export interface CopterBoard {
  header: ParamsHeader | null;
  params: Record<string, CopterParam>;
  /** порядок — как в прошивке */
  order: string[];
  rc: RcState | null;
  modes: ModeInfo[];
  /** ждём ответ на "params" */
  loading: boolean;
  loadedAt: number;
  /** настройки, отправленные и ещё без ответа */
  pending: Record<string, ParamValue>;
  /** последняя ошибка платы: имя настройки (или команда) → текст */
  errors: Record<string, string>;
  /** изменено и не сохранено (ARM запрещён, пока не save или revert) */
  unsaved: boolean;
  /** ползунки проверки моторов, % (ответ "@motor") */
  motorTest: number[];
}

export function emptyBoard(): CopterBoard {
  return { header: null, params: {}, order: [], rc: null, modes: [], loading: false, loadedAt: 0, pending: {}, errors: {}, unsaved: false, motorTest: [] };
}

/** Ответ платы → новое состояние (без мутаций). */
export function applyMessage(b: CopterBoard, kind: string, data: unknown, now = Date.now()): CopterBoard {
  const d = data as Record<string, unknown>;
  switch (kind) {
    case "params": {
      const header = data as ParamsHeader;
      return { ...emptyBoard(), header, loading: true, unsaved: header.unsaved, motorTest: b.motorTest };
    }
    case "param": {
      const p = data as CopterParam;
      const order = b.params[p.name] ? b.order : [...b.order, p.name];
      return { ...b, params: { ...b.params, [p.name]: p }, order };
    }
    case "rc":
      return { ...b, rc: data as RcState, unsaved: b.loading ? b.unsaved : true };
    case "modes":
      return { ...b, modes: data as ModeInfo[], loading: false, loadedAt: now };
    case "set": {
      const name = String(d.name ?? "");
      const pending = { ...b.pending };
      delete pending[name];
      const errors = { ...b.errors };
      const p = b.params[name];
      if (d.ok) delete errors[name];
      else errors[name] = String(d.error ?? "ошибка");
      if (!p) return { ...b, pending, errors };
      const value = (d.value ?? p.value) as ParamValue;
      const params = { ...b.params, [name]: { ...p, value, set: d.ok ? true : p.set, profiles: withProfile(p, b.header, value) } };
      return { ...b, params, pending, errors, unsaved: b.unsaved || !!d.ok };
    }
    case "profile":
      return b.header ? { ...b, header: { ...b.header, profile: Number(d.profile), rateprofile: Number(d.rateprofile) }, unsaved: true } : b;
    case "save":
      return d.ok ? { ...b, unsaved: false, errors: {} } : { ...b, errors: { ...b.errors, save: String(d.error ?? "не сохранилось") } };
    case "revert":
      return { ...b, unsaved: false, pending: {} };
    case "error":
      return { ...b, errors: { ...b.errors, [String(d.cmd ?? "?")]: String(d.error ?? "") } };
    case "motor":
      return { ...b, motorTest: Array.isArray(d.m) ? (d.m as number[]) : b.motorTest };
  }
  return b;
}

function withProfile(p: CopterParam, h: ParamsHeader | null, value: ParamValue): ParamValue[] | undefined {
  if (!p.profiles || !h) return p.profiles;
  const slot = p.scope === "pid" ? h.profile : h.rateprofile;
  return p.profiles.map((v, i) => (i === slot ? value : v));
}

export function isDefault(p: CopterParam): boolean {
  return !p.set || String(p.value) === String(p.default);
}

/** Значение для команды set: выбор — именем, числа — как есть. */
export function setCommand(name: string, value: ParamValue): string {
  return `set ${name} ${value}`;
}

/** Проверка ввода до отправки: null — можно, иначе — что не так. */
export function checkValue(p: CopterParam, value: ParamValue): string | null {
  if (p.type === "enum") return p.options?.includes(String(value)) ? null : "нет такого значения";
  if (p.type === "string") return String(value).length <= (p.maxlen ?? 64) ? null : `не длиннее ${p.maxlen}`;
  const n = Number(value);
  if (!Number.isFinite(n)) return "нужно число";
  if (p.type === "int" && !Number.isInteger(n)) return "нужно целое";
  if (p.min !== undefined && n < p.min) return `не меньше ${p.min}`;
  if (p.max !== undefined && n > p.max) return `не больше ${p.max}`;
  return null;
}

// ---------------- вкладки ----------------

export type CopterTab =
  | "overview"
  | "setup"
  | "receiver"
  | "modes"
  | "motors"
  | "pid"
  | "rates"
  | "filters"
  | "failsafe"
  | "power"
  | "vtx"
  | "gps"
  | "blackbox"
  | "other"
  | "cli";

export const TABS: { id: CopterTab; title: string; board: boolean }[] = [
  { id: "overview", title: N_("Коптер"), board: false },
  { id: "setup", title: N_("Подготовка"), board: true },
  { id: "receiver", title: N_("Приёмник"), board: true },
  { id: "modes", title: N_("Режимы"), board: true },
  { id: "motors", title: N_("Моторы"), board: true },
  { id: "pid", title: N_("PID"), board: true },
  { id: "rates", title: N_("Расходы"), board: true },
  { id: "filters", title: N_("Фильтры"), board: true },
  { id: "failsafe", title: N_("Безопасность"), board: true },
  { id: "power", title: N_("Питание"), board: true },
  { id: "vtx", title: N_("Видео"), board: true },
  { id: "gps", title: N_("GPS"), board: true },
  { id: "blackbox", title: N_("Чёрный ящик"), board: true },
  { id: "other", title: N_("Прочее"), board: true },
  { id: "cli", title: N_("CLI"), board: true },
];

/** Группа настройки (Params.h) → вкладка. */
export const GROUP_TAB: Record<string, CopterTab> = {
  pid: "pid",
  rates: "rates",
  filters: "filters",
  motors: "motors",
  safety: "failsafe",
  receiver: "receiver",
  modes: "modes",
  copter: "other",
  power: "power",
  vtx: "vtx",
  gps: "gps",
  blackbox: "blackbox",
  other: "other",
};

/** Настройки вкладки в порядке прошивки; skip — те, что вкладка рисует сама. */
export function tabParams(b: CopterBoard, tab: CopterTab, skip: readonly string[] = []): CopterParam[] {
  return b.order.map((n) => b.params[n]).filter((p) => p && (GROUP_TAB[p.group] ?? "other") === tab && !skip.includes(p.name));
}

// ---------------- PID и расходы ----------------

export const AXES = ["roll", "pitch", "yaw"] as const;
export type Axis = (typeof AXES)[number];
export const AXIS_LABELS: Record<Axis, string> = { roll: N_("Крен"), pitch: N_("Тангаж"), yaw: N_("Рысканье") };

/** Таблица PID: колонка → имя настройки по оси. */
export const PID_COLUMNS: { key: string; title: string; name: (a: Axis) => string }[] = [
  { key: "p", title: "P", name: (a) => `p_${a}` },
  { key: "i", title: "I", name: (a) => `i_${a}` },
  { key: "d", title: "D", name: (a) => `d_${a}` },
  { key: "dmax", title: "D max", name: (a) => `d_max_${a}` },
  { key: "f", title: "FF", name: (a) => `f_${a}` },
];

export const RATE_COLUMNS: { key: string; title: string; hint: string; name: (a: Axis) => string }[] = [
  { key: "rc", title: N_("Центр"), hint: N_("°/с у центра стика, ×10"), name: (a) => `${a}_rc_rate` },
  { key: "srate", title: N_("Максимум"), hint: N_("°/с при стике до упора, ×10"), name: (a) => `${a}_srate` },
  { key: "expo", title: N_("Экспо"), hint: N_("мягче у центра, %"), name: (a) => `${a}_expo` },
];

/** Кривая расходов прошивки (Presets.h RateCurve): стик −1…1 → °/с. */
export function rateAt(centerX10: number, maxX10: number, expoPct: number, stick: number): number {
  const center = centerX10 * 10;
  const max = Math.max(center, maxX10 * 10);
  const expo = expoPct / 100;
  const x = Math.max(-1, Math.min(1, stick));
  const a = Math.abs(x);
  return center * x + (max - center) * x * Math.pow(a, 1 + 4 * expo);
}

export function num(b: CopterBoard, name: string, fallback = 0): number {
  const v = Number(b.params[name]?.value);
  return Number.isFinite(v) ? v : fallback;
}

// ---------------- режимы ----------------

/** Режимы, которые стоит показывать в «Режимах» первыми (номера BF). */
export const MAIN_MODES = [0, 1, 2, 13, 27, 28, 47];

export const auxLabel = (aux: number) => `AUX${aux + 1}`;

/** Строка CLI для строки таблицы aux. */
export function auxCommand(r: AuxRow): string {
  return `aux ${r.join(" ")}`;
}

/** Свободный номер строки aux (0…19). */
export function freeAuxSlot(rows: AuxRow[]): number {
  for (let i = 0; i < 20; i++) if (!rows.some((r) => r[0] === i)) return i;
  return -1;
}

/** Строка aux, которая гасит слот (BF: диапазон 900–900). */
export function clearAuxCommand(slot: number): string {
  return `aux ${slot} 0 0 900 900 0 0`;
}

// ---------------- импорт diff из Betaflight ----------------

export interface ImportLine {
  line: string;
  /** set: имя настройки */
  name?: string;
  /** группа настройки у нас; undefined — у нас такой нет */
  group?: string;
  kind: "set" | "aux" | "map" | "rxrange" | "rxfail" | "vtx" | "profile" | "rateprofile";
}

const IMPORT_KINDS = new Set(["set", "aux", "map", "rxrange", "rxfail", "vtx", "profile", "rateprofile"]);

/** Группы, которые по умолчанию не переносятся: настройку PID и фильтров у нас считает модель. */
export const IMPORT_SKIP_GROUPS = ["pid", "rates", "filters"];

/**
 * Строки из «diff all» Betaflight, которые наша прошивка поймёт: set с
 * известным именем, aux, map, rxrange, rxfail, vtx и переключение профилей.
 * Остальное (resource, feature, serial, неизвестные set) — в unknown.
 */
export function parseBfDiff(text: string, params: Record<string, CopterParam>): { lines: ImportLine[]; unknown: string[] } {
  const lines: ImportLine[] = [];
  const unknown: string[] = [];
  let inDiff = !/^### diff all/m.test(text);
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith("### ")) {
      inDiff = l === "### diff all";
      continue;
    }
    if (!inDiff || !l || l.startsWith("#") || l === "batch start" || l === "batch end" || l === "save" || l.startsWith("defaults")) continue;
    const word = l.split(/\s+/)[0];
    if (!IMPORT_KINDS.has(word)) {
      if (!["board_name", "manufacturer_id", "mcu_id", "signature"].includes(word)) unknown.push(l);
      continue;
    }
    if (word === "set") {
      const m = l.match(/^set\s+([a-z0-9_]+)\s*=?\s*(.*)$/i);
      const name = m?.[1].toLowerCase();
      const p = name ? params[name] : undefined;
      if (!p) {
        unknown.push(l);
        continue;
      }
      lines.push({ line: `set ${name} ${m![2].trim()}`, name, group: p.group, kind: "set" });
      continue;
    }
    lines.push({ line: l, kind: word as ImportLine["kind"] });
  }
  return { lines, unknown };
}

// ---------------- запрет ARM ----------------

/** Причины запрета ARM по кодам из "@live" (как в status Betaflight) — словами. */
export const ARM_TEXT: Record<string, string> = {
  NOGYRO: N_("гироскоп/акселерометр не отвечает"),
  FAILSAFE: N_("был failsafe — связь должна продержаться несколько секунд"),
  RXLOSS: N_("нет связи с пультом"),
  NOT_DISARMED: N_("моторы остановила защита — выключите ARM и включите снова"),
  BOXFAILSAFE: N_("включён режим FAILSAFE (тумблер)"),
  RUNAWAY: N_("коптер «убегал» на взлёте — проверьте моторы, винты, установку платы и выключите ARM"),
  CRASH: N_("была авария — выключите ARM"),
  THROTTLE: N_("газ не внизу"),
  ANGLE: N_("коптер стоит не ровно (больше small_angle)"),
  BOOTGRACE: N_("сразу после включения"),
  NOPREARM: N_("PREARM не включён"),
  LOAD: N_("цикл не успевает (загрузка больше 100 %)"),
  CALIB: N_("ориентация ещё определяется (2 с после включения)"),
  CLI: N_("открыт CLI — закройте (exit)"),
  CMS: N_("открыто меню OSD"),
  BST: N_("шина BST"),
  MSP: N_("несохранённые настройки — сохраните или отмените"),
  PARALYZE: N_("включён режим PARALYZE"),
  GPS: N_("нет GPS для возврата домой"),
  RESC: N_("включён тумблер возврата домой"),
  RPMFILTER: N_("нет оборотов от регуляторов для фильтра"),
  REBOOT_REQD: N_("нужна перезагрузка (сменилась рама или выходы)"),
  DSHOT_BBANG: N_("DShot не запустился"),
  NO_ACC_CAL: N_("не откалибрована установка платы — «Подготовка» → «Установка платы»"),
  MOTOR_PROTO: N_("протокол моторов не выбран или не работает"),
  ARMSWITCH: N_("ARM включён заранее — выключите и включите снова"),
  MOVING: N_("коптер качают — поставьте на землю"),
  BATTERY: N_("батарея разряжена"),
  MOTOR_TEST: N_("идёт проверка моторов"),
  NO_ARM_AUX: N_("ARM не назначен ни на один тумблер — «Режимы»"),
  CONFIG: N_("описание коптера не сходится с платой (см. CLI → status)"),
};

/** Причины, которые на столе без пульта и батареи — нормальны: не мешают проверять. */
export const ARM_BENCH_OK = ["THROTTLE", "ARMSWITCH", "BOOTGRACE", "CALIB"];
