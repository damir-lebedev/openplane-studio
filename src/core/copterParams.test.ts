import { describe, expect, it } from "vitest";

import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { applyMessage, checkValue, parseBfDiff, rateAt, tabParams } from "./copterParams";

describe("настройки коптера с платы", () => {
  it("дамп: заголовок, настройки по порядку, @rc, конец — по @modes", () => {
    const b = dumpedBoard([param("p_roll"), param("serialrx_provider", { type: "enum", group: "receiver", scope: "master", options: ["IBUS", "SBUS", "CRSF"], value: "CRSF", default: "CRSF" })]);
    expect(b.loading).toBe(false);
    expect(b.loadedAt).toBe(123);
    expect(b.order).toEqual(["p_roll", "serialrx_provider"]);
    expect(b.unsaved).toBe(false);   // @rc во время дампа — не правка
    expect(b.rc?.usingFallback).toBe(true);
    expect(tabParams(b, "receiver").map((p) => p.name)).toEqual(["serialrx_provider"]);
    expect(tabParams(b, "pid", ["p_roll"])).toEqual([]);
  });

  it("set: ок — новое значение в активном профиле, ошибка — текст у настройки", () => {
    let b = dumpedBoard([param("p_roll")]);
    b = { ...b, pending: { p_roll: 47 } };
    b = applyMessage(b, "set", { name: "p_roll", ok: true, value: 47 });
    expect(b.params.p_roll.value).toBe(47);
    expect(b.params.p_roll.set).toBe(true);
    expect(b.params.p_roll.profiles).toEqual([47, 40, 40, 40]);
    expect(b.pending).toEqual({});
    expect(b.unsaved).toBe(true);
    b = applyMessage(b, "set", { name: "p_roll", ok: false, error: "допустимо 0 - 250", value: 47 });
    expect(b.errors.p_roll).toBe("допустимо 0 - 250");
    b = applyMessage(b, "save", { ok: true, stored: true });
    expect(b.unsaved).toBe(false);
    expect(b.errors).toEqual({});
    b = applyMessage(b, "rc", { ...b.rc!, aux: [[0, 0, 0, 1700, 2100, 0, 0]], usingFallback: false });
    expect(b.unsaved).toBe(true);   // aux после дампа — правка
    b = applyMessage(b, "motor", { ok: true, max: 30, m: [10, 0, 0, 0] });
    expect(b.motorTest).toEqual([10, 0, 0, 0]);
  });

  it("проверка ввода по границам и типу", () => {
    const p = param("p_roll");
    expect(checkValue(p, 47)).toBeNull();
    expect(checkValue(p, 300)).toBe("не больше 250");
    expect(checkValue(p, 4.5)).toBe("нужно целое");
    expect(checkValue(p, "abc")).toBe("нужно число");
    expect(checkValue(param("x", { type: "enum", options: ["OFF", "ON"] }), "ON")).toBeNull();
    expect(checkValue(param("x", { type: "enum", options: ["OFF", "ON"] }), "MAYBE")).toBe("нет такого значения");
    expect(checkValue(param("n", { type: "string", maxlen: 4 }), "ABCDE")).toBe("не длиннее 4");
  });

  it("кривая расходов как в прошивке (Presets.h RateCurve)", () => {
    expect(rateAt(20, 67, 50, 0)).toBe(0);
    expect(rateAt(20, 67, 50, 1)).toBeCloseTo(670, 6);
    expect(rateAt(20, 67, 50, -1)).toBeCloseTo(-670, 6);
    // у центра наклон — «центр»
    expect(rateAt(20, 67, 50, 0.01) / 0.01).toBeCloseTo(200, 0);
    // максимум меньше центра — прямая
    expect(rateAt(30, 10, 0, 1)).toBeCloseTo(300, 6);
  });

  it("diff all из Betaflight: понятное — строками, железо и незнакомое — отдельно", () => {
    const params = { p_roll: param("p_roll"), vtx_band: param("vtx_band", { group: "vtx" }), craft_name: param("craft_name", { group: "other", type: "string" }) };
    const dump = [
      "### version",
      "# Betaflight / STM32F405 (S405) 4.5.1",
      "### diff all",
      "# version",
      "batch start",
      "board_name GETFUNF405V3",
      "resource MOTOR 1 B00",
      "feature -RX_PARALLEL_PWM",
      "serial 1 64 115200 57600 0 115200",
      "aux 0 0 0 1700 2100 0 0",
      "map TAER1234",
      "set vtx_band = 5",
      "set craft_name = Q7",
      "set gyro_1_spibus = 1",
      "profile 0",
      "set p_roll = 52",
      "rateprofile 0",
      "batch end",
      "save",
    ].join("\n");
    const { lines, unknown } = parseBfDiff(dump, params);
    expect(lines.map((l) => l.line)).toEqual(["aux 0 0 0 1700 2100 0 0", "map TAER1234", "set vtx_band 5", "set craft_name Q7", "profile 0", "set p_roll 52", "rateprofile 0"]);
    expect(lines.find((l) => l.name === "p_roll")?.group).toBe("pid");
    expect(unknown).toEqual(["resource MOTOR 1 B00", "feature -RX_PARALLEL_PWM", "serial 1 64 115200 57600 0 115200", "set gyro_1_spibus = 1"]);
    // просто вставленный diff (без заголовков ###) — тоже
    expect(parseBfDiff("set p_roll = 50", params).lines).toHaveLength(1);
  });
});
