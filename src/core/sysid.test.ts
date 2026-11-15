// Те же опыты и те же числа, что в прошивке (plane/test/native/test_copter/
// test_sysid.cpp): генератор целочисленный, данные в обоих языках совпадают,
// и расчёт Studio сверяется с эталоном прошивки напрямую.

import { describe, expect, it } from "vitest";
import { cabs, carg, cdiv, cmul, cpolar, cx, estimate, fft, fit, plantAt } from "./sysid";
import { SYN, synthetic } from "./__fixtures__/chirpSynthetic";

const { dt: DT, k: K, tau: TAU, delay: DELAY, p: P, i: I, filter: FILTER } = SYN;

const near = (got: number, want: number, rel = 1e-6) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * rel + 1e-15);

describe("идентификация по chirp", () => {
  it("БПФ находит синус", () => {
    const re = new Float64Array(64),
      im = new Float64Array(64);
    for (let i = 0; i < 64; i++) re[i] = 3 * Math.cos((2 * Math.PI * 5 * i) / 64) + 1;
    fft(re, im);
    expect(Math.hypot(re[0], im[0])).toBeCloseTo(64, 9);
    expect(Math.hypot(re[5], im[5])).toBeCloseTo(96, 9);
    expect(Math.hypot(re[59], im[59])).toBeCloseTo(96, 9);
    expect(Math.hypot(re[7], im[7])).toBeCloseTo(0, 9);
  });

  it("ЧХ известной системы в замкнутом контуре — и те же числа, что у прошивки", () => {
    const s = synthetic(16000, 0.6);
    const resp = estimate(s.r, s.u, s.y, s.yf, 1 / DT);
    const p = fit(resp, false);
    // эталон: test_sysid_recovers_a_known_plant_in_closed_loop
    expect(resp.bands.length).toBe(87);
    expect(p.points).toBe(58);
    near(p.gain, 115453.893);
    near(p.tau, 0.0286625904);
    near(p.delay, 0.00202412768);
    near(p.error, 0.0590294084);
    // и сама физика: объект восстановлен
    expect(Math.abs(p.gain / K - 1)).toBeLessThan(0.05);
    expect(Math.abs(p.tau / TAU - 1)).toBeLessThan(0.07);
    expect(p.delay).toBeGreaterThan(DELAY * DT);
    expect(p.delay).toBeLessThan((DELAY + 1.6) * DT);

    for (const b of resp.bands) {
      if (b.hz < 5 || b.hz > 80) continue;
      expect(b.coherence).toBeGreaterThan(0.6);
      const ratio = cdiv(b.plant, plantAt(p, b.hz));
      expect(Math.abs(cabs(ratio) - 1)).toBeLessThan(0.12);
      expect(Math.abs((carg(ratio) * 180) / Math.PI)).toBeLessThan(6);
      // фильтр гироскопа — PT1 с коэффициентом FILTER
      const z1 = cpolar(1, -2 * Math.PI * b.hz * DT);
      const filter = cdiv(cx(FILTER), { re: 1 - (1 - FILTER) * z1.re, im: -(1 - FILTER) * z1.im });
      expect(Math.abs(cabs(b.gyroFilter) - cabs(filter))).toBeLessThan(0.03);
      // контур как летал: L = C·F·G
      const integrator = cdiv(cx(DT), { re: 1 - z1.re, im: -z1.im });
      const c = { re: P + I * integrator.re, im: I * integrator.im };
      const loop = cmul(cmul(c, filter), plantAt(p, b.hz));
      expect(Math.abs(cabs(b.loop) - cabs(loop))).toBeLessThan(0.15 * cabs(loop));
    }
    // шум гироскопа: белый, дисперсия σ²/3 на полосе fs/2
    const psd = (0.6 * 0.6) / 3 / 500;
    const high = resp.bands.filter((b) => b.hz >= 250);
    const mean = high.reduce((a, b) => a + b.noise, 0) / high.length;
    near(mean, 0.000238643638);
    expect(Math.abs(mean / psd - 1)).toBeLessThan(0.2);
  });

  it("короткая или пустая запись — пусто, а не ошибка", () => {
    expect(estimate([], [], [], [], 1000).bands.length).toBe(0);
    expect(estimate([1, 2, 3], [1, 2, 3], [1, 2, 3], [1, 2, 3], 1000).bands.length).toBe(0);
    expect(fit({ bands: [], sampleHz: 1000, seconds: 0 }, false).points).toBe(0);
  });
});
