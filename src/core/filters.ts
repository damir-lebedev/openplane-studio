// Фильтры гироскопа и D как в Betaflight (пункты 054–059): цепочка из
// настроек платы и её АЧХ — та же непрерывная модель, что у прошивки
// (copter/FilterChain.h, Presets.h: lowpassAt, notchAt).

import type { CopterSpectrum } from "../api";
import { CopterBoard } from "./copterParams";

export type LpfType = "PT1" | "BIQUAD" | "PT2" | "PT3";
export interface Stage {
  type: LpfType;
  hz: number;
}
export interface Dyn {
  min: number;
  max: number;
  expo: number;
}
export interface Notch {
  hz: number;
  cutoff: number;
}
export interface Chain {
  lpf1: Stage;
  dyn: Dyn;
  lpf2: Stage;
  notches: Notch[];
}

/** Настройки цепочек — нет на плате (старая прошивка) — null. */
export const FILTER_PARAMS = {
  gyro: ["gyro_lpf1_type", "gyro_lpf1_static_hz", "gyro_lpf1_dyn_min_hz", "gyro_lpf1_dyn_max_hz", "gyro_lpf1_dyn_expo", "gyro_lpf2_type", "gyro_lpf2_static_hz", "gyro_notch1_hz", "gyro_notch1_cutoff", "gyro_notch2_hz", "gyro_notch2_cutoff"],
  /** динамический режектор и RPM-фильтр (060–063) */
  notch: ["dyn_notch_count", "dyn_notch_q", "dyn_notch_min_hz", "dyn_notch_max_hz", "rpm_filter_harmonics", "rpm_filter_weights", "rpm_filter_q", "rpm_filter_min_hz", "rpm_filter_fade_range_hz", "rpm_filter_lpf_hz"],
  dterm: ["dterm_lpf1_type", "dterm_lpf1_static_hz", "dterm_lpf1_dyn_min_hz", "dterm_lpf1_dyn_max_hz", "dterm_lpf1_dyn_expo", "dterm_lpf2_type", "dterm_lpf2_static_hz", "dterm_notch_hz", "dterm_notch_cutoff"],
};

function num(b: CopterBoard, name: string): number {
  const v = name in b.pending ? b.pending[name] : b.params[name]?.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lpfType(b: CopterBoard, name: string): LpfType {
  const v = name in b.pending ? b.pending[name] : b.params[name]?.value;
  return (["PT1", "BIQUAD", "PT2", "PT3"].includes(String(v)) ? String(v) : "PT1") as LpfType;
}

export function chainOf(b: CopterBoard, which: "gyro" | "dterm"): Chain | null {
  if (!FILTER_PARAMS[which].every((n) => b.params[n])) return null;
  const p = which;
  const notches = which === "gyro" ? [1, 2].map((i) => ({ hz: num(b, `gyro_notch${i}_hz`), cutoff: num(b, `gyro_notch${i}_cutoff`) })) : [{ hz: num(b, "dterm_notch_hz"), cutoff: num(b, "dterm_notch_cutoff") }];
  return {
    lpf1: { type: lpfType(b, `${p}_lpf1_type`), hz: num(b, `${p}_lpf1_static_hz`) },
    dyn: { min: num(b, `${p}_lpf1_dyn_min_hz`), max: num(b, `${p}_lpf1_dyn_max_hz`), expo: num(b, `${p}_lpf1_dyn_expo`) },
    lpf2: { type: lpfType(b, `${p}_lpf2_type`), hz: num(b, `${p}_lpf2_static_hz`) },
    notches,
  };
}

export const dynOn = (d: Dyn) => d.min > 0 && d.max > d.min;

/** Пункты gyro_hardware_lpf — как в BF. */
export const HARDWARE_LPF = ["NORMAL", "OPTION_1", "OPTION_2", "EXPERIMENTAL"] as const;
export interface ChipFilter {
  option: (typeof HARDWARE_LPF)[number];
  /** полоса чипа, Гц (примерно) */
  hz: number;
  /** задержка чипа, мс (примерно) */
  ms: number;
  /** шире проверенного NORMAL — больше шума и наложения */
  wide: boolean;
  /** изменён и ещё не действует: чип настраивается при запуске */
  restart: boolean;
}

/** 065: фильтр в чипе гироскопа — выбранный пункт и его полоса из таблицы платы (заголовок params). */
export function chipFilter(b: CopterBoard): ChipFilter | null {
  const table = b.header?.gyroHw;
  if (!table?.length || !b.params.gyro_hardware_lpf) return null;
  const v = String("gyro_hardware_lpf" in b.pending ? b.pending.gyro_hardware_lpf : b.params.gyro_hardware_lpf.value);
  const i = Math.max(0, HARDWARE_LPF.indexOf(v as ChipFilter["option"]));
  const [hz, us] = table[i] ?? table[0];
  return { option: HARDWARE_LPF[i], hz, ms: us / 1000, wide: i > 0, restart: b.edited.includes("gyro_hardware_lpf") };
}

/** Срез динамического ФНЧ при газе 0..1 (как dynLpfHz прошивки). */
export function dynHz(d: Dyn, throttle: number): number {
  const t = Math.min(1, Math.max(0, throttle));
  return d.min + (d.max - d.min) * (t + (t * (1 - t) * d.expo) / 10);
}

/** Срез 1-й ступени при этом газе. */
export function lpf1Hz(c: Chain, throttle: number): number {
  return dynOn(c.dyn) ? dynHz(c.dyn, throttle) : c.lpf1.hz;
}

export const notchOn = (n: Notch) => n.hz > 0 && n.cutoff > 0 && n.cutoff < n.hz;
export const notchQ = (n: Notch) => (n.hz * n.cutoff) / (n.hz * n.hz - n.cutoff * n.cutoff);

type Cx = [number, number];
const mul = (a: Cx, b: Cx): Cx => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a: Cx, b: Cx): Cx => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
const CORR: Record<number, number> = { 1: 1, 2: 1.553773974, 3: 1.961459177 };

function lowpassAt(s: Stage, f: number): Cx {
  if (s.hz <= 0) return [1, 0];
  const x = f / s.hz;
  if (s.type === "BIQUAD") return div([1, 0], [1 - x * x, x / Math.SQRT1_2]);
  const n = s.type === "PT3" ? 3 : s.type === "PT2" ? 2 : 1;
  const one = div([1, 0], [1, x / CORR[n]]);
  let r = one;
  for (let i = 1; i < n; i++) r = mul(r, one);
  return r;
}

function notchAt(n: Notch, f: number): Cx {
  if (!notchOn(n)) return [1, 0];
  const x = f / n.hz;
  const re = 1 - x * x;
  return div([re, 0], [re, x / notchQ(n)]);
}

function chainAt(c: Chain, f: number, throttle: number): Cx {
  let r = mul(lowpassAt({ type: c.lpf1.type, hz: lpf1Hz(c, throttle) }, f), lowpassAt(c.lpf2, f));
  for (const n of c.notches) r = mul(r, notchAt(n, f));
  return r;
}

/** Усиление, дБ (0 — проходит, −20 — в 10 раз тише). */
export function gainDb(c: Chain, f: number, throttle = 0): number {
  const [re, im] = chainAt(c, f, throttle);
  return 20 * Math.log10(Math.max(1e-6, Math.hypot(re, im)));
}

/** Ответ цепочки на частоте f: [re, im] (для контура — core/pidStep.ts). */
export const response = (c: Chain, f: number, throttle = 0): [number, number] => chainAt(c, f, throttle);

/** Фаза цепочки на частоте f, рад, с развёрткой (шагами от 1 Гц; отрицательная — запаздывание). */
function phaseRad(c: Chain, f: number, throttle: number): number {
  let prev = 0;
  let total = 0;
  const steps = 48;
  for (let i = 1; i <= steps; i++) {
    const fi = Math.pow(f, i / steps);
    const [re, im] = chainAt(c, fi, throttle);
    const a = Math.atan2(im, re);
    let d = a - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = a;
  }
  return total;
}

/** Запаздывание фазы на частоте f, ° (0 — без задержки, 90 — на четверть периода позже). */
export const lagDeg = (c: Chain, f: number, throttle = 0) => (-phaseRad(c, f, throttle) * 180) / Math.PI;

/** Задержка цепочки на частоте f, мс (запаздывание фазы / 360·f). */
export function delayMs(c: Chain, f: number, throttle = 0): number {
  return (-phaseRad(c, f, throttle) / (2 * Math.PI * f)) * 1000;
}

/** Верх шкалы спектра, дБ над 0.01 °/с (100 °/с). */
export const SPECTRUM_DB_MAX = 80;

/** Полосы спектра без постоянной (вращение коптера); peak — выше соседей и среднего вдвое (по мощности). */
export function spectrumBars(s: CopterSpectrum): { hz: number; db: number; peak: boolean }[] {
  const db = s.db;
  const mean = db.length > 1 ? db.slice(1).reduce((a, v) => a + v, 0) / (db.length - 1) : 0;
  return db
    .map((v, k) => ({ hz: k * s.bw, db: v, peak: k > 1 && k < db.length - 1 && v > db[k - 1] && v >= db[k + 1] && v > mean + 3 }))
    .filter((b) => b.hz > 0);
}

/** Где стоят режекторы RPM-фильтра: гармоники 1×, 2×, 3× каждого мотора, Гц (без повторов). */
export function rpmMarks(rpm: number[], harmonics: number): number[] {
  const out = new Set<number>();
  for (const hz of rpm) {
    if (hz <= 0) continue;
    for (let h = 1; h <= Math.min(3, harmonics); h++) out.add(Math.round(hz * h));
  }
  return [...out].sort((a, b) => a - b);
}

/** Точки АЧХ (дБ) или ФЧХ (запаздывание, °) от fMin до fMax (лог-шкала). */
export function curve(c: Chain, throttle: number, fMin = 20, fMax = 1000, n = 120, kind: "gain" | "lag" = "gain"): [number, number][] {
  // фаза — одной развёрткой по всей сетке (lagDeg на каждой точке — 48 шагов заново)
  let prev = 0;
  let total = kind === "lag" ? phaseRad(c, fMin, throttle) : 0;
  return Array.from({ length: n }, (_, i) => {
    const f = fMin * Math.pow(fMax / fMin, i / (n - 1));
    if (kind === "gain") return [f, gainDb(c, f, throttle)];
    const [re, im] = chainAt(c, f, throttle);
    const a = Math.atan2(im, re);
    if (i) {
      let d = a - prev;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      total += d;
    }
    prev = a;
    return [f, (-total * 180) / Math.PI];
  });
}
