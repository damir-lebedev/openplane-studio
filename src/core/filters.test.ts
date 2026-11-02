import { describe, expect, it } from "vitest";

import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { Chain, chainOf, delayMs, dynHz, FILTER_PARAMS, gainDb, lpf1Hz, notchQ } from "./filters";

const TYPES = ["PT1", "BIQUAD", "PT2", "PT3"];
const f = (name: string, value: number | string) =>
  param(name, { group: "filters", scope: name.startsWith("dterm") ? "pid" : "master", type: typeof value === "string" ? "enum" : "int", options: typeof value === "string" ? TYPES : undefined, min: 0, max: 1000, value, default: value });

const values: Record<string, number | string> = {
  gyro_lpf1_type: "PT1",
  gyro_lpf1_static_hz: 250,
  gyro_lpf1_dyn_min_hz: 250,
  gyro_lpf1_dyn_max_hz: 500,
  gyro_lpf1_dyn_expo: 5,
  gyro_lpf2_type: "PT1",
  gyro_lpf2_static_hz: 500,
  gyro_notch1_hz: 0,
  gyro_notch1_cutoff: 0,
  gyro_notch2_hz: 0,
  gyro_notch2_cutoff: 0,
  dterm_lpf1_type: "PT1",
  dterm_lpf1_static_hz: 75,
  dterm_lpf1_dyn_min_hz: 0,
  dterm_lpf1_dyn_max_hz: 0,
  dterm_lpf1_dyn_expo: 5,
  dterm_lpf2_type: "PT1",
  dterm_lpf2_static_hz: 0,
  dterm_notch_hz: 0,
  dterm_notch_cutoff: 0,
};
const board = (patch: Record<string, number | string> = {}) => dumpedBoard(Object.entries({ ...values, ...patch }).map(([n, v]) => f(n, v)));

describe("фильтры как в BF", () => {
  it("цепочки из настроек; старая прошивка без них — null", () => {
    const g = chainOf(board(), "gyro")!;
    expect(g.lpf1).toEqual({ type: "PT1", hz: 250 });
    expect(g.dyn).toEqual({ min: 250, max: 500, expo: 5 });
    expect(g.notches).toHaveLength(2);
    expect(chainOf(board(), "dterm")!.notches).toHaveLength(1);
    expect(chainOf(dumpedBoard([param("p_roll")]), "gyro")).toBeNull();
    expect(FILTER_PARAMS.gyro).toHaveLength(11);
  });

  it("динамический срез: газ 0 — min, 1 — max, середина при expo 5 — 62.5 % пути (как прошивка)", () => {
    const d = { min: 250, max: 450, expo: 5 };
    expect(dynHz(d, 0)).toBe(250);
    expect(dynHz(d, 1)).toBe(450);
    expect(dynHz(d, 0.5)).toBeCloseTo(375);
    expect(lpf1Hz(chainOf(board(), "dterm")!, 1)).toBe(75);
  });

  it("−3 дБ на срезе у каждого типа; выше среза PT3 гасит сильнее PT1", () => {
    const one = (type: string): Chain => ({ lpf1: { type: type as Chain["lpf1"]["type"], hz: 100 }, dyn: { min: 0, max: 0, expo: 5 }, lpf2: { type: "PT1", hz: 0 }, notches: [] });
    for (const ty of TYPES) expect(gainDb(one(ty), 100)).toBeCloseTo(-3.01, 1);
    expect(gainDb(one("PT3"), 300)).toBeLessThan(gainDb(one("PT1"), 300) - 5);
    // задержка: PT1 100 Гц на 100 Гц — 45° = 1.25 мс
    expect(delayMs(one("PT1"), 100)).toBeCloseTo(1.25, 2);
  });

  it("режектор: Q из cutoff как в BF, на центре — глубокий провал", () => {
    expect(notchQ({ hz: 200, cutoff: 160 })).toBeCloseTo(2.222, 3);
    const g = chainOf(board({ gyro_notch1_hz: 200, gyro_notch1_cutoff: 160 }), "gyro")!;
    expect(gainDb(g, 200)).toBeLessThan(-30);
    expect(gainDb(g, 60)).toBeGreaterThan(-1);
  });
});
