import { describe, expect, it } from "vitest";

import manifestJson from "./__fixtures__/manifest.json";
import { findParam, Manifest } from "./manifest";
import { outOfRange, rangeText, setParamValue } from "./params";
import { importFromFirmware } from "./project";
import { validate } from "./rules";

const manifest = manifestJson as unknown as Manifest;

describe("разумные пределы из @range прошивки", () => {
  it("текст и проверка", () => {
    const rth = findParam(manifest, "RTH_ALTITUDE_M", null)!;
    expect(rangeText(rth)).toBe("15…120 м");
    expect(outOfRange(rth, 40)).toBe(false);
    expect(outOfRange(rth, 400)).toBe(true);
  });

  it("за пределами — предупреждение, а не ошибка: прошить можно", () => {
    const p = importFromFirmware(manifest, "Т", "stm32h743-devebox");
    setParamValue(manifest, p, "RTH_ALTITUDE_M", 400);
    const issues = validate(manifest, p).filter((i) => i.target === "RTH_ALTITUDE_M");
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warning");
    expect(issues[0].text).toContain("обычно 15…120 м");
  });
});

describe("числа режима, функции, крутилки", () => {
  it("по префиксам прошивки; неизвестное — пусто", async () => {
    const { itemParams } = await import("./itemParams");
    expect(itemParams(manifest, "mode", "MODE_CRUISE")).toContain("CRUISE_AIRSPEED_MS");
    expect(itemParams(manifest, "mode", "MODE_LOITER")).toEqual(["LOITER_RADIUS_M", "LOITER_RADIUS_MIN_M", "LOITER_RADIUS_MAX_M", "LOITER_CONVERGENCE"]);
    expect(itemParams(manifest, "knob", "MAX_BANK")).toEqual(["MAX_BANK_MIN_DEG", "MAX_BANK_MAX_DEG"]);
    expect(itemParams(manifest, "mode", "MODE_MANUAL")).toEqual([]);
  });
});
