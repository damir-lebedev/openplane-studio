// Автонастройка контура угловой скорости по измеренной модели. Те же формулы
// и тот же перебор, что в прошивке (plane/include/copter/AutoTune.h — там
// объяснение и обоснование порогов); сверка — autotune.test.ts.
//
//   команда = −C(z)·F(z)·гироскоп,  C = [P + I·dt/(1 − z⁻¹) + D·(1 − z⁻¹)/dt·Fd(z)]·Fвых(z)
//   L(jω) = C·F·G; в ANGLE к обратной связи добавляются контур горизонта и
//   упреждение от скорости уставки.
// Ищется наибольшая частота среза при запасах 45° / 6 дБ / |S| ≤ 6 дБ (в ACRO
// и в ANGLE), шуме гироскопа на моторах в бюджете и ступеньке не хуже текущей.

import { cabs, cadd, carg, cdiv, cmul, cnorm, cpolar, cscale, cx, Cx, Plant, plantAt, plantValid, Response } from "./sysid";

export const FF_LPF_HZ = 25;

/** Тип ступени ФНЧ — номера как в прошивке и в CLI Betaflight. */
export const PT1 = 0,
  BIQUAD = 1,
  PT2 = 2,
  PT3 = 3;

export interface Stage {
  type: number;
  hz: number;
}

const zInv = (hz: number, dt: number) => cpolar(1, -2 * Math.PI * hz * dt);
const ONE = cx(1);

/** ЧХ дискретного ФНЧ прошивки на частоте hz. */
export function lowpassAt(s: Stage, hz: number, dt: number): Cx {
  if (s.hz <= 0 || s.hz >= 0.49 / dt) return ONE;
  const z1 = zInv(hz, dt);
  if (s.type === BIQUAD) {
    const omega = 2 * Math.PI * s.hz * dt;
    const sn = Math.sin(omega),
      cs = Math.cos(omega);
    const alpha = sn / (2 * 0.70710678);
    const a0 = 1 + alpha;
    const b0 = ((1 - cs) * 0.5) / a0,
      b1 = (1 - cs) / a0;
    const a1 = (-2 * cs) / a0,
      a2 = (1 - alpha) / a0;
    const z2 = cmul(z1, z1);
    return cdiv(cadd(cadd(cx(b0), cscale(z1, b1)), cscale(z2, b0)), cadd(cadd(ONE, cscale(z1, a1)), cscale(z2, a2)));
  }
  const order = s.type === PT3 ? 3 : s.type === PT2 ? 2 : 1;
  const correction = order === 2 ? 1.553773974 : order === 3 ? 1.961459177 : 1;
  const k = 1 - Math.exp(-2 * Math.PI * s.hz * correction * dt);
  const one = cdiv(cx(k), cadd(ONE, cscale(z1, -(1 - k))));
  let r = one;
  for (let i = 1; i < order; i++) r = cmul(r, one);
  return r;
}

/** Режектор (биквад): центр и «cutoff» — нижний край полосы, как в BF. */
export function notchAt(centerHz: number, cutoffHz: number, hz: number, dt: number): Cx {
  if (centerHz <= 0 || cutoffHz <= 0 || cutoffHz >= centerHz || centerHz >= 0.49 / dt) return ONE;
  const q = (centerHz * cutoffHz) / (centerHz * centerHz - cutoffHz * cutoffHz);
  const omega = 2 * Math.PI * centerHz * dt;
  const alpha = Math.sin(omega) / (2 * q),
    cs = Math.cos(omega);
  const a0 = 1 + alpha;
  const z1 = zInv(hz, dt);
  const z2 = cmul(z1, z1);
  return cdiv(cadd(cadd(cx(1 / a0), cscale(z1, (-2 * cs) / a0)), cscale(z2, 1 / a0)), cadd(cadd(ONE, cscale(z1, (-2 * cs) / a0)), cscale(z2, (1 - alpha) / a0)));
}

/** Регулятор одной оси; коэффициенты — как в прошивке (команда смесителя на °/с). */
export interface Controller {
  p: number;
  i: number;
  d: number;
  ff: number;
  dLpf1: Stage;
  dLpf2: Stage;
  dNotchHz: number;
  dNotchCutoffHz: number;
  /** рысканье: yaw_lowpass_hz (PT1) */
  outputLpfHz: number;
  /** ANGLE: (°/с) на градус ошибки угла; 0 — оси в ANGLE нет (рысканье) */
  levelGain: number;
  dt: number;
}

export const emptyController = (dt = 0.001): Controller => ({
  p: 0,
  i: 0,
  d: 0,
  ff: 0,
  dLpf1: { type: PT1, hz: 0 },
  dLpf2: { type: PT1, hz: 0 },
  dNotchHz: 0,
  dNotchCutoffHz: 0,
  outputLpfHz: 0,
  levelGain: 0,
  dt,
});

export function dFilterAt(c: Controller, hz: number): Cx {
  return cmul(cmul(lowpassAt(c.dLpf1, hz, c.dt), lowpassAt(c.dLpf2, hz, c.dt)), notchAt(c.dNotchHz, c.dNotchCutoffHz, hz, c.dt));
}

/** D-часть: от гироскопа (после фильтров) к команде, без знака. */
export function dPathAt(c: Controller, hz: number): Cx {
  const z1 = zInv(hz, c.dt);
  return cmul(cscale({ re: 1 - z1.re, im: -z1.im }, c.d / c.dt), dFilterAt(c, hz));
}

/** C(z): от гироскопа после фильтров к команде (обратная связь, без знака). */
export function controllerAt(c: Controller, hz: number): Cx {
  const z1 = zInv(hz, c.dt);
  const integrator = cdiv(cx(c.dt), { re: 1 - z1.re, im: -z1.im });
  let r = cadd(cadd(cx(c.p), cscale(integrator, c.i)), dPathAt(c, hz));
  if (c.outputLpfHz > 0) r = cmul(r, lowpassAt({ type: PT1, hz: c.outputLpfHz }, hz, c.dt));
  return r;
}

/** Добавка к обратной связи в ANGLE — от гироскопа до фильтров: контур горизонта и упреждение. */
export function angleAt(c: Controller, hz: number): Cx {
  if (c.levelGain <= 0) return cx(0);
  const z1 = zInv(hz, c.dt);
  const integrator = cdiv(cx(c.dt), { re: 1 - z1.re, im: -z1.im });
  const level = cscale(cmul(cadd(cx(c.p), cscale(integrator, c.i)), integrator), c.levelGain);
  return cadd(level, cscale(lowpassAt({ type: PT1, hz: FF_LPF_HZ }, hz, c.dt), c.ff * c.levelGain));
}

/** Кривая по частоте (измеренная): между точками — по логарифму частоты. */
export class Curve {
  hz: number[] = [];
  lnMag: number[] = [];
  phase: number[] = [];

  add(f: number, v: Cx) {
    const m = cabs(v);
    if (!(f > 0) || !(m > 0)) return;
    let ph = carg(v);
    if (this.phase.length) {
      const last = this.phase[this.phase.length - 1];
      while (ph - last > Math.PI) ph -= 2 * Math.PI;
      while (ph - last < -Math.PI) ph += 2 * Math.PI;
    }
    this.hz.push(f);
    this.lnMag.push(Math.log(m));
    this.phase.push(ph);
  }

  at(f: number): Cx {
    const n = this.hz.length;
    if (!n) return cx(1);
    if (f <= this.hz[0]) return cpolar(Math.exp(this.lnMag[0]), this.phase[0]);
    if (f >= this.hz[n - 1]) return cpolar(Math.exp(this.lnMag[n - 1]), this.phase[n - 1]);
    let k = 1;
    while (this.hz[k] < f) k++;
    const t = Math.log(f / this.hz[k - 1]) / Math.log(this.hz[k] / this.hz[k - 1]);
    return cpolar(Math.exp(this.lnMag[k - 1] + t * (this.lnMag[k] - this.lnMag[k - 1])), this.phase[k - 1] + t * (this.phase[k] - this.phase[k - 1]));
  }
}

export interface Noise {
  hz: number[];
  /** СПМ шума гироскопа до фильтров, (°/с)²/Гц */
  psd: number[];
}

/** Объект и фильтры гироскопа одной оси — то, что измерено. */
export interface AxisData {
  plant: Plant;
  gyroFilter: Curve;
  noise: Noise;
  /** обычная ступенька стиком по этой оси, °/с (расход на 40 % стика) */
  stepDps: number;
}

export function axisDataOf(resp: Response, plant: Plant, stepDps: number): AxisData {
  const gyroFilter = new Curve();
  const noise: Noise = { hz: [], psd: [] };
  for (const b of resp.bands) {
    gyroFilter.add(b.hz, b.gyroFilter);
    noise.hz.push(b.hz);
    noise.psd.push(b.noise);
  }
  return { plant, gyroFilter, noise, stepDps };
}

export const NOISE_FROM_HZ = 20;

/** СКЗ шума гироскопа на входе смесителя (доля хода моторов). */
export function noiseRms(a: AxisData, c: Controller): number {
  const n = a.noise;
  let sum = 0,
    prev = 0;
  for (let k = 0; k < n.hz.length; k++) {
    const f = n.hz[k];
    const v = n.psd[k] * cnorm(cadd(cmul(controllerAt(c, f), a.gyroFilter.at(f)), angleAt(c, f)));
    if (k > 0 && n.hz[k - 1] >= NOISE_FROM_HZ) sum += 0.5 * (prev + v) * (f - n.hz[k - 1]);
    prev = v;
  }
  return Math.sqrt(sum);
}

export interface Margins {
  crossoverHz: number;
  phaseMarginDeg: number;
  gainMarginDb: number;
  sensitivityDb: number;
  sensitivityHz: number;
}

export const marginsOk = (m: Margins, pm: number, gm: number, ms: number) => m.crossoverHz > 0 && m.phaseMarginDeg >= pm && m.gainMarginDb >= gm && m.sensitivityDb <= ms;

export const GRID_FROM_HZ = 0.2;
export const GRID_POINTS = 240;

export function frequencyGrid(dt: number): number[] {
  const g: number[] = [];
  const hi = 0.49 / dt;
  for (let i = 0; i < GRID_POINTS; i++) g.push(GRID_FROM_HZ * Math.pow(hi / GRID_FROM_HZ, i / (GRID_POINTS - 1)));
  return g;
}

/**
 * Запасы по значениям L на сетке (re, im — раздельно). Срез — первое
 * пересечение |L| = 1 сверху вниз; запас по фазе — худший из всех пересечений
 * единицы; по усилению — худший из всех проходов фазы через −180° − 360°·n.
 */
export function marginsOfArrays(hz: ArrayLike<number>, re: ArrayLike<number>, im: ArrayLike<number>): Margins {
  const m: Margins = { crossoverHz: 0, phaseMarginDeg: 180, gainMarginDb: 60, sensitivityDb: 0, sensitivityHz: 0 };
  const n = hz.length;
  if (n < 2) return m;
  let prevMag = Math.hypot(re[0], im[0]),
    prevPhase = Math.atan2(im[0], re[0]);
  // далеко внизу контур с интегралом — двойной интегратор: фаза у −180°, а не у +180°
  if (prevPhase > 0) prevPhase -= 2 * Math.PI;
  let peak = 1 / Math.hypot(1 + re[0], im[0]);
  m.sensitivityHz = hz[0];
  for (let k = 1; k < n; k++) {
    const mag = Math.hypot(re[k], im[k]);
    let phase = Math.atan2(im[k], re[k]);
    while (phase - prevPhase > Math.PI) phase -= 2 * Math.PI;
    while (phase - prevPhase < -Math.PI) phase += 2 * Math.PI;
    const s = 1 / Math.hypot(1 + re[k], im[k]);
    if (s > peak) {
      peak = s;
      m.sensitivityHz = hz[k];
    }
    if ((prevMag - 1) * (mag - 1) < 0) {
      const t = Math.log(prevMag) / (Math.log(prevMag) - Math.log(mag));
      const at = hz[k - 1] * Math.pow(hz[k] / hz[k - 1], t);
      const pm = 180 + ((prevPhase + t * (phase - prevPhase)) * 180) / Math.PI;
      if (m.crossoverHz === 0 && prevMag > mag) m.crossoverHz = at;
      m.phaseMarginDeg = Math.min(m.phaseMarginDeg, pm);
    }
    const a = (prevPhase + Math.PI) / (2 * Math.PI),
      b = (phase + Math.PI) / (2 * Math.PI);
    if (Math.floor(a) !== Math.floor(b)) {
      const edge = (prevPhase > phase ? Math.floor(a) : Math.floor(b)) * 2 * Math.PI - Math.PI;
      const t = (edge - prevPhase) / (phase - prevPhase);
      const at = Math.exp(Math.log(prevMag) + t * (Math.log(mag) - Math.log(prevMag)));
      m.gainMarginDb = Math.min(m.gainMarginDb, Math.abs(20 * Math.log10(at)));
    }
    prevMag = mag;
    prevPhase = phase;
  }
  m.sensitivityDb = 20 * Math.log10(peak);
  if (m.crossoverHz === 0) m.phaseMarginDeg = 0;
  return m;
}

export function margins(hz: number[], L: Cx[]): Margins {
  return marginsOfArrays(
    hz,
    L.map((v) => v.re),
    L.map((v) => v.im),
  );
}

/** Контур оси на сетке частот. */
export function loop(a: AxisData, c: Controller, hz: number[]): Cx[] {
  return hz.map((f) => cmul(cmul(controllerAt(c, f), a.gyroFilter.at(f)), plantAt(a.plant, f)));
}

/** То же в ANGLE: с контуром горизонта и упреждением от скорости уставки. */
export function angleLoop(a: AxisData, c: Controller, hz: number[]): Cx[] {
  return hz.map((f) => cmul(cadd(cmul(controllerAt(c, f), a.gyroFilter.at(f)), angleAt(c, f)), plantAt(a.plant, f)));
}

export function marginsOf(a: AxisData, c: Controller): Margins {
  const hz = frequencyGrid(c.dt);
  return margins(hz, loop(a, c, hz));
}

export function angleMarginsOf(a: AxisData, c: Controller): Margins {
  const hz = frequencyGrid(c.dt);
  return margins(hz, angleLoop(a, c, hz));
}

// ---------------- переходная на модели ----------------

export interface Step {
  /** до 90 % уставки, с */
  rise: number;
  /** перелёт, доля уставки */
  overshoot: number;
  /** интеграл |уставка − отклик|, доля уставки × с */
  error: number;
  stable: boolean;
}

export const STEP_SECONDS = 0.45;
export const STEP_SETPOINT_HZ = 90;
export const MIXER_LIMIT = 0.5;
export const RELAX_DPS = 40;
export const RELAX_HZ = 10;

/**
 * Ступенька уставки угловой скорости на модели: тот же дискретный регулятор,
 * объект — интегратор с запаздыванием мотора и задержкой, команда — не больше
 * того, что пропустит смеситель. trace — отклик по циклам, доля уставки.
 */
export function simulateStep(a: AxisData, c: Controller, trace?: number[]): Step {
  const out: Step = { rise: 0, overshoot: 0, error: 0, stable: true };
  const g = a.plant;
  if (!plantValid(g)) return out;
  const dt = c.dt;
  const STEP_DPS = a.stepDps > 0 ? a.stepDps : 200;
  const SUB = 4;
  const h = dt / SUB;
  const f0 = 20;
  const gyroDelay = Math.max(0, -carg(a.gyroFilter.at(f0)) / (2 * Math.PI * f0));
  const delay = Math.max(0, g.delay - 0.5 * dt) + gyroDelay;
  const line = Math.round(delay / h) + 1;
  const queue = new Float64Array(line);
  let head = 0;
  const pt1 = (hz: number) => 1 - Math.exp(-2 * Math.PI * hz * dt);
  const kSp = pt1(STEP_SETPOINT_HZ * 1.961459177),
    kFf = pt1(FF_LPF_HZ),
    kRelax = pt1(RELAX_HZ);
  const kOut = c.outputLpfHz > 0 ? pt1(c.outputLpfHz) : 1;
  const dState: number[] = [],
    dK: number[] = [];
  for (const s of [c.dLpf1, c.dLpf2]) {
    if (s.hz <= 0 || s.hz >= 0.49 / dt) continue;
    const order = s.type === PT3 ? 3 : s.type === PT2 || s.type === BIQUAD ? 2 : 1;
    const correction = order === 2 ? 1.553773974 : order === 3 ? 1.961459177 : 1;
    for (let k = 0; k < order; k++) {
      dK.push(pt1(s.hz * correction));
      dState.push(0);
    }
  }
  let motor = 0,
    rate = 0;
  let sp1 = 0,
    sp2 = 0,
    sp3 = 0,
    spPrev = 0,
    spSlow = 0;
  let integral = 0,
    ffRate = 0,
    yPrev = 0,
    outState = 0;
  const ratio = g.tau > 0 ? g.zero / g.tau : 0;
  const steps = Math.trunc(STEP_SECONDS / dt);
  let peak = 0;
  for (let k = 0; k < steps; k++) {
    sp1 += kSp * (STEP_DPS - sp1);
    sp2 += kSp * (sp1 - sp2);
    sp3 += kSp * (sp2 - sp3);
    const sp = sp3;
    const y = rate;
    const error = sp - y;
    spSlow += kRelax * (sp - spSlow);
    const relax = Math.max(0, 1 - Math.abs(sp - spSlow) / RELAX_DPS);
    integral += c.i * error * dt * relax;
    ffRate += kFf * ((sp - spPrev) / dt - ffRate);
    spPrev = sp;
    let dRate = (y - yPrev) / dt;
    yPrev = y;
    for (let s = 0; s < dK.length; s++) {
      dState[s] += dK[s] * (dRate - dState[s]);
      dRate = dState[s];
    }
    let u = c.p * error + integral - c.d * dRate + c.ff * ffRate;
    outState += kOut * (u - outState);
    u = outState;
    if (u > MIXER_LIMIT) u = MIXER_LIMIT;
    if (u < -MIXER_LIMIT) u = -MIXER_LIMIT;
    for (let s = 0; s < SUB; s++) {
      queue[head] = u;
      head = (head + 1) % line;
      const ud = queue[head];
      motor += ((ud - motor) * h) / g.tau;
      rate += g.gain * (ratio * ud + (1 - ratio) * motor) * h;
    }
    const norm = rate / STEP_DPS;
    out.error += Math.abs(sp / STEP_DPS - norm) * dt;
    if (trace) trace.push(norm);
    if (out.rise === 0 && norm >= 0.9) out.rise = (k + 1) * dt;
    peak = Math.max(peak, norm);
    if (!(Math.abs(norm) < 20)) out.stable = false;
  }
  out.overshoot = Math.max(0, peak - 1);
  if (out.rise === 0) out.rise = STEP_SECONDS;
  if (Math.abs(rate / STEP_DPS - 1) > 0.2) out.stable = false;
  return out;
}

// ---------------- синтез ----------------

export interface Limits {
  phaseMarginDeg: number;
  gainMarginDb: number;
  sensitivityDb: number;
  /** СКЗ шума гироскопа на входе смесителя от одной оси, доля хода моторов */
  noise: number;
  /** текущая настройка шумит больше бюджета — не больше, чем она, и не больше этого */
  noiseCeiling: number;
  yawOvershoot: number;
  iRatio: number;
  yawShare: number;
  ffOvershoot: number;
  maxCrossoverShare: number;
}

export const DEFAULT_LIMITS: Limits = {
  phaseMarginDeg: 45,
  gainMarginDb: 6,
  sensitivityDb: 6,
  noise: 0.02,
  noiseCeiling: 0.06,
  yawOvershoot: 0.1,
  iRatio: 1 / 6,
  yawShare: 0.6,
  ffOvershoot: 0.05,
  maxCrossoverShare: 0.12,
};

export interface AxisResult {
  controller: Controller;
  /** контур угловой скорости (ACRO) */
  margins: Margins;
  /** он же в ANGLE (у рысканья — тот же) */
  angleMargins: Margins;
  step: Step;
  noise: number;
  noiseLimit: number;
  found: boolean;
}

const NO_MARGINS: Margins = { crossoverHz: 0, phaseMarginDeg: 180, gainMarginDb: 60, sensitivityDb: 0, sensitivityHz: 0 };
const NO_STEP: Step = { rise: 0, overshoot: 0, error: 0, stable: true };
const noResult = (): AxisResult => ({ controller: emptyController(), margins: NO_MARGINS, angleMargins: NO_MARGINS, step: NO_STEP, noise: 0, noiseLimit: 0, found: false });

/** «Быстрое» усиление объекта: у рысканья — с моментом разгона ротора (K·τz/τ). */
const fastGain = (g: Plant) => g.gain * Math.max(1, g.tau > 0 ? g.zero / g.tau : 1);

// Всё, что на частотах не зависит от искомых P, I, D, FF: один раз на ось и
// срез ФНЧ D. Комплексные — парами массивов (re, im).
interface Table {
  hz: number[];
  intR: Float64Array;
  intI: Float64Array;
  dR: Float64Array;
  dI: Float64Array;
  outR: Float64Array;
  outI: Float64Array;
  gR: Float64Array;
  gI: Float64Array;
  fR: Float64Array;
  fI: Float64Array;
  ffR: Float64Array;
  ffI: Float64Array;
}

function fillTable(a: AxisData, base: Controller, hz: number[], withPlant: boolean): Table {
  const n = hz.length;
  const t: Table = {
    hz,
    intR: new Float64Array(n),
    intI: new Float64Array(n),
    dR: new Float64Array(n),
    dI: new Float64Array(n),
    outR: new Float64Array(n),
    outI: new Float64Array(n),
    gR: new Float64Array(n),
    gI: new Float64Array(n),
    fR: new Float64Array(n),
    fI: new Float64Array(n),
    ffR: new Float64Array(n),
    ffI: new Float64Array(n),
  };
  const unit: Controller = { ...base, p: 0, i: 0, ff: 0, d: 1 };
  for (let k = 0; k < n; k++) {
    const f = hz[k];
    const z1 = zInv(f, base.dt);
    const g = withPlant ? plantAt(a.plant, f) : ONE;
    const integrator = cdiv(cx(base.dt), { re: 1 - z1.re, im: -z1.im });
    const d = dPathAt(unit, f);
    const o = base.outputLpfHz > 0 ? lowpassAt({ type: PT1, hz: base.outputLpfHz }, f, base.dt) : ONE;
    const filtered = cmul(a.gyroFilter.at(f), g);
    const ff = base.levelGain > 0 ? cmul(cscale(lowpassAt({ type: PT1, hz: FF_LPF_HZ }, f, base.dt), base.levelGain), g) : cx(0);
    t.intR[k] = integrator.re;
    t.intI[k] = integrator.im;
    t.dR[k] = d.re;
    t.dI[k] = d.im;
    t.outR[k] = o.re;
    t.outI[k] = o.im;
    t.gR[k] = g.re;
    t.gI[k] = g.im;
    t.fR[k] = filtered.re;
    t.fI[k] = filtered.im;
    t.ffR[k] = ff.re;
    t.ffI[k] = ff.im;
  }
  return t;
}

interface Tables {
  loop: Table;
  noise: Table;
  psd: number[];
  bufR: Float64Array;
  bufI: Float64Array;
  levelGain: number;
}

function makeTables(a: AxisData, base: Controller): Tables {
  const loopTable = fillTable(a, base, frequencyGrid(base.dt), true);
  return {
    loop: loopTable,
    noise: fillTable(a, base, a.noise.hz, false),
    psd: a.noise.psd,
    bufR: new Float64Array(loopTable.hz.length),
    bufI: new Float64Array(loopTable.hz.length),
    levelGain: base.levelGain,
  };
}

// обратная связь в точке k (без объекта и фильтра гироскопа): запись в out[0], out[1]
const pair = new Float64Array(2);
function rateFeedback(t: Table, k: number, c: Controller): void {
  const re = c.p + c.i * t.intR[k] + c.d * t.dR[k],
    im = c.i * t.intI[k] + c.d * t.dI[k];
  pair[0] = re * t.outR[k] - im * t.outI[k];
  pair[1] = re * t.outI[k] + im * t.outR[k];
}
function angleFeedback(t: Table, k: number, c: Controller, levelGain: number): void {
  // (p + i·int)·kL·int·G + ff·ffPath
  const ar = c.p + c.i * t.intR[k],
    ai = c.i * t.intI[k];
  const br = (ar * t.intR[k] - ai * t.intI[k]) * levelGain,
    bi = (ar * t.intI[k] + ai * t.intR[k]) * levelGain;
  pair[0] = br * t.gR[k] - bi * t.gI[k] + c.ff * t.ffR[k];
  pair[1] = br * t.gI[k] + bi * t.gR[k] + c.ff * t.ffI[k];
}

function rateMargins(t: Tables, c: Controller): Margins {
  const L = t.loop;
  for (let k = 0; k < L.hz.length; k++) {
    rateFeedback(L, k, c);
    t.bufR[k] = pair[0] * L.fR[k] - pair[1] * L.fI[k];
    t.bufI[k] = pair[0] * L.fI[k] + pair[1] * L.fR[k];
  }
  return marginsOfArrays(L.hz, t.bufR, t.bufI);
}

function angleMargins(t: Tables, c: Controller): Margins {
  const L = t.loop;
  for (let k = 0; k < L.hz.length; k++) {
    rateFeedback(L, k, c);
    const re = pair[0] * L.fR[k] - pair[1] * L.fI[k],
      im = pair[0] * L.fI[k] + pair[1] * L.fR[k];
    angleFeedback(L, k, c, t.levelGain);
    t.bufR[k] = re + pair[0];
    t.bufI[k] = im + pair[1];
  }
  return marginsOfArrays(L.hz, t.bufR, t.bufI);
}

function tableNoise(t: Tables, c: Controller): number {
  const N = t.noise;
  let sum = 0,
    prev = 0;
  for (let k = 0; k < N.hz.length; k++) {
    rateFeedback(N, k, c);
    const re = pair[0] * N.fR[k] - pair[1] * N.fI[k],
      im = pair[0] * N.fI[k] + pair[1] * N.fR[k];
    angleFeedback(N, k, c, t.levelGain);
    const tr = re + pair[0],
      ti = im + pair[1];
    const v = t.psd[k] * (tr * tr + ti * ti);
    if (k > 0 && N.hz[k - 1] >= NOISE_FROM_HZ) sum += 0.5 * (prev + v) * (N.hz[k] - N.hz[k - 1]);
    prev = v;
  }
  return Math.sqrt(sum);
}

/** Регулятор с заданными срезом, долей D и ФНЧ D: P — из |L(ωc)| = 1; упреждение — наибольшее возможное. */
function shaped(a: AxisData, base: Controller, crossoverHz: number, dOverP: number, iRatio: number): Controller {
  const c: Controller = { ...base, ff: 0, p: 1, i: 2 * Math.PI * crossoverHz * iRatio, d: dOverP };
  const mag = cabs(cmul(cmul(controllerAt(c, crossoverHz), a.gyroFilter.at(crossoverHz)), plantAt(a.plant, crossoverHz)));
  const p = mag > 0 ? 1 / mag : 0;
  c.p = p;
  c.i *= p;
  c.d *= p;
  c.ff = c.d + 1 / fastGain(a.plant);
  return c;
}

function feasible(t: Tables, c: Controller, lim: Limits, noiseLimit: number): { ok: boolean; margins: Margins; noise: number } {
  const m = rateMargins(t, c);
  if (!marginsOk(m, lim.phaseMarginDeg, lim.gainMarginDb, lim.sensitivityDb)) return { ok: false, margins: m, noise: 0 };
  const n = tableNoise(t, c);
  if (n > noiseLimit) return { ok: false, margins: m, noise: n };
  if (t.levelGain <= 0) return { ok: true, margins: m, noise: n };
  return { ok: marginsOk(angleMargins(t, c), lim.phaseMarginDeg, lim.gainMarginDb, lim.sensitivityDb), margins: m, noise: n };
}

function bestCrossover(a: AxisData, t: Tables, base: Controller, dOverP: number, lim: Limits, noiseLimit: number, maxHz: number): AxisResult | null {
  const minHz = 0.3;
  const SCAN = 48;
  let okHz = 0,
    badHz = maxHz;
  for (let i = 0; i <= SCAN; i++) {
    const f = maxHz * Math.pow(minHz / maxHz, i / SCAN);
    if (feasible(t, shaped(a, base, f, dOverP, lim.iRatio), lim, noiseLimit).ok) {
      okHz = f;
      break;
    }
    badHz = f;
  }
  if (okHz === 0) return null;
  for (let it = 0; it < 10 && badHz > okHz * 1.002; it++) {
    const mid = Math.sqrt(okHz * badHz);
    if (feasible(t, shaped(a, base, mid, dOverP, lim.iRatio), lim, noiseLimit).ok) okHz = mid;
    else badHz = mid;
  }
  const controller = shaped(a, base, okHz, dOverP, lim.iRatio);
  const f = feasible(t, controller, lim, noiseLimit);
  return { controller, margins: f.margins, angleMargins: f.margins, step: NO_STEP, noise: f.noise, noiseLimit, found: true };
}

export const D_SHARES = [0, 0.15, 0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5];
export const D_LPF_HZ = [30, 40, 50, 65, 80, 100, 125, 160, 200, 250];
export const FF_SHARES = [0.2, 0.6, 1];
export const FF_D_SHARES = [0, 0.5, 0.75, 0.9, 1];
export const STEP_ERROR_TOLERANCE = 1.02,
  STEP_RISE_TOLERANCE = 1;

/** Упреждение FF = c·D + доля/K: с наименьшим интегралом ошибки ступеньки среди тех, где перелёт в пределах. */
function tuneFeedforward(a: AxisData, t: Tables, r: AxisResult, lim: Limits): void {
  if (!r.found) return;
  const fast = fastGain(a.plant);
  const limit = t.levelGain > 0 ? lim.ffOvershoot : lim.yawOvershoot;
  let bestError = 1e9,
    lowest = 1e9;
  let pick: Controller = { ...r.controller, ff: FF_SHARES[0] / fast };
  let calm: Controller = { ...pick };
  let any = false;
  for (const comp of FF_D_SHARES) {
    if (comp > 0 && r.controller.d <= 0) break;
    for (const share of FF_SHARES) {
      const c: Controller = { ...r.controller, ff: comp * r.controller.d + share / fast };
      const s = simulateStep(a, c);
      if (!s.stable) continue;
      if (s.overshoot < lowest) {
        lowest = s.overshoot;
        calm = c;
      }
      if (s.overshoot <= limit && s.error < bestError) {
        bestError = s.error;
        pick = c;
        any = true;
      }
    }
  }
  r.controller = any ? pick : calm;
  r.step = simulateStep(a, r.controller);
  r.angleMargins = t.levelGain > 0 ? angleMargins(t, r.controller) : r.margins;
  r.noise = tableNoise(t, r.controller);
}

/**
 * Одна ось при заданном ФНЧ D (в base): для каждой доли D — наибольший срез;
 * от большего среза к меньшему подбирается упреждение, и берётся первая
 * настройка, где ступенька на модели не хуже опорной. withD = false — рысканье.
 */
export function tuneAxis(a: AxisData, base: Controller, lim: Limits, withD: boolean, maxHz: number, reference?: Step, noiseNow = 0): AxisResult {
  if (!plantValid(a.plant)) return noResult();
  const t = makeTables(a, base);
  const noiseLimit = Math.max(lim.noise, Math.min(noiseNow, lim.noiseCeiling));
  const count = withD ? D_SHARES.length : 1;
  const found: AxisResult[] = [];
  for (let k = 0; k < count; k++) {
    const r = bestCrossover(a, t, base, D_SHARES[k] * a.plant.tau, lim, noiseLimit, maxHz);
    if (r) found.push(r);
  }
  const order = found.map((_, i) => i);
  for (let i = 1; i < order.length; i++) {
    for (let j = i; j > 0 && found[order[j]].margins.crossoverHz > found[order[j - 1]].margins.crossoverHz * 1.02; j--) {
      const tmp = order[j];
      order[j] = order[j - 1];
      order[j - 1] = tmp;
    }
  }
  const bounded = !!reference && reference.stable;
  let closest: AxisResult | null = null;
  for (const index of order) {
    const r = found[index];
    tuneFeedforward(a, t, r, lim);
    if (!r.step.stable) continue;
    if (!bounded || (r.step.error <= reference!.error * STEP_ERROR_TOLERANCE && r.step.rise <= reference!.rise * STEP_RISE_TOLERANCE + base.dt)) return r;
    if (!closest || r.step.error < closest.step.error) closest = r;
  }
  return closest ?? noResult();
}

export interface Proposal {
  axis: AxisResult[];
  /** ступенька текущей настройки на той же модели */
  before: Step[];
  noiseBefore: number[];
  /** срез первой ступени ФНЧ D (общий для осей) */
  dtermLpfHz: number;
  found: boolean;
}

/**
 * Настройка трёх осей. base[ось] — регулятор как сейчас: из него берутся шаг,
 * тип ФНЧ D, вторая ступень, режектор D, ФНЧ выхода рысканья и усиление
 * горизонта; P, I, D, FF и срез первой ступени ФНЧ D — ищутся.
 */
export function synthesize(data: AxisData[], base: Controller[], lim: Limits = DEFAULT_LIMITS): Proposal {
  const out: Proposal = { axis: [noResult(), noResult(), noResult()], before: [], noiseBefore: [], dtermLpfHz: 0, found: false };
  for (let a = 0; a < 3; a++) {
    out.before.push(simulateStep(data[a], base[a]));
    out.noiseBefore.push(noiseRms(data[a], base[a]));
  }
  const maxHz = lim.maxCrossoverShare / base[0].dt;
  let bestScore = 0;
  for (const lpf of D_LPF_HZ) {
    if (lpf >= 0.3 / base[0].dt) break;
    const rp: AxisResult[] = [];
    let score = 1e9;
    for (let a = 0; a < 2; a++) {
      const b: Controller = { ...base[a], dLpf1: { ...base[a].dLpf1, hz: lpf } };
      rp.push(tuneAxis(data[a], b, lim, true, maxHz, out.before[a], out.noiseBefore[a]));
      score = Math.min(score, rp[a].found ? rp[a].margins.crossoverHz : 0);
    }
    if (score > bestScore * 1.02) {
      bestScore = score;
      out.axis[0] = rp[0];
      out.axis[1] = rp[1];
      out.dtermLpfHz = lpf;
    }
  }
  if (bestScore <= 0) return out;
  const yaw: Controller = { ...base[2], dLpf1: { ...base[2].dLpf1, hz: out.dtermLpfHz } };
  out.axis[2] = tuneAxis(data[2], yaw, lim, false, lim.yawShare * bestScore, out.before[2], out.noiseBefore[2]);
  out.found = out.axis[0].found && out.axis[1].found && out.axis[2].found;
  return out;
}
