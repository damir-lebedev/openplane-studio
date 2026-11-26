// 044 · Ступенька во вкладке «PID»: как коптер ответит на резкий стик при тех
// PID, что работают сейчас. Модель коптера (усиление по осям, мотор, задержка)
// и действующие коэффициенты присылает плата в "margin.model" — на каждую
// правку PID и фильтров (plane/include/telemetry/CopterLink.h, margin()).
// Фильтры гироскопа и D, расходы и yaw_lowpass_hz — из настроек в окне.
// Расчёт — тот же simulateStep, что у автонастройки (core/autotune.ts).

import { AxisData, BIQUAD, Controller, Curve, emptyController, PT1, PT2, PT3, simulateStep, Step } from "./autotune";
import { AXES, Axis, CopterBoard, num, rateCurve, rateSpec } from "./copterParams";
export type { LoopModel } from "./copterParams";
import { chainOf, delayMs, lpf1Hz, LpfType } from "./filters";
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

/** Ступенька по осям; null — плата модели не прислала (старая прошивка или PID без модели). */
export function pidSteps(board: CopterBoard): AxisStep[] | null {
  const m = board.header?.margin?.model;
  if (!m || !(m.loop > 0) || m.ax?.length !== 3) return null;
  const dt = 1 / m.loop;
  const gyro = chainOf(board, "gyro");
  const dterm = chainOf(board, "dterm");
  // фильтр гироскопа для ступеньки — это задержка на низких частотах
  const gyroFilter = new Curve();
  const f0 = 20;
  const gyroDelayS = gyro ? delayMs(gyro, f0, HOVER_THROTTLE) / 1000 : 0;
  gyroFilter.add(f0, cpolar(1, -2 * Math.PI * f0 * gyroDelayS));
  const out: AxisStep[] = [];
  AXES.forEach((axis, i) => {
    if (axis === "yaw" && m.iy) return;
    const [k, p, ii, d, ff] = m.ax[i];
    if (!(k > 0)) return;
    const c: Controller = { ...emptyController(dt), p: p * U, i: ii * U, d: d * U, ff: ff * U };
    if (dterm) {
      c.dLpf1 = { type: LPF_CODE[dterm.lpf1.type], hz: lpf1Hz(dterm, HOVER_THROTTLE) };
      c.dLpf2 = { type: LPF_CODE[dterm.lpf2.type], hz: dterm.lpf2.hz };
      const n = dterm.notches[0];
      if (n && n.hz > 0 && n.cutoff > 0 && n.cutoff < n.hz) {
        c.dNotchHz = n.hz;
        c.dNotchCutoffHz = n.cutoff;
      }
    }
    if (axis === "yaw") c.outputLpfHz = num(board, "yaw_lowpass_hz");
    const stepDps = Math.max(30, rateCurve(rateSpec(board, axis), STICK));
    const data: AxisData = {
      plant: { gain: k, tau: m.tau, delay: m.delay, zero: 0, error: 0, points: 99 },
      gyroFilter,
      noise: { hz: [], psd: [] },
      stepDps,
    };
    const trace: number[] = [];
    const step = simulateStep(data, c, trace);
    out.push({ axis, stepDps, step, points: trace.map((v, n): [number, number] => [((n + 1) * 1000) / m.loop, v]) });
  });
  return out.length ? out : null;
}

/** Оценка ступеньки словами: перелёт и раскачка. */
export function stepVerdict(s: Step): "ok" | "slow" | "overshoot" | "unstable" {
  if (!s.stable) return "unstable";
  if (s.overshoot > 0.25) return "overshoot";
  if (s.rise > 0.08) return "slow";
  return "ok";
}
