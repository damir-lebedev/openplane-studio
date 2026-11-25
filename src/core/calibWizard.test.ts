import { describe, expect, it } from "vitest";

import { CALIB_STEPS, calibProgress, linesSince } from "./calibWizard";

describe("calibProgress", () => {
  it("ждёт ответа, потом отказ по таймауту", () => {
    expect(calibProgress("i", [], 1000).state).toBe("wait");
    const p = calibProgress("i", [], 6000);
    expect(p.state).toBe("failed");
    expect(p.message).toMatch(/не ответила/);
  });

  it("гироскоп: тряска — предупреждение, затем итог", () => {
    const lines = ["LSM6DSV: калибровка гироскопа...", "LSM6DSV: гироскоп трясётся (3.10 °/с) — калибровка заново"];
    expect(calibProgress("i", lines)).toMatchObject({ state: "running", tone: "warn" });
    const done = calibProgress("i", [...lines, "LSM6DSV: калибровка завершена, смещение гироскопа=1,2,3, уход=0.05 °/с, разброс=0.30 °/с"]);
    expect(done).toMatchObject({ state: "done", passed: 1, tone: "ok" });
    expect(done.message).toMatch(/^калибровка завершена/);
  });

  it("акселерометр: итог и отказ", () => {
    const start = "Нуль акселерометра: коптер стоит ровно и неподвижно ~0.5 с...";
    expect(calibProgress("a", [start]).state).toBe("running");
    expect(calibProgress("a", [start, "Нуль акселерометра: acc_calibration = 12,-3,40,1"])).toMatchObject({ state: "done", passed: 1 });
    expect(calibProgress("a", [start, "Нуль акселерометра: не удалось — коптер двигали или стоит с наклоном больше 25°"]).state).toBe("failed");
  });

  it("установка: шаги по порядку и итог", () => {
    const lines = [
      "Калибровка установки: «нос вверх» — передние моторы вверх, «правое крыло вниз» — правые моторы вниз.",
      "ICM42688: калибровка установки — плата может стоять в самолёте как угодно.",
      "  Шаг 1/3: поставьте самолёт ровно, как в горизонтальном полёте.",
    ];
    expect(calibProgress("o", lines)).toMatchObject({ state: "running", step: 0, passed: 0 });
    lines.push("    засчитано", "  Шаг 2/3: поднимите НОС на 30-60° (крылья ровно) и держите.");
    expect(calibProgress("o", lines)).toMatchObject({ step: 1, passed: 1 });
    lines.push("    засчитано");
    expect(calibProgress("o", lines)).toMatchObject({ step: 1, passed: 2 });
    lines.push("  Шаг 3/3: нос обратно, опустите ПРАВОЕ крыло на 30-60° и держите.", "    засчитано", "ICM42688: установка сохранена: X->Y");
    expect(calibProgress("o", lines)).toMatchObject({ state: "done", step: 2, passed: 3, message: "установка сохранена: X->Y" });
    expect(CALIB_STEPS.o.map((s) => s.pose)).toEqual(["level", "noseUp", "rightDown"]);
  });

  it("установка: поза не дождалась, ARM", () => {
    expect(calibProgress("o", ["  Шаг 2/3: …", "ICM42688: поза не дождалась за 30 с — калибровка установки отменена"])).toMatchObject({
      state: "failed",
      step: 1,
    });
    expect(calibProgress("a", ["Только без ARM."]).message).toMatch(/ARM/);
  });
});

describe("linesSince", () => {
  it("берёт только новые строки и не выходит за буфер", () => {
    expect(linesSince(["a", "b", "c"], 10, 8)).toEqual(["b", "c"]);
    expect(linesSince(["a", "b", "c"], 10, 10)).toEqual([]);
    expect(linesSince(["a", "b"], 100, 0)).toEqual(["a", "b"]);
  });
});
