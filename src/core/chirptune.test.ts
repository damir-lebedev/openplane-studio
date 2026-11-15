// Журнал с chirp → отчёт: свипы по осям, модель, предложение в единицах BF.

import { describe, expect, it } from "vitest";
import { SYN, synthetic } from "./__fixtures__/chirpSynthetic";
import { marginsOk } from "./autotune";
import { analyze, ChirpSeries, controllerFromInfo, gainsFromBf, gainsToBf, stepDpsFromInfo, sweepsOf } from "./chirptune";

// PI опыта в единицах BF: P = 0.0008 / 0.032029e-3 ≈ 25, I = 0.012 / 0.244381e-3 ≈ 49
const INFO: Record<string, string> = {
  loop_hz: "1000",
  "pid.roll": "25 49 0 0",
  "pid.pitch": "25 49 0 0",
  "pid.yaw": "25 20 0 0",
  "pid.dmax": "0 0 0",
  "rates.roll": "180 720 0.50",
  "rates.pitch": "180 720 0.50",
  "rates.yaw": "160 600 0.40",
  "filter.dterm": "0 110 0 0 0 0 0 0",
  "filter.yaw_lpf_hz": "0",
  "tune.level_gain": "8.00",
};

/** Журнал из свипов: оси по очереди, между ними — пауза, номер свипа растёт. */
type Columns = { [K in keyof ChirpSeries]: number[] };

function series(axes: number[], samples = 16000, gains: number[] = [SYN.k, SYN.k, SYN.k / 6]): Columns {
  const s = { t: [] as number[], excite: [] as number[], command: [] as number[], gyro: [] as number[], gyrof: [] as number[], hz: [] as number[], axis: [] as number[], run: [] as number[] };
  let t = 10,
    run = 0;
  for (const axis of axes) {
    run++;
    const d = synthetic(samples, 0.6, gains[axis]);
    for (let k = 0; k < samples; k++) {
      s.t.push(t + k * SYN.dt);
      s.excite.push(d.r[k]);
      s.command.push(d.u[k]);
      s.gyro.push(d.y[k]);
      s.gyrof.push(d.yf[k]);
      s.hz.push(d.hz[k]);
      s.axis.push(axis);
      s.run.push(run);
    }
    t += samples * SYN.dt + 3;
  }
  return s;
}

describe("автонастройка по журналу", () => {
  it("единицы Betaflight туда и обратно, границы настроек", () => {
    const g = gainsFromBf({ p: 45, i: 80, d: 40, f: 120 }, 0);
    expect(g.p).toBeCloseTo(45 * 0.032029e-3, 12);
    expect(gainsToBf(g, 0)).toEqual({ bf: { p: 45, i: 80, d: 40, f: 120 }, clamped: false });
    // рысканье: I в 2.5 раза крупнее
    expect(gainsFromBf({ p: 0, i: 80, d: 0, f: 0 }, 2).i).toBeCloseTo(g.i * 2.5, 12);
    expect(gainsToBf({ p: 1, i: 0, d: 1, ff: 0 }, 0)).toEqual({ bf: { p: 250, i: 0, d: 250, f: 0 }, clamped: true });
  });

  it("регулятор и ступенька — из заголовка журнала", () => {
    const { controller, bf } = controllerFromInfo({ ...INFO, "pid.roll": "30 90 25 100", "pid.dmax": "40 0 0", "filter.dterm": "2 120 0 150 80 170 0 0" }, 0);
    expect(bf).toEqual({ p: 30, i: 90, d: 40, f: 100 }); // D — наибольший: d_max
    expect(controller.dt).toBe(0.001);
    expect(controller.dLpf1).toEqual({ type: 2, hz: 80 }); // динамический срез — по нижнему краю
    expect(controller.dLpf2).toEqual({ type: 0, hz: 150 });
    expect(controller.levelGain).toBe(8);
    expect(controllerFromInfo(INFO, 2).controller.levelGain).toBe(0); // рысканье в ANGLE не участвует
    // 40 % стика: 180·0.4 + (720 − 180)·0.4·0.4³
    expect(stepDpsFromInfo(INFO, 0)).toBeCloseTo(72 + 540 * 0.4 * Math.pow(0.4, 3), 6);
    expect(stepDpsFromInfo({}, 1)).toBeGreaterThan(50);
  });

  it("свипы режутся по номеру; короткие обрывки не в счёт", () => {
    const s = series([0, 1], 4000);
    // обрывок в 100 записей — третий «свип»
    for (let k = 0; k < 100; k++) {
      s.t.push(100 + k * 0.001);
      s.excite.push(0);
      s.command.push(0);
      s.gyro.push(0);
      s.gyrof.push(0);
      s.hz.push(1);
      s.axis.push(2);
      s.run.push(3);
    }
    const sweeps = sweepsOf(s);
    expect(sweeps.map((x) => x.axis)).toEqual([0, 1]);
    expect(sweeps[0].r.length).toBe(4000);
    expect(sweeps[0].sampleHz).toBeCloseTo(1000, 3);
    expect(sweeps[0].reachedHz).toBeGreaterThan(190);
  });

  it("три оси: модель найдена, настройка предложена, запасы выдержаны", () => {
    const report = analyze(series([0, 1, 2]), INFO);
    expect(report.problems).toEqual([]);
    expect(report.found).toBe(true);
    for (let axis = 0; axis < 3; axis++) {
      const a = report.axes[axis]!;
      const k = axis === 2 ? SYN.k / 6 : SYN.k;
      expect(Math.abs(a.plant.gain / k - 1)).toBeLessThan(0.06);
      expect(Math.abs(a.plant.tau / SYN.tau - 1)).toBeLessThan(0.1);
      expect(a.goodBands).toBeGreaterThan(40);
      expect(a.bands.length).toBeGreaterThan(80);
      expect(a.hz.length).toBe(a.modelDb.length);
      // «было»: то, что в заголовке; контур по самой записи сходится с моделью
      expect(a.now.bf.p).toBe(25);
      expect(a.flown).not.toBeNull();
      expect(Math.abs(a.flown!.crossoverHz / a.now.margins.crossoverHz - 1)).toBeLessThan(0.15);
      // «стало»: целые BF, запасы 45° / 6 дБ / 6 дБ с допуском на округление
      const n = a.next!;
      expect(Number.isInteger(n.bf.p) && Number.isInteger(n.bf.d) && Number.isInteger(n.bf.f)).toBe(true);
      expect(marginsOk(n.margins, 44, 5.8, 6.3)).toBe(true);
      expect(n.margins.crossoverHz).toBeGreaterThan(a.now.margins.crossoverHz);
      expect(n.noise).toBeLessThanOrEqual(n.noiseLimit * 1.05);
      expect(n.trace.length).toBe(450);
      expect(n.step.stable).toBe(true);
    }
    expect(report.axes[2]!.next!.bf.d).toBe(0);
    expect(report.dtermLpfHz.now).toBe(110);
    expect(report.dtermLpfHz.next).toBeGreaterThan(0);
    expect(report.commands).toContain(`set p_roll = ${report.axes[0]!.next!.bf.p}`);
    expect(report.commands).toContain(`set d_max_pitch = ${report.axes[1]!.next!.bf.d}`);
    expect(report.commands[report.commands.length - 1]).toBe(`set dterm_lpf1_static_hz = ${report.dtermLpfHz.next}`);
  });

  it("нет chirp, нет оси, оборванный свип — сказано словами, предложения нет", () => {
    expect(analyze(null, INFO).problems).toEqual([{ kind: "no_chirp" }]);
    const two = analyze(series([0, 1]), INFO);
    expect(two.found).toBe(false);
    expect(two.problems).toContainEqual({ kind: "axis_missing", axis: 2 });
    expect(two.axes[0]!.next).toBeNull();
    expect(two.axes[0]!.plant.gain).toBeGreaterThan(0);
    // тангаж оборван на трети: дошёл до ~6 Гц
    const cut = series([0, 1, 2]);
    const keep = (k: number) => !(cut.axis[k] === 1 && cut.hz[k] > 6);
    const filtered: Columns = { t: [], excite: [], command: [], gyro: [], gyrof: [], hz: [], axis: [], run: [] };
    for (let k = 0; k < cut.t.length; k++) {
      if (!keep(k)) continue;
      for (const key of Object.keys(filtered) as (keyof Columns)[]) filtered[key].push(cut[key][k]);
    }
    const r = analyze(filtered, INFO);
    expect(r.problems).toContainEqual({ kind: "short_sweep", axis: 1 });
    expect(r.found).toBe(false);
  });
});
