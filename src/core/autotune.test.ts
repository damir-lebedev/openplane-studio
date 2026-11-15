// Запасы на эталонной петле и синтез на известной модели — с теми же числами,
// что даёт прошивка (plane/test/native/test_copter/test_sysid.cpp).

import { describe, expect, it } from "vitest";
import { angleMarginsOf, AxisData, Controller, Curve, DEFAULT_LIMITS, emptyController, lowpassAt, margins, marginsOf, marginsOk, PT1, PT2, simulateStep, synthesize } from "./autotune";
import { cdiv, cmul, cpolar, cx, Cx } from "./sysid";

const near = (got: number, want: number, rel = 1e-6) => expect(Math.abs(got - want)).toBeLessThanOrEqual(Math.abs(want) * rel + 1e-12);

function knownPlant(noiseScale = 1): { data: AxisData[]; base: Controller[] } {
  const data: AxisData[] = [],
    base: Controller[] = [];
  for (let a = 0; a < 3; a++) {
    const gyroFilter = new Curve();
    const hz: number[] = [],
      psd: number[] = [];
    for (let f = 1; f < 500; f *= 1.06) {
      gyroFilter.add(f, lowpassAt({ type: PT2, hz: 150 }, f, 0.001));
      hz.push(f);
      psd.push((0.09 / 500 + 0.02 * Math.exp((-0.5 * (f - 180) * (f - 180)) / 100)) * noiseScale);
    }
    data.push({
      plant: { gain: a === 2 ? 18000 : 150000, tau: 0.03, delay: 0.002, zero: a === 2 ? 0.1 : 0, error: 0, points: 60 },
      gyroFilter,
      noise: { hz, psd },
      stepDps: a === 2 ? 120 : 200,
    });
    base.push({
      ...emptyController(0.001),
      p: a === 2 ? 0.0007 : 0.0008,
      i: a === 2 ? 0.0015 : 0.011,
      d: a === 2 ? 0 : 0.000015,
      ff: a === 2 ? 0.00004 : 0.000005,
      dLpf1: { type: PT1, hz: 110 },
      outputLpfHz: a === 2 ? 75 : 0,
      levelGain: a === 2 ? 0 : 10,
    });
  }
  return { data, base };
}

describe("автонастройка", () => {
  it("запасы эталонной петли K·e^(−sT)/s — как по формулам и как у прошивки", () => {
    const K = 60,
      T = 0.008;
    const hz: number[] = [],
      L: Cx[] = [];
    for (let f = 0.2; f < 490; f *= 1.02) {
      const w = 2 * Math.PI * f;
      hz.push(f);
      L.push(cmul(cdiv(cx(K), cx(0, w)), cpolar(1, -w * T)));
    }
    const m = margins(hz, L);
    // формулы: срез ω = K, запас по фазе 90° − K·T, по усилению π/(2·T·K)
    expect(Math.abs(m.crossoverHz - K / (2 * Math.PI))).toBeLessThan(0.02);
    expect(Math.abs(m.phaseMarginDeg - (90 - (K * T * 180) / Math.PI))).toBeLessThan(0.2);
    expect(Math.abs(m.gainMarginDb - 20 * Math.log10(Math.PI / (2 * T * K)))).toBeLessThan(0.05);
    expect(m.sensitivityHz).toBeGreaterThan(m.crossoverHz);
    // эталон: test_autotune_margins_of_a_reference_loop
    near(m.crossoverHz, 9.54929659);
    near(m.phaseMarginDeg, 62.4970915);
    near(m.gainMarginDb, 10.2974333);
    near(m.sensitivityDb, 3.84953726);
    near(m.sensitivityHz, 22.7232814);
    // усиление вчетверо выше — неустойчив: запас по фазе меньше нуля
    expect(margins(hz, L.map((v) => ({ re: v.re * 4, im: v.im * 4 }))).phaseMarginDeg).toBeLessThan(0);
  });

  it("синтез на известной модели: запасы, шум, ступенька — и числа прошивки", () => {
    const { data, base } = knownPlant();
    const lim = DEFAULT_LIMITS;
    const p = synthesize(data, base, lim);
    expect(p.found).toBe(true);
    expect(p.dtermLpfHz).toBe(200);
    // эталон: test_autotune_synthesis_on_a_known_plant
    const roll = p.axis[0];
    near(roll.controller.p, 0.00142613569, 1e-5);
    near(roll.controller.i, 0.0495657189, 1e-5);
    near(roll.controller.d, 4.27840706e-5, 1e-5);
    near(roll.controller.ff, 4.67840706e-5, 1e-5);
    near(roll.margins.crossoverHz, 33.187529, 1e-5);
    near(roll.margins.phaseMarginDeg, 48.0135585, 1e-5);
    near(roll.margins.gainMarginDb, 7.62808979, 1e-5);
    near(roll.margins.sensitivityDb, 5.92877036, 1e-5);
    near(roll.noise, 0.0190558597, 1e-5);
    near(roll.step.rise, 0.019);
    near(roll.step.overshoot, 0.00311566773, 1e-4);
    near(marginsOf(data[0], base[0]).crossoverHz, 12.9210512, 1e-5);
    near(p.before[0].rise, 0.039);
    const yaw = p.axis[2];
    near(yaw.controller.p, 0.00218528221, 1e-5);
    near(yaw.controller.i, 0.0455682466, 1e-5);
    expect(yaw.controller.d).toBe(0);
    near(yaw.controller.ff, 3.33333333e-6, 1e-5);
    near(yaw.margins.crossoverHz, 19.9123334, 1e-5);
    near(yaw.margins.phaseMarginDeg, 60.8006498, 1e-5);
    near(yaw.noise, 0.000501134334, 1e-4);
    near(p.before[2].overshoot, 0.761721009, 1e-4);

    for (let a = 0; a < 3; a++) {
      const r = p.axis[a];
      expect(marginsOk(r.margins, lim.phaseMarginDeg, lim.gainMarginDb, lim.sensitivityDb + 0.01)).toBe(true);
      expect(marginsOk(r.angleMargins, lim.phaseMarginDeg - 0.5, lim.gainMarginDb - 0.1, lim.sensitivityDb + 0.1)).toBe(true);
      expect(r.noise).toBeLessThanOrEqual(r.noiseLimit);
      expect(r.step.stable).toBe(true);
      expect(r.step.error).toBeLessThanOrEqual(p.before[a].error * 1.02);
      // полоса шире, чем была; срез — там, где сказано
      expect(r.margins.crossoverHz).toBeGreaterThan(marginsOf(data[a], base[a]).crossoverHz);
      expect(Math.abs(marginsOf(data[a], r.controller).crossoverHz / r.margins.crossoverHz - 1)).toBeLessThan(0.02);
    }
    expect(p.axis[2].margins.crossoverHz).toBeLessThanOrEqual(lim.yawShare * p.axis[0].margins.crossoverHz * 1.01);
    // запасы в ANGLE считаются тем же, чем и показываются
    expect(Math.abs(angleMarginsOf(data[0], roll.controller).phaseMarginDeg - roll.angleMargins.phaseMarginDeg)).toBeLessThan(0.01);
  });

  it("бюджет шума: шумнее гироскоп — тише настройка", () => {
    const quiet = knownPlant();
    const loud = knownPlant(400);
    const a = synthesize(quiet.data, quiet.base);
    const b = synthesize(loud.data, loud.base);
    expect(b.found).toBe(true);
    expect(b.axis[0].margins.crossoverHz).toBeLessThan(a.axis[0].margins.crossoverHz);
    expect(b.axis[0].noise).toBeLessThanOrEqual(b.axis[0].noiseLimit);
    expect(b.dtermLpfHz).toBeLessThanOrEqual(a.dtermLpfHz);
  });

  it("ступенька на модели: отклик по циклам и интеграл ошибки", () => {
    const { data, base } = knownPlant();
    const trace: number[] = [];
    const s = simulateStep(data[0], base[0], trace);
    expect(trace.length).toBe(450);
    expect(s.stable).toBe(true);
    expect(trace[trace.length - 1]).toBeGreaterThan(0.95);
    expect(s.rise).toBeGreaterThan(0.01);
    expect(s.error).toBeGreaterThan(0);
    // без объекта — нечего считать
    expect(simulateStep({ ...data[0], plant: { ...data[0].plant, gain: 0 } }, base[0]).rise).toBe(0);
  });
});
