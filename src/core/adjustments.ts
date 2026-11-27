// Подстройки в полёте (adjrange, как в BF): пока AUX «диапазона» в своих
// границах, канал «подстройки» меняет настройку — шагом (вверх +1, вниз −1,
// держать — ещё шаг каждые 0.5 с), ручкой от центра (центр ± масштаб) или
// выбирает профиль положением тумблера (три положения — профили 1–3).
// Прошивка присылает "@adj {"rows":[[№, канал, от, до, функция, канал
// подстройки, центр, масштаб], …]}" (copter/AdjRanges.h, CopterLink.h);
// правка — командой "adjrange № 0 …", как в CLI.

import { N_ } from "../i18n";

/** Строка adjrange: [№, канал диапазона, от, до, функция, канал подстройки, центр, масштаб]. */
export type AdjRow = [number, number, number, number, number, number, number, number];

export type AdjKind = "step" | "select" | "none";

export interface AdjFunction {
  id: number;
  /** как на OSD (BF) */
  name: string;
  title: string;
  kind: AdjKind;
  /** что меняет (настройки текущего профиля) */
  params: string[];
  group: "pid" | "rates" | "profile" | "other";
}

const f = (id: number, name: string, title: string, kind: AdjKind, params: string[], group: AdjFunction["group"]): AdjFunction => ({ id, name, title, kind, params, group });

/** Номера — как adjustmentFunction_e в BF (их пишет diff и конфигуратор). */
export const ADJ_FUNCTIONS: AdjFunction[] = [
  f(6, "ROLL/PITCH P", N_("P крена и тангажа"), "step", ["p_roll", "p_pitch"], "pid"),
  f(7, "ROLL/PITCH I", N_("I крена и тангажа"), "step", ["i_roll", "i_pitch"], "pid"),
  f(8, "ROLL/PITCH D", N_("D крена и тангажа"), "step", ["d_roll", "d_pitch"], "pid"),
  f(22, "PITCH/ROLL F", N_("FF крена и тангажа"), "step", ["f_roll", "f_pitch"], "pid"),
  f(18, "ROLL P", N_("P крена"), "step", ["p_roll"], "pid"),
  f(19, "ROLL I", N_("I крена"), "step", ["i_roll"], "pid"),
  f(20, "ROLL D", N_("D крена"), "step", ["d_roll"], "pid"),
  f(31, "ROLL F", N_("FF крена"), "step", ["f_roll"], "pid"),
  f(15, "PITCH P", N_("P тангажа"), "step", ["p_pitch"], "pid"),
  f(16, "PITCH I", N_("I тангажа"), "step", ["i_pitch"], "pid"),
  f(17, "PITCH D", N_("D тангажа"), "step", ["d_pitch"], "pid"),
  f(30, "PITCH F", N_("FF тангажа"), "step", ["f_pitch"], "pid"),
  f(9, "YAW P", N_("P рысканья"), "step", ["p_yaw"], "pid"),
  f(10, "YAW I", N_("I рысканья"), "step", ["i_yaw"], "pid"),
  f(11, "YAW D", N_("D рысканья"), "step", ["d_yaw"], "pid"),
  f(32, "YAW F", N_("FF рысканья"), "step", ["f_yaw"], "pid"),
  f(23, "FF TRANSITION", N_("Переход FF у центра стика"), "step", ["feedforward_transition"], "pid"),
  f(24, "HORIZON STRENGTH", N_("Сила выравнивания HORIZON"), "step", ["horizon_level_strength"], "pid"),
  f(1, "RC RATE", N_("Расход у центра: крен и тангаж"), "step", ["roll_rc_rate", "pitch_rc_rate"], "rates"),
  f(25, "ROLL RC RATE", N_("Расход у центра: крен"), "step", ["roll_rc_rate"], "rates"),
  f(26, "PITCH RC RATE", N_("Расход у центра: тангаж"), "step", ["pitch_rc_rate"], "rates"),
  f(21, "RC RATE YAW", N_("Расход у центра: рысканье"), "step", ["yaw_rc_rate"], "rates"),
  f(4, "ROLL/PITCH RATE", N_("Наибольший расход: крен и тангаж"), "step", ["roll_srate", "pitch_srate"], "rates"),
  f(14, "ROLL RATE", N_("Наибольший расход: крен"), "step", ["roll_srate"], "rates"),
  f(13, "PITCH RATE", N_("Наибольший расход: тангаж"), "step", ["pitch_srate"], "rates"),
  f(5, "YAW RATE", N_("Наибольший расход: рысканье"), "step", ["yaw_srate"], "rates"),
  f(2, "RC EXPO", N_("Экспо: крен и тангаж"), "step", ["roll_expo", "pitch_expo"], "rates"),
  f(27, "ROLL RC EXPO", N_("Экспо: крен"), "step", ["roll_expo"], "rates"),
  f(28, "PITCH RC EXPO", N_("Экспо: тангаж"), "step", ["pitch_expo"], "rates"),
  f(3, "THROTTLE EXPO", N_("Кривая газа"), "step", ["thr_expo"], "rates"),
  f(12, "RATE PROFILE", N_("Профиль расходов тумблером"), "select", [], "profile"),
  f(36, "PID PROFILE", N_("Профиль PID тумблером"), "select", [], "profile"),
  f(29, "PID AUDIO", N_("Звук PID (нет в OpenPlane)"), "none", [], "other"),
  f(33, "OSD PROFILE", N_("Профиль OSD (нет в OpenPlane)"), "none", [], "other"),
  f(34, "LED PROFILE", N_("Профиль LED (нет в OpenPlane)"), "none", [], "other"),
  f(35, "LED DIMMER", N_("Яркость LED (нет в OpenPlane)"), "none", [], "other"),
];

export const ADJ_GROUPS: { id: AdjFunction["group"]; title: string }[] = [
  { id: "pid", title: N_("PID") },
  { id: "rates", title: N_("Расходы") },
  { id: "profile", title: N_("Профили") },
  { id: "other", title: N_("Прочее") },
];

export const ADJ_SLOTS = 30;
export const ADJ_MIN_US = 900;
export const ADJ_MAX_US = 2100;
/** шагом: выше — +1, ниже — −1 (как в BF) */
export const ADJ_STEP_UP_US = 1700;
export const ADJ_STEP_DOWN_US = 1300;

export function adjFunction(id: number): AdjFunction | undefined {
  return ADJ_FUNCTIONS.find((x) => x.id === id);
}

export function adjCommand(r: AdjRow): string {
  const [slot, ...rest] = r;
  return `adjrange ${slot} 0 ${rest.join(" ")}`;
}

/** Строка, которая гасит слот (BF: 900–900). */
export function clearAdjCommand(slot: number): string {
  return `adjrange ${slot} 0 0 900 900 0 0 0 0`;
}

export function freeAdjSlot(rows: AdjRow[]): number {
  for (let i = 0; i < ADJ_SLOTS; i++) if (!rows.some((r) => r[0] === i)) return i;
  return -1;
}

/** Новая строка: P крена и тангажа шагом с AUX4, действует всегда (AUX1 900–2100). */
export function newAdjRow(slot: number, auxCount: number): AdjRow {
  return [slot, 0, ADJ_MIN_US, ADJ_MAX_US, 6, Math.min(3, Math.max(0, auxCount - 1)), 0, 0];
}

export type AdjMode = "step" | "absolute" | "select" | "none";

export function adjMode(r: AdjRow): AdjMode {
  const kind = adjFunction(r[4])?.kind ?? "none";
  if (kind === "select") return "select";
  if (kind === "none") return "none";
  return r[6] > 0 ? "absolute" : "step";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Строка действует при этом положении канала диапазона (как в прошивке: [от, до)). */
export function adjActive(r: AdjRow, rangeUs: number | undefined): boolean {
  if (rangeUs === undefined) return false;
  const us = clamp(rangeUs, ADJ_MIN_US, ADJ_MAX_US - 1);
  return us >= r[2] && us < r[3];
}

/** Ручкой от центра: значение при этом положении (целое, как в прошивке). */
export function adjAbsoluteValue(r: AdjRow, us: number): number {
  return r[6] + Math.trunc(((clamp(us, 1000, 2000) - 1500) * r[7]) / 500);
}

/** Профиль (с 1) при этом положении тумблера: 900–2100 на три части. */
export function adjSelectProfile(us: number): number {
  return Math.floor((clamp(us, ADJ_MIN_US, ADJ_MAX_US - 1) - ADJ_MIN_US) / 400) + 1;
}

/** Шагом: что сделает канал сейчас. */
export function adjStep(us: number): -1 | 0 | 1 {
  return us > ADJ_STEP_UP_US ? 1 : us < ADJ_STEP_DOWN_US ? -1 : 0;
}

/** Строки из ответа "@adj" (только занятые, по номеру). */
export function parseAdj(data: unknown): AdjRow[] {
  const rows = (data as { rows?: unknown })?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is AdjRow => Array.isArray(r) && r.length === 8 && r.every((x) => typeof x === "number")).sort((a, b) => a[0] - b[0]);
}
