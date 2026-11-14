import { describe, expect, it } from "vitest";

import { addMagSample, alignMag, applyMagFit, detectAlign, fitMag, MAG_ALIGNS, MagAlign, magCommands, magCoverage, MagSample, magVerdict, spherePoint, Vec3 } from "./magCal";

/** Поле Земли (север 20, вниз 45 мкТл) глазами датчика на коптере с углами att. */
function sensed(att: Vec3, align: MagAlign, zero: Vec3, scale: Vec3): Vec3 {
  const d = Math.PI / 180;
  const [cr, sr] = [Math.cos(att[0] * d), Math.sin(att[0] * d)];
  const [cp, sp] = [Math.cos(att[1] * d), Math.sin(att[1] * d)];
  const [cy, sy] = [Math.cos(att[2] * d), Math.sin(att[2] * d)];
  const e: Vec3 = [20, 0, 45];
  // земные -> рама FRD: обратно Rz·Ry·Rx
  const x1 = cy * e[0] + sy * e[1];
  const y1 = -sy * e[0] + cy * e[1];
  const x2 = cp * x1 - sp * e[2];
  const z2 = sp * x1 + cp * e[2];
  const y3 = cr * y1 + sr * z2;
  const z3 = -sr * y1 + cr * z2;
  const body: Vec3 = [x2, -y3, -z3];   // X нос, Y влево, Z вверх
  // рама -> оси датчика: перебором (установок восемь)
  let sensor: Vec3 = [0, 0, 0];
  for (const sx of [-1, 1]) {
    for (const sy2 of [-1, 1]) {
      for (const swap of [false, true]) {
        for (const sz of [-1, 1]) {
          const v: Vec3 = swap ? [sx * body[1], sy2 * body[0], sz * body[2]] : [sx * body[0], sy2 * body[1], sz * body[2]];
          const back = alignMag(align, v);
          if (Math.hypot(back[0] - body[0], back[1] - body[1], back[2] - body[2]) < 1e-9) sensor = v;
        }
      }
    }
  }
  return [sensor[0] / scale[0] + zero[0], sensor[1] / scale[1] + zero[1], sensor[2] / scale[2] + zero[2]];
}

/** Коптер покрутили во все стороны. */
function tumble(align: MagAlign, zero: Vec3, scale: Vec3, noise = 0): MagSample[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
  const out: MagSample[] = [];
  for (let roll = -180; roll < 180; roll += 30) {
    for (let pitch = -75; pitch <= 75; pitch += 25) {
      for (let yaw = 0; yaw < 360; yaw += 45) {
        const att: Vec3 = [roll, pitch, yaw];
        const m = sensed(att, align, zero, scale);
        out.push({ m: [m[0] + noise * rnd(), m[1] + noise * rnd(), m[2] + noise * rnd()], att });
      }
    }
  }
  return out;
}

describe("калибровка компаса коптера", () => {
  it("установка датчика — как в прошивке (alignMag)", () => {
    const v: Vec3 = [1, 2, 3];
    expect(alignMag("DEFAULT", v)).toEqual([1, 2, 3]);
    expect(alignMag("CW0", v)).toEqual([1, 2, 3]);
    expect(alignMag("CW90", v)).toEqual([2, -1, 3]);
    expect(alignMag("CW180", v)).toEqual([-1, -2, 3]);
    expect(alignMag("CW270", v)).toEqual([-2, 1, 3]);
    expect(alignMag("CW0FLIP", v)).toEqual([-1, 2, -3]);
    expect(alignMag("CW90FLIP", v)).toEqual([2, 1, -3]);
    expect(alignMag("CW180FLIP", v)).toEqual([1, -2, -3]);
    expect(alignMag("CW270FLIP", v)).toEqual([-2, -1, -3]);
  });

  it("по точкам находит смещение, растяжение и модуль поля", () => {
    const zero: Vec3 = [31.5, -12.2, 8.4];
    const scale: Vec3 = [1.1, 0.95, 1.0];
    const fit = fitMag(tumble("CW0", zero, scale, 0.6))!;
    expect(fit).not.toBeNull();
    for (let i = 0; i < 3; ++i) expect(fit.zero[i]).toBeCloseTo(zero[i], 0);
    // множители — с точностью до общего: важны отношения
    expect(fit.scale[0] / fit.scale[2]).toBeCloseTo(1.1, 1);
    expect(fit.scale[1] / fit.scale[2]).toBeCloseTo(0.95, 1);
    expect(fit.field).toBeGreaterThan(44);
    expect(fit.field).toBeLessThan(54);
    expect(fit.residual).toBeLessThan(0.02);
    expect(magVerdict(fit).ok).toBe(true);
    // после калибровки модуль поля одинаков, как ни стоит коптер
    const a = Math.hypot(...applyMagFit(sensed([10, 20, 30], "CW0", zero, scale), fit));
    const b = Math.hypot(...applyMagFit(sensed([-120, -40, 200], "CW0", zero, scale), fit));
    expect(a).toBeCloseTo(b, 0);
  });

  it("определяет, как стоит датчик, по повороту поля вместе с рамой", () => {
    for (const align of MAG_ALIGNS.slice(1)) {
      const samples = tumble(align, [5, -3, 2], [1, 1, 1], 0.5);
      const fit = fitMag(samples)!;
      const guess = detectAlign(samples, fit)!;
      expect(guess.align).toBe(align);
      expect(guess.sure).toBe(true);
      expect(guess.spread).toBeLessThan(0.1);
    }
  });

  it("точки в одной плоскости или мало точек — не считает", () => {
    expect(fitMag([])).toBeNull();
    const flat: MagSample[] = [];
    for (let yaw = 0; yaw < 360; yaw += 3) flat.push({ m: sensed([0, 0, yaw], "CW0", [0, 0, 0], [1, 1, 1]), att: [0, 0, yaw] });
    expect(fitMag(flat)).toBeNull();
    expect(magCoverage(flat)).toBeLessThan(0.3);
    expect(magCoverage(tumble("CW0", [10, 0, 0], [1, 1, 1]))).toBeGreaterThan(0.9);
  });

  it("поле не земное или точки неровные — калибровка не годится", () => {
    const strong = fitMag(tumble("CW0", [0, 0, 0], [0.3, 0.3, 0.3]))!;   // 160 мкТл
    expect(magVerdict(strong).ok).toBe(false);
    const rough = fitMag(tumble("CW0", [0, 0, 0], [1, 1, 1], 25))!;
    expect(rough === null || !magVerdict(rough).ok).toBe(true);
  });

  it("лежащий коптер точек не копит; команды записи — в единицах прошивки", () => {
    let list: MagSample[] = [];
    for (let i = 0; i < 50; ++i) list = addMagSample(list, { m: [20 + 0.1 * (i % 3), 0, -45], att: [0, 0, 0] });
    expect(list).toHaveLength(1);
    list = addMagSample(list, { m: [10, 15, -45], att: [0, 0, 40] });
    expect(list).toHaveLength(2);
    list = addMagSample(list, { m: [NaN, 0, 0], att: [0, 0, 0] });
    expect(list).toHaveLength(2);

    const cmds = magCommands({ zero: [31.54, -12.26, 0.04], scale: [1.1, 0.953, 1], field: 49, residual: 0.01 }, "CW270FLIP");
    expect(cmds).toEqual([
      ["mag_zero_x", 315],
      ["mag_zero_y", -123],
      ["mag_zero_z", 0],
      ["mag_scale_x", 1100],
      ["mag_scale_y", 953],
      ["mag_scale_z", 1000],
      ["align_mag", "CW270FLIP"],
    ]);
    // все три нуля — «не откалиброван»: идеальный датчик получает 0.1 мкТл
    expect(magCommands({ zero: [0, 0, 0], scale: [1, 1, 1], field: 49, residual: 0 })[2]).toEqual(["mag_zero_z", 1]);
  });

  it("точка сферы: от центра в долях радиуса, вид вращается", () => {
    const front = spherePoint([50, 0, 0], [0, 0, 0], 50, 0);
    expect(front.x).toBeCloseTo(1, 5);
    const turned = spherePoint([50, 0, 0], [0, 0, 0], 50, 90);
    expect(turned.x).toBeCloseTo(0, 5);
    expect(turned.depth).toBeGreaterThan(0.9);
    const top = spherePoint([10, 20, 80], [10, 20, 30], 50, 0);
    expect(top.y).toBeLessThan(-0.9);   // вверх на картинке
  });
});
