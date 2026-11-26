import { describe, expect, it } from "vitest";

import { DYN_IDLE_DEFAULT, DynIdleController, dynIdleFrom, dynIdleState, throttleCutTrace } from "./dynIdle";

describe("dynamic idle (как copter/DynamicIdle.h)", () => {
  it("настройки с платы: ×100 об/мин и доли от тысячных", () => {
    const s = dynIdleFrom({ dyn_idle_min_rpm: { value: 35 }, dyn_idle_max_increase: { value: 120 } });
    expect(s.minRpm).toBe(3500);
    expect(s.maxIncrease).toBeCloseTo(0.12, 6);
    expect(s.startIncrease).toBeCloseTo(0.05, 6);
    expect(s.p).toBe(50);
    expect(dynIdleFrom({}).minRpm).toBe(0);
  });

  it("регулятор: до airmode малый предел, в полёте — полный, выше минимума — 0", () => {
    const s = { ...DYN_IDLE_DEFAULT, minRpm: 3500, maxIncrease: 0.12, d: 0 };
    const c = new DynIdleController();
    let out = 0;
    for (let i = 0; i < 2000; i++) out = c.update(s, 40, false, 0.001);
    expect(out).toBeCloseTo(0.05, 6);
    for (let i = 0; i < 2000; i++) out = c.update(s, 40, true, 0.001);
    expect(out).toBeCloseTo(0.12, 6);
    for (let i = 0; i < 3000; i++) out = c.update(s, 70, true, 0.001);
    expect(out).toBe(0);
    expect(c.update({ ...s, minRpm: 0 }, 10, true, 0.001)).toBe(0);
  });

  it("сброс газа: с dynamic idle обороты держатся у минимума, без — проваливаются", () => {
    const s = { ...DYN_IDLE_DEFAULT, minRpm: 3500 };
    const tr = throttleCutTrace(s);
    const inWash = tr.t.map((t, i) => [t, i] as const).filter(([t]) => t > tr.washS[0] + 0.15 && t < tr.washS[1]);
    const minOn = Math.min(...inWash.map(([, i]) => tr.on[i]));
    const minOff = Math.min(...inWash.map(([, i]) => tr.off[i]));
    expect(minOn).toBeGreaterThan(0.9 * 3500);
    expect(minOff).toBeLessThan(0.6 * 3500);
    expect(Math.max(...tr.inc)).toBeLessThanOrEqual(s.maxIncrease + 1e-9);
    // выключен — картинка всё равно есть (пример на 3500)
    expect(throttleCutTrace(DYN_IDLE_DEFAULT).on.length).toBe(tr.on.length);
  });

  it("состояние для карточки", () => {
    const on = { ...DYN_IDLE_DEFAULT, minRpm: 3000 };
    expect(dynIdleState(DYN_IDLE_DEFAULT, true)).toBe("off");
    expect(dynIdleState(on, false)).toBe("needBidir");
    expect(dynIdleState(on, true)).toBe("noRpm");
    expect(dynIdleState(on, true, { inc: 0, rpm: 0 })).toBe("noRpm");
    expect(dynIdleState(on, true, { inc: 0, rpm: 4200 })).toBe("ok");
    expect(dynIdleState(on, true, { inc: 0.03, rpm: 2900 })).toBe("raising");
  });
});
