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
  /** регуляторы DShot: команды «пискнуть», направление, turtle mode */
  dshotCommands?: boolean;
  /** запас контура для PID, что работают (прошивка пересчитывает на каждую правку PID и фильтров) */
  margin?: LoopMargin;
  /** флеш настроек: занято и всего, байт (обновляется и ответом на save) */
  flash?: [number, number];
}

/** Запасы устойчивости контура угловой скорости (copter/Presets.h checkLoop). */
export interface LoopMargin {
  /** по усилению, дБ */
  gm: number;
  /** по фазе, ° */
  pm: number;
  /** частота среза крена/тангажа, Гц */
  hz: number;
  /** ниже этого прошивка предупреждает, дБ */
  min: number;
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
      const header = d.margin && b.header ? { ...b.header, margin: d.margin as LoopMargin } : b.header;
      return { ...b, header, params, pending, errors, unsaved: b.unsaved || !!d.ok };
    }
    case "profile":
      return b.header ? { ...b, header: { ...b.header, profile: Number(d.profile), rateprofile: Number(d.rateprofile) }, unsaved: true } : b;
    case "save": {
      const header = b.header ? { ...b.header, ...(d.margin ? { margin: d.margin as LoopMargin } : {}), ...(d.flash ? { flash: d.flash as [number, number] } : {}) } : b.header;
      return d.ok ? { ...b, header, unsaved: false, errors: {} } : { ...b, header, errors: { ...b.errors, save: String(d.error ?? "не сохранилось") } };
    }
    case "revert":
      return { ...b, unsaved: false, pending: {} };
    case "error":
      return { ...b, errors: { ...b.errors, [String(d.cmd ?? "?")]: String(d.error ?? "") } };
    case "motor":
      return { ...b, motorTest: Array.isArray(d.m) ? (d.m as number[]) : b.motorTest };
    case "dshot":
    case "beep": {
      const errors = { ...b.errors };
      delete errors[kind];
      return { ...b, errors };
    }
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
  | "wizard"
  | "flight"
  | "overview"
  | "frombf"
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
  | "osd"
  | "gps"
  | "blackbox"
  | "beeper"
  | "other"
  | "cli";

export const TABS: { id: CopterTab; title: string; board: boolean }[] = [
  { id: "overview", title: N_("Коптер"), board: false },
  { id: "frombf", title: N_("Я с Betaflight"), board: false },
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
  { id: "osd", title: N_("OSD"), board: true },
  { id: "gps", title: N_("GPS"), board: true },
  { id: "blackbox", title: N_("Чёрный ящик"), board: true },
  { id: "beeper", title: N_("Пищалка"), board: true },
  { id: "other", title: N_("Прочее"), board: true },
  { id: "cli", title: N_("CLI"), board: true },
];

/** Вкладки новичка: мастер по шагам и одна страница ползунков (что видно — core/pilot.ts). */
export const BEGINNER_TABS: { id: CopterTab; title: string; board: boolean }[] = [
  { id: "wizard", title: N_("По шагам"), board: false },
  { id: "flight", title: N_("Настройка полёта"), board: true },
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
  osd: "osd",
  gps: "gps",
  blackbox: "blackbox",
  other: "other",
  beeper: "beeper",
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

// ---------------- ползунки: запас и «Настройка полёта» ----------------

/** Запас по усилению: ok — с запасом, warn — на грани, bad — раскачается. */
export function marginLevel(m: LoopMargin): "ok" | "warn" | "bad" {
  return m.gm < m.min ? "bad" : m.gm < m.min + 4 ? "warn" : "ok";
}

/** Ползунок страницы «Настройка полёта»: одно понятное движение — одна или несколько настроек. */
export interface FlightSlider {
  id: "response" | "smooth" | "filters" | "speed" | "center" | "tilt";
  title: string;
  hint: string;
  /** подписи краёв */
  left: string;
  right: string;
  min: number;
  max: number;
  step: number;
  /** единицы у значения: × — множитель (100 = ×1.00) */
  unit: "×" | "%" | "°/с" | "°";
}

export const FLIGHT_SLIDERS: FlightSlider[] = [
  {
    id: "response",
    title: N_("Отзывчивость"),
    hint: N_("Насколько резко коптер слушается и держится. Больше — точнее, но ближе к дрожи; трясётся или звенит на газу — меньше."),
    left: N_("мягко"),
    right: N_("жёстко"),
    min: 50,
    max: 150,
    step: 5,
    unit: "×",
  },
  {
    id: "smooth",
    title: N_("Плавность стиков"),
    hint: N_("Как быстро коптер подхватывает движение стика. Для съёмки — плавнее, для трюков — резче."),
    left: N_("резко"),
    right: N_("плавно"),
    min: 0,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    id: "filters",
    title: N_("Фильтры вибраций"),
    hint: N_("Сильнее — моторы тише и холоднее, но отклик запаздывает. Моторы горячие после полёта — сдвиньте влево."),
    left: N_("сильнее"),
    right: N_("быстрее"),
    min: 50,
    max: 150,
    step: 5,
    unit: "×",
  },
  {
    id: "speed",
    title: N_("Скорость вращения"),
    hint: N_("Сколько коптер крутится при стике до упора (крен и тангаж; рысканье — в той же доле)."),
    left: N_("спокойно"),
    right: N_("фристайл"),
    min: 200,
    max: 1200,
    step: 10,
    unit: "°/с",
  },
  {
    id: "center",
    title: N_("Мягкость у центра"),
    hint: N_("Насколько стик мягче около центра: больше — легче держать ровно, но край стика резче."),
    left: N_("ровно"),
    right: N_("мягко"),
    min: 0,
    max: 80,
    step: 5,
    unit: "%",
  },
  {
    id: "tilt",
    title: N_("Предел наклона"),
    hint: N_("Насколько коптер наклоняется в режиме ANGLE при стике до упора — это и наибольшая скорость полёта."),
    left: N_("осторожно"),
    right: N_("быстро"),
    min: 15,
    max: 80,
    step: 1,
    unit: "°",
  },
];

const SLIDER_AXES = ["roll", "pitch", "yaw"] as const;

/** Настройки, из которых складывается ползунок; нет хоть одной — ползунка нет (старая прошивка). */
export const SLIDER_PARAMS: Record<FlightSlider["id"], string[]> = {
  response: ["simplified_pids_mode", "simplified_master_multiplier"],
  smooth: ["simplified_pids_mode", "simplified_feedforward_gain"],
  filters: ["simplified_gyro_filter", "simplified_gyro_filter_multiplier", "simplified_dterm_filter", "simplified_dterm_filter_multiplier"],
  speed: SLIDER_AXES.flatMap((a) => [`${a}_rc_rate`, `${a}_srate`]),
  center: SLIDER_AXES.map((a) => `${a}_expo`),
  tilt: ["angle_limit"],
};

function pv(b: CopterBoard, name: string, pick: "value" | "default"): number {
  const p = b.params[name];
  const v = Number(pick === "default" ? p?.default : name in b.pending ? b.pending[name] : p?.value);
  return Number.isFinite(v) ? v : 0;
}

/** Положение ползунка из настроек платы (pick = default — «как из коробки»). */
export function sliderValue(b: CopterBoard, id: FlightSlider["id"], pick: "value" | "default" = "value"): number {
  switch (id) {
    case "response":
      return pv(b, "simplified_master_multiplier", pick);
    case "smooth":
      // FF 150 % — резко (0), 50 % — плавно (100)
      return Math.max(0, Math.min(100, 150 - pv(b, "simplified_feedforward_gain", pick)));
    case "filters":
      return pv(b, "simplified_gyro_filter_multiplier", pick);
    case "speed":
      return Math.max(pv(b, "roll_rc_rate", pick), pv(b, "roll_srate", pick)) * 10;
    case "center":
      return pv(b, "roll_expo", pick);
    case "tilt":
      return pv(b, "angle_limit", pick);
  }
}

/** Значение ползунка словами: ×1.20, 40 %, 720 °/с. */
export function sliderText(s: FlightSlider, v: number): string {
  return s.unit === "×" ? `×${(v / 100).toFixed(2)}` : `${Math.round(v)} ${s.unit}`;
}

/**
 * Команды для положения ползунка: [имя, значение]. Выключенные ползунки
 * прошивки (simplified_* = OFF) включаются; скорость ставит максимум крена и
 * тангажа, рысканье — в той же доле; центр не выше максимума.
 */
export function sliderCommands(b: CopterBoard, id: FlightSlider["id"], v: number): [string, ParamValue][] {
  const on = (mode: string, value: string): [string, ParamValue][] => (String(b.params[mode]?.value) === "OFF" ? [[mode, value]] : []);
  switch (id) {
    case "response":
      return [...on("simplified_pids_mode", "RPY"), ["simplified_master_multiplier", Math.round(v)]];
    case "smooth":
      return [...on("simplified_pids_mode", "RPY"), ["simplified_feedforward_gain", Math.round(150 - v)]];
    case "filters":
      return [
        ...on("simplified_gyro_filter", "ON"),
        ...on("simplified_dterm_filter", "ON"),
        ["simplified_gyro_filter_multiplier", Math.round(v)],
        ["simplified_dterm_filter_multiplier", Math.round(v)],
      ];
    case "speed": {
      const k = v / Math.max(10, sliderValue(b, "speed"));
      const out: [string, ParamValue][] = [];
      for (const a of SLIDER_AXES) {
        const p = b.params[`${a}_srate`];
        const center = pv(b, `${a}_rc_rate`, "value");
        const max = Math.max(center, pv(b, `${a}_srate`, "value"));
        const srate = Math.round(Math.min(p?.max ?? 255, Math.max(p?.min ?? 0, a === "yaw" ? max * k : v / 10)));
        out.push([`${a}_srate`, srate]);
        if (center > srate) out.push([`${a}_rc_rate`, srate]);
      }
      return out;
    }
    case "center":
      return SLIDER_AXES.map((a) => [`${a}_expo`, Math.round(v)]);
    case "tilt":
      return [["angle_limit", Math.round(v)]];
  }
}

/** Ползунки, которые есть на этой плате. */
export function flightSliders(b: CopterBoard): FlightSlider[] {
  return FLIGHT_SLIDERS.filter((s) => SLIDER_PARAMS[s.id].every((n) => n in b.params));
}

// ---------------- GPS Rescue ----------------

/**
 * Профиль возврата из настроек gps_rescue_* — как в прошивке (copter/GpsRescue.h):
 * высота возврата по alt_mode, снижение с descent_dist линейно к landing_alt над
 * домом, дальше вдвое медленнее. distM — до дома, altM — высота сейчас, maxAltM —
 * наибольшая за полёт. seconds — оценка до касания.
 */
export function rescuePath(b: CopterBoard, distM: number, altM: number, maxAltM: number) {
  const mode = String(b.params.gps_rescue_alt_mode?.value ?? "MAX_ALT");
  const climb = num(b, "gps_rescue_initial_climb", 10);
  const ret =
    mode === "FIXED_ALT" ? num(b, "gps_rescue_return_alt", 30) : mode === "CURRENT_ALT" ? altM + climb : Math.max(maxAltM, altM) + climb;
  const descent = Math.min(num(b, "gps_rescue_descent_dist", 20), distM);
  const landAlt = num(b, "gps_rescue_landing_alt", 4);
  const up = num(b, "gps_rescue_ascend_rate", 750) / 100;
  const down = num(b, "gps_rescue_descend_rate", 150) / 100;
  const speed = Math.max(0.5, num(b, "gps_rescue_ground_speed", 750) / 100);
  const tooClose = distM < num(b, "gps_rescue_min_start_dist", 15);
  const landS = (h: number) => Math.max(0, h - landAlt) / down + Math.min(landAlt, h) / (down / 2);   // ниже landing_alt — вдвое медленнее
  if (tooClose) return { ret: altM, descent: 0, landAlt, tooClose, seconds: landS(altM), mode };
  const climbS = Math.abs(ret - altM) / up;
  const flyS = (distM - descent) / speed + (descent * 2) / speed;   // в снижении скорость убывает — в среднем вдвое
  return { ret, descent, landAlt, tooClose, seconds: climbS + flyS + landS(Math.min(landAlt, ret)), mode };
}

// ---------------- сглаживание стиков ----------------

/** Срез сглаживания как в прошивке (copter/RcSmoothing.h): кадры × 1.5 / (1 + factor/10), не ниже 15 Гц. */
export function rcAutoCutoff(frameHz: number, factor: number): number {
  return frameHz > 0 ? Math.max(15, (frameHz * 1.5) / (1 + factor / 10)) : 15;
}

/**
 * Стик рывком 0 → 1 за ms миллисекунд: что приходит кадрами (ступеньки) и что
 * после PT3 со срезом cutoffHz (0 — без фильтра), шаг 0.25 мс.
 */
export function rcStepResponse(frameHz: number, cutoffHz: number, ms = 40, rampMs = 12): { t: number; raw: number; smooth: number }[] {
  const dt = 0.00025;
  const k = cutoffHz > 0 ? 1 - Math.exp(-2 * Math.PI * cutoffHz * 1.961459177 * dt) : 1;
  const frame = 1 / Math.max(1, frameHz);
  let a = 0, b = 0, c = 0, raw = 0, nextFrame = 0;
  const out: { t: number; raw: number; smooth: number }[] = [];
  for (let t = 0; t <= ms / 1000 + 1e-9; t += dt) {
    if (t >= nextFrame) {
      raw = Math.min(1, Math.max(0, t / (rampMs / 1000)));
      nextFrame += frame;
    }
    a += k * (raw - a);
    b += k * (a - b);
    c += k * (b - c);
    out.push({ t: t * 1000, raw, smooth: c });
  }
  return out;
}

// ---------------- OSD ----------------

/** osd_*_pos как в BF: x + 32·y, 0x0800 — показан (профиль 1), 0x1000/0x2000 — профили 2 и 3, 0x0400 — шестой бит x. */
export const OSD_VISIBLE = 0x0800;
export const OSD_PROFILES = 0x3800;
export const OSD_COLS = 30;
export const osdX = (p: number) => (p & 0x1f) | ((p >> 5) & 0x20);
export const osdY = (p: number) => (p >> 5) & 0x1f;
export const osdVisible = (p: number) => (p & OSD_PROFILES) !== 0;
export const osdPos = (x: number, y: number, flags = OSD_VISIBLE) => (x & 0x1f) | ((y & 0x1f) << 5) | ((x & 0x20) << 5) | flags;
/** Передвинуть, не трогая видимость в профилях. */
export const osdMove = (p: number, x: number, y: number) => osdPos(x, y, p & OSD_PROFILES);
/** Показать (профиль 1) или спрятать (во всех профилях). */
export const osdToggle = (p: number) => (osdVisible(p) ? p & ~OSD_PROFILES : p | OSD_VISIBLE);

export interface OsdElementParam {
  /** имя BF без osd_ и _pos: vbat, link_quality… */
  key: string;
  param: CopterParam;
  pos: number;
}

/** Элементы OSD платы (настройки osd_*_pos) в порядке прошивки. */
export function osdElements(b: CopterBoard): OsdElementParam[] {
  return b.order
    .filter((n) => n.startsWith("osd_") && n.endsWith("_pos"))
    .map((n) => {
      const p = b.params[n];
      const v = Number(b.pending[n] ?? p.value);
      return { key: n.slice(4, -4), param: p, pos: Number.isFinite(v) ? v : Number(p.default) };
    });
}

// ---------------- режимы ----------------

/** Режимы, которые стоит показывать в «Режимах» первыми (номера BF). */
export const MAIN_MODES = [0, 1, 2, 13, 27, 28, 35, 46, 47];

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
