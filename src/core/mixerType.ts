// mixer_type (039/040): как прошивка укладывает команды PID в ход моторов,
// когда они не влезают. Повтор copter/Mixer.h на квадрике X — для картинки
// во вкладке «Моторы»: четыре столбика на каждый тип при одном и том же
// «трудном» случае. Коэффициенты рамы — как в прошивке: ±1 по каждой оси.

export type MixerType = "LEGACY" | "LINEAR" | "DYNAMIC" | "EZLANDING";
export const MIXER_TYPES: MixerType[] = ["LEGACY", "LINEAR", "DYNAMIC", "EZLANDING"];

export interface MixCase {
  throttle: number;   // 0..1
  roll: number;
  pitch: number;
  yaw: number;
  stick: number;      // EZLANDING: max(газ, |стики|) 0..1
}

export interface EzLanding {
  threshold: number;  // 0..2 (ez_landing_threshold / 100)
  limit: number;      // 0..0.75
}

export const EZ_DEFAULT: EzLanding = { threshold: 0.25, limit: 0.15 };

// M1 зад-право, M2 перед-право, M3 зад-лево, M4 перед-лево (порядок BF)
const QUAD_X: { roll: number; pitch: number; yaw: number }[] = [
  { roll: -1, pitch: 1, yaw: -1 },
  { roll: -1, pitch: -1, yaw: 1 },
  { roll: 1, pitch: 1, yaw: 1 },
  { roll: 1, pitch: -1, yaw: -1 },
];

export interface MixOut {
  motors: number[];   // 0..1
  throttle: number;   // газ после сдвига
  clipped: boolean;   // команда урезана или обрезана
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const spanOf = (v: number[]) => Math.max(...v) - Math.min(...v);

export function ezLimit(c: MixCase, ez: EzLanding): number {
  const k = clamp(c.stick / Math.max(0.01, ez.threshold));
  return ez.limit + (1 - ez.limit) * k;
}

function legacy(c: MixCase, spanLimit = 1): MixOut {
  let rp = QUAD_X.map((m) => c.roll * m.roll + c.pitch * m.pitch);
  const yw = QUAD_X.map((m) => c.yaw * m.yaw);
  let clipped = false;
  const rpSpan = spanOf(rp);
  if (rpSpan > 1) {
    rp = rp.map((v) => v / rpSpan);
    clipped = true;
  }
  const at = (k: number) => spanOf(rp.map((v, i) => v + k * yw[i]));
  let k = 1;
  if (at(1) > 1) {
    let lo = 0;
    let hi = 1;
    for (let it = 0; it < 12; ++it) {
      const mid = (lo + hi) / 2;
      if (at(mid) > 1) hi = mid;
      else lo = mid;
    }
    k = lo;
    clipped = true;
  }
  let d = rp.map((v, i) => v + k * yw[i]);
  const s = spanOf(d);
  if (spanLimit < 1 && s > spanLimit) d = d.map((v) => (v * spanLimit) / s);
  const t = Math.min(Math.max(clamp(c.throttle), -Math.min(...d)), 1 - Math.max(...d));
  return { motors: d.map((v) => clamp(t + v)), throttle: t, clipped };
}

function linear(c: MixCase): MixOut {
  const d = QUAD_X.map((m) => c.roll * m.roll + c.pitch * m.pitch + c.yaw * m.yaw);
  let t = clamp(c.throttle);
  const lo = Math.min(...d);
  const hi = Math.max(...d);
  if (hi - lo > 1) t = 0.5 - (lo + hi) / 2;
  else t = Math.min(Math.max(t, -lo), 1 - hi);
  const raw = d.map((v) => t + v);
  return { motors: raw.map((v) => clamp(v)), throttle: t, clipped: raw.some((v) => v < 0 || v > 1) };
}

/** Смеситель с airmode, как в прошивке. */
export function mixQuadX(type: MixerType, c: MixCase, ez: EzLanding = EZ_DEFAULT): MixOut {
  if (type === "LINEAR") return linear(c);
  if (type === "DYNAMIC") {
    const a = legacy(c);
    const b = linear(c);
    const w = Math.min(1, Math.abs(2 * clamp(c.throttle) - 1));
    return {
      motors: a.motors.map((v, i) => v + w * (b.motors[i] - v)),
      throttle: a.throttle + w * (b.throttle - a.throttle),
      clipped: a.clipped || b.clipped,
    };
  }
  return legacy(c, type === "EZLANDING" ? ezLimit(c, ez) : 1);
}

/** Доля команды рысканья, дошедшая до моторов (1 — целиком). */
export function yawKept(out: MixOut, c: MixCase): number {
  if (!c.yaw) return 1;
  const y = out.motors.reduce((s, v, i) => s + v * QUAD_X[i].yaw, 0) / 4;
  return clamp(y / c.yaw, 0, 1.5);
}

/** Два случая для картинки: полный газ с креном и разворотом; касание земли. */
export const MIX_CASES = {
  punch: { throttle: 0.9, roll: 0.35, pitch: 0, yaw: 0.35, stick: 1 } as MixCase,
  touchdown: { throttle: 0, roll: 0.3, pitch: 0, yaw: 0, stick: 0 } as MixCase,
};
