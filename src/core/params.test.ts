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
