// Журнал с chirp → измерение и предложение настройки. Запись QCHIRP чёрного
// ящика режется на свипы (по номеру свипа), по каждой оси считается частотная
// характеристика и модель (sysid.ts), затем — настройка (autotune.ts). Наружу —
// простые числа и массивы: расчёт идёт в воркере (tuneworker.ts), окно только
// рисует. Числа PID — в единицах Betaflight, как в таблице и в CLI.

import { angleLoop, angleMarginsOf, AxisData, axisDataOf, Controller, DEFAULT_LIMITS, emptyController, frequencyGrid, Limits, loop, Margins, margins, marginsOf, noiseRms, Proposal, simulateStep, Step, synthesize } from "./autotune";
import { cabs, carg, estimate, fit, Plant, plantAt, plantValid, Response } from "./sysid";

export const AXIS_NAMES = ["roll", "pitch", "yaw"] as const;

// Единицы Betaflight → команда смесителя на °/с (plane/include/copter/Presets.h).
const BF_P = 0.032029e-3,
  BF_I = 0.244381e-3,
  BF_D = 0.000529e-3,
  BF_F = 0.013754e-5,
  BF_YAW_I = 2.5;
export const BF_MAX = { p: 250, i: 250, d: 250, f: 1000 };

export interface BfGains {
  p: number;
  i: number;
  d: number;
  f: number;
}

export function gainsFromBf(g: BfGains, axis: number): { p: number; i: number; d: number; ff: number } {
  return { p: g.p * BF_P, i: g.i * BF_I * (axis === 2 ? BF_YAW_I : 1), d: g.d * BF_D, ff: g.f * BF_F };
}

/** В единицы BF: целые, в границах настроек; clamped — упёрлось в границу. */
export function gainsToBf(c: { p: number; i: number; d: number; ff: number }, axis: number): { bf: BfGains; clamped: boolean } {
  const raw = { p: c.p / BF_P, i: c.i / (BF_I * (axis === 2 ? BF_YAW_I : 1)), d: c.d / BF_D, f: c.ff / BF_F };
  const bf: BfGains = {
    p: Math.min(BF_MAX.p, Math.round(raw.p)),
    i: Math.min(BF_MAX.i, Math.round(raw.i)),
    d: Math.min(BF_MAX.d, Math.round(raw.d)),
    f: Math.min(BF_MAX.f, Math.round(raw.f)),
  };
  return { bf, clamped: raw.p > BF_MAX.p + 0.5 || raw.i > BF_MAX.i + 0.5 || raw.d > BF_MAX.d + 0.5 || raw.f > BF_MAX.f + 0.5 };
}

const numbers = (text: string | undefined) => (text ?? "").trim().split(/\s+/).filter(Boolean).map(Number);

/** Регулятор оси, как он был в полёте: из заголовка журнала. */
export function controllerFromInfo(info: Record<string, string>, axis: number): { controller: Controller; bf: BfGains } {
  const loopHz = Number(info.loop_hz) || 1000;
  const [p = 0, i = 0, d = 0, f = 0] = numbers(info[`pid.${AXIS_NAMES[axis]}`]);
  const dmax = numbers(info["pid.dmax"])[axis] ?? 0;
  const bf: BfGains = { p, i, d: Math.max(d, dmax), f };
  const c = emptyController(1 / loopHz);
  Object.assign(c, gainsFromBf(bf, axis));
  const chain = numbers(info["filter.dterm"]);
  if (chain.length >= 8) {
    // тип и срез двух ступеней, динамический срез первой (берётся нижний), режектор
    c.dLpf1 = { type: chain[0], hz: chain[4] > 0 && chain[5] > chain[4] ? chain[4] : chain[1] };
    c.dLpf2 = { type: chain[2], hz: chain[3] };
    c.dNotchHz = chain[6];
    c.dNotchCutoffHz = chain[7];
  } else {
    c.dLpf1 = { type: 0, hz: Number(info["filter.dterm_lpf_hz"]) || 0 };
  }
  c.outputLpfHz = axis === 2 ? Number(info["filter.yaw_lpf_hz"]) || 0 : 0;
  c.levelGain = axis === 2 ? 0 : Number(info["tune.level_gain"]) || 8;
  return { controller: c, bf };
}

/** Обычная ступенька стиком: расход на 40 % стика (как кривая расходов прошивки). */
export function stepDpsFromInfo(info: Record<string, string>, axis: number): number {
  const [center = 200, max = 670, expo = 0.5] = numbers(info[`rates.${AXIS_NAMES[axis]}`]);
  const x = 0.4;
  const v = center * x + (Math.max(center, max) - center) * x * Math.pow(x, 1 + 4 * expo);
  return v > 1 ? v : 200;
}

export interface Sweep {
  axis: number;
  run: number;
  r: Float64Array;
  u: Float64Array;
  y: Float64Array;
  yf: Float64Array;
  sampleHz: number;
  seconds: number;
  /** до какой частоты дошёл, Гц */
  reachedHz: number;
}

/** Колонки записи QCHIRP (время — секунды). */
export interface ChirpSeries {
  t: ArrayLike<number>;
  excite: ArrayLike<number>;
  command: ArrayLike<number>;
  gyro: ArrayLike<number>;
  gyrof: ArrayLike<number>;
  hz: ArrayLike<number>;
  axis: ArrayLike<number>;
  run: ArrayLike<number>;
}

/** Свипы журнала: подряд идущие записи с одним номером свипа. */
export function sweepsOf(s: ChirpSeries): Sweep[] {
  const out: Sweep[] = [];
  const n = s.t.length;
  let start = 0;
  for (let k = 1; k <= n; k++) {
    if (k < n && s.run[k] === s.run[start] && s.axis[k] === s.axis[start]) continue;
    const count = k - start;
    const seconds = s.t[k - 1] - s.t[start];
    if (count >= 512 && seconds > 0) {
      const pick = (col: ArrayLike<number>) => {
        const a = new Float64Array(count);
        for (let i = 0; i < count; i++) a[i] = col[start + i];
        return a;
      };
      out.push({
        axis: s.axis[start],
        run: s.run[start],
        r: pick(s.excite),
        u: pick(s.command),
        y: pick(s.gyro),
        yf: pick(s.gyrof),
        sampleHz: (count - 1) / seconds,
        seconds,
        reachedHz: s.hz[k - 1],
      });
    }
    start = k;
  }
  return out;
}

export interface BandPoint {
  hz: number;
  /** |G|, дБ: (°/с) на единицу команды */
  db: number;
  /** фаза G, ° (развёрнутая) */
  phase: number;
  coherence: number;
  /** контур, как он летал */
  loopRe: number;
  loopIm: number;
}

export interface TuneSide {
  bf: BfGains;
  /** запасы контура угловой скорости (по модели) */
  margins: Margins;
  /** и в ANGLE (у рысканья — те же) */
  angleMargins: Margins;
  /** шум гироскопа на моторах, СКЗ, доля хода */
  noise: number;
  step: Step;
  /** ступенька по циклам, доля уставки */
  trace: number[];
  /** контур на сетке частот */
  loopRe: number[];
  loopIm: number[];
}

export interface AxisReport {
  axis: number;
  seconds: number;
  sampleHz: number;
  reachedHz: number;
  bands: BandPoint[];
  plant: Plant;
  /** годных полос (когерентность ≥ 0.5) */
  goodBands: number;
  /** сетка частот для кривых */
  hz: number[];
  modelDb: number[];
  modelPhase: number[];
  /** запасы по самой записи (без модели); null — мало данных */
  flown: Margins | null;
  now: TuneSide;
  next: (TuneSide & { noiseLimit: number; clamped: boolean }) | null;
  stepDps: number;
}

export type TuneProblem = "no_chirp" | "axis_missing" | "short_sweep" | "low_rate" | "bad_fit" | "no_proposal";

export interface TuneReport {
  /** отчёты по осям: крен, тангаж, рысканье; null — оси в журнале нет */
  axes: (AxisReport | null)[];
  loopHz: number;
  dtermLpfHz: { now: number; next: number };
  found: boolean;
  problems: { kind: TuneProblem; axis?: number }[];
  /** команды CLI, которыми предложение записывается */
  commands: string[];
}

function side(data: AxisData, c: Controller, bf: BfGains, hz: number[]): TuneSide {
  const L = loop(data, c, hz);
  const trace: number[] = [];
  const step = simulateStep(data, c, trace);
  return {
    bf,
    margins: margins(hz, L),
    angleMargins: c.levelGain > 0 ? margins(hz, angleLoop(data, c, hz)) : margins(hz, L),
    noise: noiseRms(data, c),
    step,
    trace,
    loopRe: L.map((v) => v.re),
    loopIm: L.map((v) => v.im),
  };
}

function flownMargins(resp: Response): Margins | null {
  const good = resp.bands.filter((b) => b.coherence >= 0.6);
  if (good.length < 12) return null;
  return margins(
    good.map((b) => b.hz),
    good.map((b) => b.loop),
  );
}

/** Свип дошёл хотя бы до этой доли конечной частоты — годится. */
const MIN_REACH = 0.7;

/** Измерение и предложение настройки по свипам журнала. */
export function analyze(series: ChirpSeries | null, info: Record<string, string>, limits: Limits = DEFAULT_LIMITS): TuneReport {
  const loopHz = Number(info.loop_hz) || 1000;
  const report: TuneReport = { axes: [null, null, null], loopHz, dtermLpfHz: { now: 0, next: 0 }, found: false, problems: [], commands: [] };
  if (!series || series.t.length === 0) {
    report.problems.push({ kind: "no_chirp" });
    return report;
  }
  const sweeps = sweepsOf(series);
  // по оси — последний свип, дошедший до конца
  const endHz = Math.max(...sweeps.map((s) => s.reachedHz), 1);
  const data: (AxisData | null)[] = [null, null, null];
  const current: Controller[] = [];
  const bfNow: BfGains[] = [];
  const hz = frequencyGrid(1 / loopHz);
  for (let axis = 0; axis < 3; axis++) {
    const { controller, bf } = controllerFromInfo(info, axis);
    current.push(controller);
    bfNow.push(bf);
    const mine = sweeps.filter((s) => s.axis === axis);
    if (!mine.length) {
      report.problems.push({ kind: "axis_missing", axis });
      continue;
    }
    const full = mine.filter((s) => s.reachedHz >= MIN_REACH * endHz);
    const sweep = (full.length ? full : mine)[(full.length ? full : mine).length - 1];
    if (!full.length) report.problems.push({ kind: "short_sweep", axis });
    if (sweep.sampleHz < 0.6 * loopHz) report.problems.push({ kind: "low_rate", axis });
    const resp = estimate(sweep.r, sweep.u, sweep.y, sweep.yf, sweep.sampleHz);
    const plant = fit(resp, axis === 2);
    const stepDps = stepDpsFromInfo(info, axis);
    const axisData = axisDataOf(resp, plant, stepDps);
    // фаза измеренной ЧХ — развёрнутая вдоль частоты
    const bands: BandPoint[] = [];
    let prev = 0;
    for (const b of resp.bands) {
      let phase = carg(b.plant);
      if (bands.length) {
        while (phase - prev > Math.PI) phase -= 2 * Math.PI;
        while (phase - prev < -Math.PI) phase += 2 * Math.PI;
      }
      prev = phase;
      bands.push({ hz: b.hz, db: 20 * Math.log10(Math.max(1e-12, cabs(b.plant))), phase: (phase * 180) / Math.PI, coherence: b.coherence, loopRe: b.loop.re, loopIm: b.loop.im });
    }
    const ok = plantValid(plant) && plant.error < 0.35;
    if (!ok) report.problems.push({ kind: "bad_fit", axis });
    const model = hz.map((f) => plantAt(plant, f));
    let mp = 0;
    const modelPhase = model.map((v, k) => {
      let ph = carg(v);
      if (k) {
        while (ph - mp > Math.PI) ph -= 2 * Math.PI;
        while (ph - mp < -Math.PI) ph += 2 * Math.PI;
      }
      mp = ph;
      return (ph * 180) / Math.PI;
    });
    // оборванный свип показывается, но настройку по нему не считаем: верхние частоты (задержки) не измерены
    if (ok && full.length) data[axis] = axisData;
    report.axes[axis] = {
      axis,
      seconds: sweep.seconds,
      sampleHz: sweep.sampleHz,
      reachedHz: sweep.reachedHz,
      bands,
      plant,
      goodBands: resp.bands.filter((b) => b.coherence >= 0.5).length,
      hz,
      modelDb: model.map((v) => 20 * Math.log10(Math.max(1e-12, cabs(v)))),
      modelPhase,
      flown: flownMargins(resp),
      now: ok ? side(axisData, controller, bf, hz) : { bf, margins: marginsOf(axisData, controller), angleMargins: angleMarginsOf(axisData, controller), noise: 0, step: { rise: 0, overshoot: 0, error: 0, stable: false }, trace: [], loopRe: [], loopIm: [] },
      next: null,
      stepDps,
    };
  }
  report.dtermLpfHz.now = current[0].dLpf1.hz;
  if (data.some((d) => !d)) return report;
  const proposal: Proposal = synthesize(data as AxisData[], current, limits);
  if (!proposal.found) {
    report.problems.push({ kind: "no_proposal" });
    return report;
  }
  report.found = true;
  report.dtermLpfHz.next = proposal.dtermLpfHz;
  for (let axis = 0; axis < 3; axis++) {
    const r = proposal.axis[axis];
    // то, что на самом деле запишется: целые единицы BF в границах настроек
    const { bf, clamped } = gainsToBf(r.controller, axis);
    const applied: Controller = { ...r.controller, ...gainsFromBf(bf, axis) };
    const s = side(data[axis] as AxisData, applied, bf, hz);
    (report.axes[axis] as AxisReport).next = { ...s, noiseLimit: r.noiseLimit, clamped };
    const name = AXIS_NAMES[axis];
    report.commands.push(`set p_${name} = ${bf.p}`, `set i_${name} = ${bf.i}`, `set d_${name} = ${bf.d}`, `set d_max_${name} = ${bf.d}`, `set f_${name} = ${bf.f}`);
  }
  report.commands.push(`set dterm_lpf1_dyn_min_hz = 0`, `set dterm_lpf1_dyn_max_hz = 0`, `set dterm_lpf1_static_hz = ${proposal.dtermLpfHz}`);
  return report;
}
