import { describe, expect, it } from "vitest";

import { buildFromParams, CATALOG, estimateBuild, partParams, searchCatalog, suggestCurrentLimit } from "./parts";

const five = {
  motor: { statorMm: 22, heightMm: 7, kv: 1950 },
  prop: { diameterIn: 5.1, pitchIn: 4.3, blades: 3 },
  battery: { cells: 6, mah: 1300, chemistry: "LIPO" as const, c: 100 },
  massG: 680,
};

describe("что ещё подключено", () => {
  it("предлагает предел тока, когда полный газ больше батареи или регуляторов", () => {
    const e = estimateBuild(five);
    const bare = { ...five, esc: undefined, battery: { ...five.battery, c: 0 } };
    expect(suggestCurrentLimit(bare, estimateBuild(bare))).toBeNull();
    // регуляторы 20 А × 4 = 80 А, батарея больше — предел по регуляторам
    const weak = { ...five, esc: { continuousA: 20, burstA: 25 }, battery: { ...five.battery, c: 200 } };
    expect(suggestCurrentLimit(weak, estimateBuild(weak))).toBe(e.fullAmps > 80 ? 80 : null);
    // всего хватает — не ограничивать
    const big = { ...five, esc: { continuousA: 200, burstA: 250 }, battery: { ...five.battery, c: 1000 } };
    expect(suggestCurrentLimit(big, estimateBuild(big))).toBeNull();
  });

  it("5\" 2207 1950KV на 6S — как на стендах и в прошивке: ~45 А и ~1.6 кг тяги на мотор", () => {
    const e = estimateBuild(five);
    expect(e.fullAmpsPerMotor).toBeGreaterThan(35);
    expect(e.fullAmpsPerMotor).toBeLessThan(55);
    expect(e.fullThrustG).toBeGreaterThan(1300);
    expect(e.fullThrustG).toBeLessThan(1900);
    expect(e.thrustToWeight).toBeGreaterThan(7);
    expect(e.hoverThrottle!).toBeGreaterThan(0.15);
    expect(e.hoverThrottle!).toBeLessThan(0.45);
    expect(e.hoverMinutes!).toBeGreaterThan(2);
    expect(e.hoverMinutes!).toBeLessThan(12);
    expect(e.batteryMaxA).toBe(130);
    expect(e.warnings).toEqual(["battery-c"]); // 4 × 45 А > 130 А — честно: полный газ просаживает
  });

  it("регулятор: пиковый меньше тока полного газа — «сгорит», длительный — «перегрев»", () => {
    expect(estimateBuild({ ...five, esc: { continuousA: 20, burstA: 25 } }).warnings).toContain("esc-burst");
    const mid = estimateBuild(five).fullAmpsPerMotor;
    expect(estimateBuild({ ...five, esc: { continuousA: mid - 3, burstA: mid + 10 } }).warnings).toContain("esc-continuous");
    expect(estimateBuild({ ...five, esc: { continuousA: 60, burstA: 70 } }).warnings).not.toContain("esc-continuous");
  });

  it("тяжёлый коптер с мелкими винтами — тяги нет", () => {
    const e = estimateBuild({ ...five, prop: { diameterIn: 3, pitchIn: 1.8, blades: 3 }, motor: { statorMm: 14, heightMm: 4, kv: 3800 }, massG: 2000 });
    expect(e.warnings).toContain("no-lift");
  });

  it("7\" 2810 1300KV, 7040, 6S Li-ion — висит долго, батарея — предел полного газа", () => {
    const e = estimateBuild({
      motor: { statorMm: 28, heightMm: 10, kv: 1300 },
      prop: { diameterIn: 7, pitchIn: 4, blades: 3 },
      battery: { cells: 6, mah: 4000, chemistry: "LIION", c: 10 },
      esc: { continuousA: 55, burstA: 65 },
      massG: 1250,
    });
    expect(e.hoverMinutes!).toBeGreaterThan(e.batteryMaxA ? 8 : 0);
    expect(e.thrustToWeight).toBeGreaterThan(3);
    expect(e.warnings).toContain("battery-c");
  });

  it("поиск по каталогу: по словам и тегам", () => {
    expect(searchCatalog("motor", "2810").map((x) => x.id)).toEqual(["m2810-1300"]);
    expect(searchCatalog("battery", "li-ion 6s").length).toBe(2);
    expect(searchCatalog("prop", "7\"").length).toBe(2);
    expect(searchCatalog("esc", "").length).toBe(CATALOG.filter((c) => c.kind === "esc").length);
  });

  it("деталь → настройки платы, настройки → оценка", () => {
    const motor = CATALOG.find((c) => c.id === "m2207-1950")!;
    expect(partParams("motor", motor)).toEqual({ motor_stator_mm: 22, motor_height_mm: 7, motor_kv: 1950 });
    const bat = CATALOG.find((c) => c.id === "b6s1p21700")!;
    expect(partParams("battery", bat)).toMatchObject({ battery_cells: 6, battery_chemistry: "LIION", battery_c_rating: 10 });
    expect(partParams("camera", CATALOG.find((c) => c.kind === "camera")!)).toEqual({});
    const values: Record<string, number | string> = {
      motor_stator_mm: 22,
      motor_height_mm: 7,
      motor_kv: 1950,
      prop_diameter_in: 5.1,
      prop_pitch_in: 4.3,
      prop_blades: 3,
      battery_cells: 6,
      battery_mah: 1300,
      battery_chemistry: "LIPO",
      copter_mass_g: 680,
    };
    const b = buildFromParams((n) => values[n]);
    expect(b).not.toBeNull();
    expect(b!.battery.c).toBe(0);
    expect(buildFromParams((n) => (n === "motor_kv" ? undefined : values[n]))).toBeNull();
  });
});
