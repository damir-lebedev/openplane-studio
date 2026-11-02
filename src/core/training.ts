// Учебные ограничения (P09): потолок, круг от дома, наклон и скорость в
// ANGLE — прошивка copter/TrainingLimits.h (training_*). Новичку («Основа»
// с мастером) рекомендуем включить; выключаются галочкой.

import type { CopterLive } from "../api";
import { N_ } from "../i18n";
import { CopterBoard, num, ParamValue } from "./copterParams";
import { guided, PilotProfile } from "./pilot";

export const isTrainingParam = (name: string) => name.startsWith("training_");

export interface TrainingView {
  on: boolean;
  /** м над точкой ARM; 0 — нет */
  alt: number;
  /** м от дома; 0 — нет */
  dist: number;
  /** ° в ANGLE; 0 — как angle_limit */
  angle: number;
  /** км/ч по GPS; 0 — нет */
  speed: number;
}

/** Ограничения на плате; null — прошивка старая, их нет. */
export function trainingOf(b: CopterBoard): TrainingView | null {
  if (!b.params.training_limits) return null;
  return {
    on: String(b.params.training_limits.value) === "ON",
    alt: num(b, "training_max_alt", 50),
    dist: num(b, "training_max_dist", 150),
    angle: num(b, "training_max_angle", 30),
    speed: num(b, "training_max_speed", 40),
  };
}

/** Кому рекомендовать: новичок и «из симулятора» и школа. */
export function trainingRecommended(p: PilotProfile): boolean {
  return guided(p.experience) || p.goals.includes("school");
}

export interface TrainingPreset {
  id: "first" | "park" | "field";
  title: string;
  desc: string;
  values: Omit<TrainingView, "on">;
}

export const TRAINING_PRESETS: TrainingPreset[] = [
  { id: "first", title: N_("Первые полёты"), desc: N_("двор, низко и медленно"), values: { alt: 30, dist: 80, angle: 25, speed: 30 } },
  { id: "park", title: N_("Площадка"), desc: N_("как из коробки"), values: { alt: 50, dist: 150, angle: 30, speed: 40 } },
  { id: "field", title: N_("Поле"), desc: N_("уже уверенно, простор"), values: { alt: 100, dist: 300, angle: 40, speed: 60 } },
];

/** Какой набор сейчас (или null — свои числа). */
export function trainingPresetOf(v: TrainingView): TrainingPreset["id"] | null {
  const p = TRAINING_PRESETS.find((x) => x.values.alt === v.alt && x.values.dist === v.dist && x.values.angle === v.angle && x.values.speed === v.speed);
  return p?.id ?? null;
}

/** Команды на плату: включить/выключить и (по желанию) числа набора. */
export function trainingCommands(on: boolean, values?: Omit<TrainingView, "on">): [string, ParamValue][] {
  const cmds: [string, ParamValue][] = [["training_limits", on ? "ON" : "OFF"]];
  if (values) {
    cmds.push(["training_max_alt", values.alt], ["training_max_dist", values.dist], ["training_max_angle", values.angle], ["training_max_speed", values.speed]);
  }
  return cmds;
}

export interface TrainingNote {
  text: string;
  warn: boolean;
}

/**
 * Что пилоту знать: без GPS круга и скорости нет; круг меньше старта
 * возврата — возврат садится, а не разворачивает.
 */
export function trainingNotes(v: TrainingView, b: CopterBoard, live: CopterLive | null): TrainingNote[] {
  const notes: TrainingNote[] = [];
  if (!v.on) return notes;
  if ((v.dist > 0 || v.speed > 0) && live && !live.gps) notes.push({ text: N_("GPS не виден — круг и скорость работать не будут; потолок и наклон — будут."), warn: true });
  if (v.dist > 0 && live?.gps && live.gps.home === undefined) notes.push({ text: N_("Круг — от дома: дом ставится при ARM с фиксом GPS."), warn: false });
  const minStart = num(b, "gps_rescue_min_start_dist", 15);
  if (v.dist > 0 && v.dist < 2 * minStart) notes.push({ text: N_("Круг меньше двух gps_rescue_min_start_dist — возврат будет садиться, а не разворачивать."), warn: true });
  if (v.dist > 0 && v.alt > 0) notes.push({ text: N_("За краем коптер сам летит назад (FENCE RETURN) не выше потолка; внутри 80 % круга управление снова ваше."), warn: false });
  return notes;
}

/** Где коптер сейчас относительно пределов (для картинки); null — не в полёте или нет данных. */
export function trainingNow(live: CopterLive | null): { alt: number; dist: number | null; dir: number | null; flag: string | null } | null {
  if (!live) return null;
  return {
    alt: live.alt,
    dist: live.gps?.home ?? null,
    dir: live.gps?.dir ?? null,
    flag: live.train ?? null,
  };
}
