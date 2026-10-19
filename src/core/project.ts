// Самолёт в ангаре: что выбрано в мастере. Из него получается конфигурация
// для tools/opconfig.py apply (toFirmwareConfig) — прошивка собирается по ней.

import { N_, t } from "../i18n";
import {
  Binding,
  defaultBoard,
  findBoard,
  findParam,
  isNone,
  Manifest,
  SensorCategory,
  SENSOR_CATEGORIES,
} from "./manifest";

export interface Airframe {
  template: string;
  /** Пока прошивка ведёт один мотор; 2+ — «скоро». */
  motors: number;
  motorPosition: "tractor" | "pusher";
  esc: "bidirectional" | "normal";
  /** two — по серве на элерон (можно закрылки-флапероны), one — одна через Y-кабель. */
  ailerons: "two" | "one";
  rudder: boolean;
  gear: "tail" | "nose" | "none";
  /** Серво сброса груза на AUX1. */
  payload: boolean;
  /** Серво наклона камеры на AUX2. */
  camera: boolean;
  buzzer: boolean;
}

/** Выбор датчиков: id варианта из SensorSelection.h; у барометра ещё "none". */
export type SensorChoice = Record<SensorCategory, string>;

export interface FlashRecord {
  at: string;
  board: string;
  commit: string | null;
  configHash: string;
  ok: boolean;
  note?: string;
}

export type StepId = "board" | "airframe" | "sensors" | "rc" | "switches" | "safety" | "system" | "review" | "setup";

/** Проверка мастера наладки, пройденная на плате (не калибровки — те плата помнит сама). */
export interface SetupRecord {
  at: string;
  /** хэш конфигурации на плате в тот момент */
  config: string;
  note?: string;
}

export interface PlaneProject {
  schema: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  board: string;
  airframe: Airframe;
  sensors: SensorChoice;
  bindings: Binding[];
  /** Правки общих параметров Config.h поверх значений прошивки. */
  params: Record<string, unknown>;
  /** Правки пинов — по плате (макрос BOARD_*), у каждой платы свои. */
  boardParams: Record<string, Record<string, unknown>>;
  /** Правки раскладки каналов (Channels.h). */
  channels: Record<string, number>;
  /** Самый дальний открытый шаг мастера: шаги открываются по порядку. */
  reached: StepId;
  lastFlash?: FlashRecord;
  history: FlashRecord[];
  /** пройденные проверки наладки: датчики, пульт, failsafe, рули, мотор */
  setup?: Partial<Record<string, SetupRecord>>;
}

export const FULL_STEPS: StepId[] = ["board", "airframe", "sensors", "rc", "switches", "safety", "system", "review", "setup"];
export const SIMPLE_STEPS: StepId[] = ["board", "airframe", "sensors", "switches", "review", "setup"];

export function stepIndex(step: StepId): number {
  return FULL_STEPS.indexOf(step);
}

export function isReached(project: PlaneProject, step: StepId): boolean {
  return stepIndex(step) <= stepIndex(project.reached);
}

export function newId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `plane-${Date.now().toString(36)}-${rnd}`;
}

function paramValue(manifest: Manifest, name: string): unknown {
  return manifest.params.find((p) => p.name === name && p.board === null)?.value;
}

/** Самолёт из прошивки как она есть: значения Config.h, датчики, тумблеры. */
export function importFromFirmware(manifest: Manifest, name: string, boardEnv?: string): PlaneProject {
  const board = (boardEnv && findBoard(manifest, boardEnv)) || defaultBoard(manifest);
  const gear = String(paramValue(manifest, "LANDING_GEAR") ?? "").endsWith("NOSE_WHEEL") ? "nose" : "tail";
  const uses = (feature: string) =>
    manifest.current.bindings.some((b) => b.kind === "feature" && b.feature === feature);
  const usesKnob = (knob: string) => manifest.current.bindings.some((b) => b.kind === "knob" && b.knob === knob);
  const now = new Date().toISOString();
  return {
    schema: 1,
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    board: board.env,
    airframe: {
      template: "astro-cargo",
      motors: 1,
      motorPosition: "tractor",
      esc: paramValue(manifest, "ESC_BIDIRECTIONAL") === false ? "normal" : "bidirectional",
      ailerons: "two",
      rudder: board.outputs.rudder,
      gear,
      payload: board.outputs.aux1 && uses("PAYLOAD_DROP"),
      camera: board.outputs.aux2 && (uses("CAMERA_STAB") || usesKnob("CAMERA_TILT")),
      buzzer: board.outputs.buzzer,
    },
    sensors: { ...manifest.current.sensors },
    bindings: manifest.current.bindings.map((b) => ({ ...b })) as Binding[],
    params: {},
    boardParams: {},
    channels: {},
    reached: "review",
    history: [],
  };
}

/** Новый самолёт с нуля: плата по умолчанию, простые датчики, MANUAL/STABILIZE. */
export function blankProject(manifest: Manifest, name: string): PlaneProject {
  const p = importFromFirmware(manifest, name);
  const pick = (cat: SensorCategory, preferNone: boolean) => {
    const opts = manifest.sensors.options[cat];
    return (preferNone ? opts.find((o) => o.id.endsWith("_NONE")) : undefined)?.id ?? manifest.current.sensors[cat] ?? opts[0]?.id;
  };
  p.airframe = { ...p.airframe, template: "generic", esc: "normal", payload: false, camera: false };
  p.sensors = {
    imu: pick("imu", false),
    baro: pick("baro", false),
    mag: pick("mag", true),
    airspeed: pick("airspeed", true),
    gps: pick("gps", true),
  };
  const modeSwitch = manifest.channels.list.find((c) => c.bindable && c.positions === 3);
  p.bindings = modeSwitch
    ? [{ kind: "modes", channel: modeSwitch.name, modes: ["MODE_MANUAL", "MODE_STABILIZE", "MODE_ALT_HOLD"] }]
    : [];
  p.reached = "board";
  return p;
}

/**
 * Шасси. Без шасси взлёт с полосы невозможен — его место на тумблере
 * занимает автовзлёт с руки (MODE_LAUNCH). Возвращает, что заменено, или null.
 */
export function setGear(project: PlaneProject, gear: Airframe["gear"]): string | null {
  project.airframe.gear = gear;
  if (gear !== "none") return null;
  let swapped = false;
  const swap = (m: string) => {
    if (m !== "MODE_AUTO_TAKEOFF") return m;
    swapped = true;
    return "MODE_LAUNCH";
  };
  project.bindings = project.bindings.map((b) => {
    if (b.kind === "modes") return { ...b, modes: b.modes.map(swap) };
    if (b.kind === "mode") return { ...b, mode: swap(b.mode) };
    return b;
  });
  return swapped ? N_("Без шасси автовзлёт с полосы заменён на автовзлёт с руки") : null;
}

/** Протокол приёмника самолёта: IBUS / SBUS / CRSF (прошивка без выбора — iBUS). */
export function receiverProtocol(manifest: Manifest, project: PlaneProject): string {
  return String(effectiveParam(manifest, project, "RX_PROTOCOL") ?? "IBUS").split("::").pop() ?? "IBUS";
}

/** Значение параметра для этой конфигурации: правка самолёта или значение прошивки. */
export function effectiveParam(manifest: Manifest, project: PlaneProject, name: string): unknown {
  const board = findBoard(manifest, project.board);
  const p = findParam(manifest, name, board?.macro ?? null);
  if (!p) return undefined;
  if (p.board) {
    const own = project.boardParams[p.board];
    if (own && name in own) return own[name];
  } else if (name in project.params) {
    return project.params[name];
  }
  if (name === "ESC_BIDIRECTIONAL") return project.airframe.esc === "bidirectional";
  if (name === "LANDING_GEAR") return `LandingGear::${landingGear(project)}`;
  return p.value;
}

export interface FirmwareConfig {
  schema: 1;
  board: string;
  params: Record<string, unknown>;
  channels: Record<string, number>;
  sensors: Record<SensorCategory, string>;
  bindings: Binding[];
  project?: { plane: string; configHash: string; commit: string | null; boardEnv: string };
}

/**
 * Шасси для прошивки. Без шасси самолёт лежит на брюхе ровно — для
 * калибровки на земле это как носовое колесо (стоянка ≈ горизонт, шаг 2
 * засчитывается сам); автовзлёта с полосы без шасси нет вовсе.
 */
export function landingGear(project: PlaneProject): "NOSE_WHEEL" | "TAIL_WHEEL" {
  return project.airframe.gear === "tail" ? "TAIL_WHEEL" : "NOSE_WHEEL";
}

/** Конфигурация для opconfig apply. Без project — для хэша конфигурации. */
export function toFirmwareConfig(manifest: Manifest, project: PlaneProject): FirmwareConfig {
  const board = findBoard(manifest, project.board);
  const params: Record<string, unknown> = {
    ESC_BIDIRECTIONAL: project.airframe.esc === "bidirectional",
    LANDING_GEAR: landingGear(project),
  };
  Object.assign(params, project.params);
  if (board?.macro && project.boardParams[board.macro]) {
    Object.assign(params, project.boardParams[board.macro]);
  }
  const sensors = {} as Record<SensorCategory, string>;
  for (const cat of SENSOR_CATEGORIES) {
    const chosen = project.sensors[cat];
    const valid = manifest.sensors.options[cat].some((o) => o.id === chosen);
    // Барометра «нет» в прошивке не бывает: остаётся драйвер по умолчанию,
    // он просто не найдёт датчик — прошивка это переживает (режимы без него).
    sensors[cat] = valid ? chosen : manifest.current.sensors[cat] ?? manifest.sensors.options[cat][0].id;
  }
  return {
    schema: 1,
    board: project.board,
    params,
    channels: { ...project.channels },
    sensors,
    bindings: project.bindings,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Хэш конфигурации: вшивается в прошивку, плата отдаёт его в паспорте. */
export async function configHash(config: FirmwareConfig, commit: string | null): Promise<string> {
  const { project: _skip, ...rest } = config;
  const text = canonical({ config: rest, commit });
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function sensorLabel(manifest: Manifest, cat: SensorCategory, id: string): string {
  if (isNone(id)) return t("нет");
  const opt = manifest.sensors.options[cat].find((o) => o.id === id);
  if (!opt) return id;
  return opt.bus === "spi" ? `${t(opt.title)} (SPI)` : t(opt.title);
}
