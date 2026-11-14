// Удержание позиции и высоты (прошивка copter/PositionHold.h, AltitudeHold.h):
// картинка дрейфа — точки положения коптера вокруг точки удержания из живых
// кадров ("pos": оценка по GPS и акселерометру), и что значат настройки
// alt_hold_* для стика газа.

import type { CopterLive } from "../api";
import { N_ } from "../i18n";
import { CopterBoard, num } from "./copterParams";

/** Точка следа: смещение от точки удержания, м (n — на север, e — на восток), и когда. */
export interface DriftPoint {
  n: number;
  e: number;
  t: number;
}

export interface DriftTrail {
  /** относительно чего точки: точка POS HOLD, место начала наблюдения (оценка) или первый фикс GPS */
  anchor: "hold" | "est" | "gps";
  /** точка отсчёта: север/восток от дома, м (hold, est) или широта/долгота (gps) */
  origin: [number, number];
  points: DriftPoint[];
}

/** Сколько следа хранить, мс, и не чаще скольких мс брать точку. */
export const DRIFT_KEEP_MS = 30000;
export const DRIFT_STEP_MS = 200;

const EARTH_M = 6371000;

/**
 * След с новым кадром. Держит POS HOLD — точки от его цели; иначе — от места,
 * где начали смотреть (на столе видно, как «гуляет» GPS). Сменилась точка
 * отсчёта (включили удержание, новая цель) — след начинается заново.
 */
export function driftTrail(prev: DriftTrail | null, live: CopterLive | null): DriftTrail | null {
  if (!live) return prev;
  const pos = live.pos;
  let anchor: DriftTrail["anchor"];
  let origin: [number, number];
  let at: [number, number];
  if (pos && pos.hold && pos.tn !== undefined && pos.te !== undefined) {
    anchor = "hold";
    origin = [pos.tn, pos.te];
    at = [pos.n, pos.e];
  } else if (pos) {
    anchor = "est";
    at = [pos.n, pos.e];
    origin = prev?.anchor === "est" ? prev.origin : at;
  } else if (live.gps?.fix) {
    anchor = "gps";
    at = [live.gps.lat, live.gps.lon];
    origin = prev?.anchor === "gps" ? prev.origin : at;
  } else {
    return null;
  }
  // цель POS HOLD едет за коптером, пока он летит по стику или тормозит: след — только когда она стоит
  const same = prev && prev.anchor === anchor && (anchor !== "hold" || Math.hypot(prev.origin[0] - origin[0], prev.origin[1] - origin[1]) < 0.05);
  const points = same ? prev.points.filter((p) => live.t - p.t <= DRIFT_KEEP_MS && live.t >= p.t) : [];
  let n = at[0] - origin[0];
  let e = at[1] - origin[1];
  if (anchor === "gps") {
    const rad = Math.PI / 180;
    n = (at[0] - origin[0]) * rad * EARTH_M;
    e = (at[1] - origin[1]) * rad * EARTH_M * Math.cos(origin[0] * rad);
  }
  const last = points[points.length - 1];
  if (!last || live.t - last.t >= DRIFT_STEP_MS) points.push({ n, e, t: live.t });
  else points[points.length - 1] = { n, e, t: last.t };
  return { anchor, origin, points };
}

export interface DriftStats {
  /** сейчас, наибольший и средний (СКО) уход от точки, м */
  now: number;
  max: number;
  rms: number;
}

export function driftStats(trail: DriftTrail | null): DriftStats | null {
  if (!trail || !trail.points.length) return null;
  let max = 0;
  let sum = 0;
  for (const p of trail.points) {
    const d = Math.hypot(p.n, p.e);
    max = Math.max(max, d);
    sum += d * d;
  }
  const last = trail.points[trail.points.length - 1];
  return { now: Math.hypot(last.n, last.e), max, rms: Math.sqrt(sum / trail.points.length) };
}

/** Радиус внешнего кольца картинки, м: чтобы след помещался (1, 2, 5, 10, 20…). */
export function driftScale(maxM: number): number {
  for (const r of [1, 2, 5, 10, 20, 50, 100]) if (maxM <= r * 0.95) return r;
  return 200;
}

/** Что делает удержание — словами. */
export const HOLD_PHASES: Record<string, string> = {
  HOLD: N_("держит точку"),
  BRAKE: N_("тормозит — точку запомнит, когда остановится"),
  MOVE: N_("летит по стику"),
};

/** Почему POS HOLD не держит (кадр "posfail") — и что делать. */
export const POS_FAILS: Record<string, string> = {
  NO_GPS: N_("нет годного GPS (фикс, спутники, дом) — коптер летит как в ALT HOLD"),
  NO_HEADING: N_("нет курса: компас не откалиброван или ему нет веры — коптер летит как в ALT HOLD"),
  DRIFT: N_("унесло дальше 10 м от точки — удержание выключено, пока не выключите и не включите режим"),
};

export const HEADING_SOURCES: Record<string, string> = {
  MAG: N_("компас"),
  GPS: N_("по полёту (GPS и акселерометр)"),
  NONE: N_("нет — только гироскоп от включения"),
};

/** Чего не хватает, чтобы POS HOLD взялся прямо сейчас (на столе, до взлёта); пусто — всё есть. */
export function posHoldMissing(b: CopterBoard, live: CopterLive | null): string[] {
  const out: string[] = [];
  if (!live) return out;
  const minSats = num(b, "gps_minimum_sats", 8);
  if (!live.gps) out.push(N_("GPS не отвечает"));
  else if (!live.gps.fix) out.push(N_("GPS ещё ищет спутники"));
  else if (live.gps.sats < minSats) out.push(N_("спутников меньше gps_minimum_sats"));
  const withoutMag = String(b.params.pos_hold_without_mag?.value ?? "OFF") === "ON";
  if (!live.mag) {
    if (!withoutMag) out.push(N_("компаса нет — включите pos_hold_without_mag (курс по полёту)"));
  } else if (!live.mag.cal) {
    out.push(N_("компас не откалиброван («Подготовка» → «Компас»)"));
  } else if (live.mag.bad) {
    out.push(N_("компас расходится с полётом — перекалибруйте или проверьте align_mag"));
  } else if (!live.mag.ok && !withoutMag) {
    out.push(N_("полю компаса нет веры (рядом металл или силовой провод)"));
  }
  return out;
}

export interface ThrottleZones {
  /** доли хода стика 0…1: ниже low — снижение, выше high — набор, между — держит */
  low: number;
  high: number;
  /** м/с при газе до упора вверх и вниз */
  climb: number;
  descent: number;
}

/** Стик газа в ALT HOLD и POS HOLD по настройкам alt_hold_* (как в прошивке). */
export function throttleZones(b: CopterBoard): ThrottleZones {
  const half = Math.min(0.45, Math.max(0, num(b, "alt_hold_deadband", 20) * 0.005));
  const climb = num(b, "alt_hold_adjust_rate", 50) * 0.1;
  return { low: 0.5 - half, high: 0.5 + half, climb, descent: 0.6 * climb };
}

/** Заданная вертикальная скорость по положению стика газа 0…1, м/с. */
export function climbAt(z: ThrottleZones, stick: number): number {
  if (stick > z.high) return ((stick - z.high) / (1 - z.high)) * z.climb;
  if (stick < z.low) return -((z.low - stick) / z.low) * z.descent;
  return 0;
}
