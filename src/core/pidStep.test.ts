import { describe, expect, it } from "vitest";
import { applyMessage, CopterParam, emptyBoard, LoopModel } from "./copterParams";
import { pidSteps, stepVerdict } from "./pidStep";

// Числа — из ответа прошивки на `set p_pitch 47` (freestyle5, MODEL, test_app_stm32_copter)
const MODEL: LoopModel = {
  loop: 1000,
  tau: 0.0315,
  delay: 0.0024,
  iy: 0,
  ax: [
    [148166, 1601.45, 9263.84, 14.196, 4.724],
    [148166, 1505.36, 9263.84, 14.196, 4.724],
    [19214, 687.8, 1429.26, 0, 36.431],
  ],
};

function board(model?: LoopModel, vals: Record<string, string | number> = {}) {
  let b = applyMessage(emptyBoard(), "params", { count: 1, profiles: 4, profile: 0, rateprofile: 0, build: "", source: "MODEL", unsaved: false, margin: { gm: 8.6, pm: 28, hz: 15.5, min: 6, model } });
  b = { ...b, params: { ...b.params } };
  for (const [name, value] of Object.entries({ rates_type: "ACTUAL", roll_rc_rate: 7, roll_srate: 67, roll_expo: 0, pitch_rc_rate: 7, pitch_srate: 67, pitch_expo: 0, yaw_rc_rate: 7, yaw_srate: 67, yaw_expo: 0, ...vals }))
    b.params[name] = { name, value } as unknown as CopterParam;
  return b;
}

describe("044: ступенька во вкладке «PID»", () => {
  it("без модели с платы (старая прошивка) — нет графика", () => {
    expect(pidSteps(board())).toBeNull();
  });

  it("три оси на модели с платы: доходит до уставки, ступенька — расход на 40 % стика", () => {
    const s = pidSteps(board(MODEL))!;
    expect(s.map((x) => x.axis)).toEqual(["roll", "pitch", "yaw"]);
    for (const x of s) {
      expect(x.step.stable).toBe(true);
      expect(x.step.rise).toBeGreaterThan(0.005);
      expect(x.step.rise).toBeLessThan(0.2);
      expect(x.points.length).toBeGreaterThan(100);
      expect(x.points[x.points.length - 1][1]).toBeGreaterThan(0.8);
    }
    // ACTUAL: центр 70 °/с, максимум 670 °/с — на 40 % стика больше 28 °/с
    expect(s[0].stepDps).toBeGreaterThan(28);
  });

  it("P вчетверо — раскачка видна, P вдвое меньше — вяло", () => {
    const hot = structuredClone(MODEL);
    hot.ax[0][1] *= 4;
    hot.ax[0][3] = 0;
    const roll = pidSteps(board(hot))![0];
    expect(stepVerdict(roll.step)).not.toBe("ok");
    expect(roll.step.overshoot).toBeGreaterThan(pidSteps(board(MODEL))![0].step.overshoot);
    const cold = structuredClone(MODEL);
    cold.ax[0][1] /= 4;
    cold.ax[0][4] = 0;
    expect(pidSteps(board(cold))![0].step.rise).toBeGreaterThan(pidSteps(board(MODEL))![0].step.rise);
  });

  it("integrated yaw — рысканье не рисуется", () => {
    expect(pidSteps(board({ ...MODEL, iy: 1 }))!.map((x) => x.axis)).toEqual(["roll", "pitch"]);
  });
});
