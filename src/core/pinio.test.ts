import { describe, expect, it } from "vitest";

import { formatPinio, fpvMix, parsePinio, pinioConfigOf, pinioUse } from "./pinio";

describe("pinio", () => {
  it("parses like the firmware: empty and unnamed pins follow the board file", () => {
    expect(parsePinio("")).toEqual([null, null, null, null]);
    expect(parsePinio(" 41, 40")).toEqual([41, 40, null, null]);
    expect(parsePinio("40,41,42,43")).toEqual([40, 41, 42, 43]);
    expect(parsePinio("40,41,42,43,44")).toBeNull();
    expect(parsePinio("256")).toBeNull();
    expect(parsePinio("x")).toBeNull();
  });

  it("formats up to the last named pin", () => {
    expect(formatPinio([null, null, null, null], 255)).toBe("");
    expect(formatPinio([41, null, 42, null], 255)).toBe("41,255,42");
  });

  it("maps pinio_config bits", () => {
    expect(pinioUse(1)).toBe("out");
    expect(pinioUse(129)).toBe("inverted");
    expect(pinioUse(0)).toBe("off");
    expect(pinioConfigOf("inverted")).toBe(129);
    expect(pinioConfigOf("off")).toBe(0);
  });

  it("FPV angle mix moves part of yaw into roll", () => {
    const m = fpvMix(0, 100, 30);
    expect(m.roll).toBeCloseTo(50, 3);
    expect(m.yaw).toBeCloseTo(86.6, 1);
    expect(fpvMix(100, 0, 30).yaw).toBeCloseTo(-50, 3);
  });
});
