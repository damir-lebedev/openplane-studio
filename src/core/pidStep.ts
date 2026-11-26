// 044 · Ступенька во вкладке «PID»: как коптер ответит на резкий стик при тех
// PID, что работают сейчас. Модель коптера (усиление по осям, мотор, задержка)
// и действующие коэффициенты присылает плата в "margin.model" — на каждую
// правку PID и фильтров (plane/include/telemetry/CopterLink.h, margin()).
// Фильтры гироскопа и D, расходы и yaw_lowpass_hz — из настроек в окне.
// Расчёт — тот же simulateStep, что у автонастройки (core/autotune.ts).

import { AxisData, BIQUAD, Controller, Curve, emptyController, frequencyGrid, Margins, marginsOf, PT1, PT2, PT3, simulateStep, Step } from "./autotune";
import { AXES, Axis, CopterBoard, num, rateCurve, rateSpec } from "./copterParams";
export type { LoopModel } from "./copterParams";
import { Chain, chainOf, delayMs, lpf1Hz, LpfType, response } from "./filters";
import { cpolar } from "./sysid";

export interface AxisStep {
  axis: Axis;
  /** ступенька стиком, °/с: расход на 40 % стика */
  stepDps: number;
  /** [мс, доля уставки] */
  points: [number, number][];
  step: Step;
}

/** Газ висения для динамического ФНЧ. */
const HOVER_THROTTLE = 0.35;
const STICK = 0.4;
const U = 1e-6;

const LPF_CODE: Record<LpfType, number> = { PT1, BIQUAD, PT2, PT3 };

interface AxisModel {
  axis: Axis;
  data: AxisData;
  c: Controller;
}

/** Фильтр гироскопа для ступеньки — задержка на низких частотах (быстро, для 450 мс модели). */
function delayCurve(gyro: Chain | null, throttle: number): Curve {
  const curve = new Curve();
  const f0 = 20;
  const s = gyro ? delayMs(gyro, f0, throttle) / 1000 : 0;
  curve.add(f0, cpolar(1, -2 * Math.PI * f0 * s));
  return curve;
}

/** Для запасов — вся цепочка гироскопа по сетке частот контура (режекторы и вторая ступень видны). */
function chainCurve(gyro: Chain | null, throttle: number, dt: number): Curve {
  const curve = new Curve();
  for (const f of frequencyGrid(dt)) {
    const [re, im] = gyro ? response(gyro, f, throttle) : [1, 0];
    curve.add(f, { re, im });
  }
  return curve;
}

/** Модель каждой оси (коптер с платы + PID с платы + фильтры D и гироскопа из окна). */
function axisModels(board: CopterBoard, throttle: number, gyroCurve: (gyro: Chain | null, dt: number) => Curve): AxisModel[] | null {
  const m = board.header?.margin?.model;
  if (!m || !(m.loop > 0) || m.ax?.length !== 3) return null;
  const dt = 1 / m.loop;
  const gyroFilter = gyroCurve(chainOf(board, "gyro"), dt);
  const dterm = chainOf(board, "dterm");
  const out: AxisModel[] = [];
  AXES.forEach((axis, i) => {
    if (axis === "yaw" && m.iy) return;
    const [k, p, ii, d, ff] = m.ax[i];
    if (!(k > 0)) return;
    const c: Controller = { ...emptyController(dt), p: p * U, i: ii * U, d: d * U, ff: ff * U };
    if (dterm) {
      c.dLpf1 = { type: LPF_CODE[dterm.lpf1.type], hz: lpf1Hz(dterm, throttle) };
      c.dLpf2 = { type: LPF_CODE[dterm.lpf2.type], hz: dterm.lpf2.hz };
      const n = dterm.notches[0];
      if (n && n.hz > 0 && n.cutoff > 0 && n.cutoff < n.hz) {
        c.dNotchHz = n.hz;
        c.dNotchCutoffHz = n.cutoff;
      }
    }
    if (axis === "yaw") c.outputLpfHz = num(board, "yaw_lowpass_hz");
    const stepDps = Math.max(30, rateCurve(rateSpec(board, axis), STICK));
    out.push({
      axis,
      c,
      data: { plant: { gain: k, tau: m.tau, delay: m.delay, zero: 0, error: 0, points: 99 }, gyroFilter, noise: { hz: [], psd: [] }, stepDps },
    });
  });
  return out.length ? out : null;
}

/** Ступенька по осям; null — плата модели не прислала (старая прошивка или PID без модели). */
export function pidSteps(board: CopterBoard): AxisStep[] | null {
  const loop = board.header?.margin?.model?.loop ?? 0;
  const axes = axisModels(board, HOVER_THROTTLE, (g) => delayCurve(g, HOVER_THROTTLE));
  if (!axes) return null;
  return axes.map(({ axis, data, c }) => {
    const trace: number[] = [];
    const step = simulateStep(data, c, trace);
    return { axis, stepDps: data.stepDps, step, points: trace.map((v, n): [number, number] => [((n + 1) * 1000) / loop, v]) };
  });
}

export interface AxisMargin {
  axis: Axis;
  m: Margins;
}

/**
 * 071 · Запас контура по осям при фильтрах из окна (правка ползунка — сразу
 * новый ответ, до записи на плату) и газе throttle (динамические ФНЧ).
 * null — плата модели не прислала.
 */
export function filterMargins(board: CopterBoard, throttle = HOVER_THROTTLE): AxisMargin[] | null {
  const axes = axisModels(board, throttle, (g, dt) => chainCurve(g, throttle, dt));
  return axes && axes.map(({ axis, data, c }) => ({ axis, m: marginsOf(data, c) }));
}

/**
 * Оценка запаса: по фазе ≥ 25° и по усилению ≥ 6 дБ — с запасом (стоковый
 * тюн BF на этой модели — около 30° и 9 дБ), ≥ 15° и ≥ 3 дБ — на грани.
 */
export function marginVerdict(m: Margins): "ok" | "warn" | "bad" {
  if (!(m.crossoverHz > 0)) return "bad";
  if (m.phaseMarginDeg >= 25 && m.gainMarginDb >= 6) return "ok";
  if (m.phaseMarginDeg >= 15 && m.gainMarginDb >= 3) return "warn";
  return "bad";
}

/** Оценка ступеньки словами: перелёт и раскачка. */
export function stepVerdict(s: Step): "ok" | "slow" | "overshoot" | "unstable" {
  if (!s.stable) return "unstable";
  if (s.overshoot > 0.25) return "overshoot";
  if (s.rise > 0.08) return "slow";
  return "ok";
}
