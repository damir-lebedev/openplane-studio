import { describe, expect, it } from "vitest";

import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { Chain, chainOf, chipFilter, curve, delayMs, dynHz, FILTER_PARAMS, gainDb, lagDeg, lpf1Hz, notchQ, rpmMarks, spectrumBars } from "./filters";

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

describe("спектр гироскопа и режекторы (060–063)", () => {
  it("полосы без постоянной, пик — выше соседей и среднего", () => {
    const bars = spectrumBars({ bw: 15.6, db: [60, 10, 12, 11, 40, 12, 10, 9], dn: [[], [], []], rpm: [], src: "model" });
    expect(bars).toHaveLength(7);
    expect(bars[0].hz).toBeCloseTo(15.6);
    expect(bars.filter((b) => b.peak).map((b) => Math.round(b.hz))).toEqual([62]);
  });

  it("RPM-фильтр: гармоники каждого мотора, без повторов, стоящие моторы — без режекторов", () => {
    expect(rpmMarks([150, 150, 160, 0], 3)).toEqual([150, 160, 300, 320, 450, 480]);
    expect(rpmMarks([150], 1)).toEqual([150]);
    expect(rpmMarks([150], 0)).toEqual([]);
  });
});

describe("ФЧХ цепочки (071)", () => {
  const pt1 = (hz: number): Chain => ({ lpf1: { type: "PT1", hz }, dyn: { min: 0, max: 0, expo: 0 }, lpf2: { type: "PT1", hz: 0 }, notches: [] });

  it("PT1 на срезе — 45°, далеко выше — к 90°; согласовано с задержкой", () => {
    expect(lagDeg(pt1(100), 100)).toBeCloseTo(45, 3);
    expect(lagDeg(pt1(100), 10000)).toBeGreaterThan(89);
    expect(delayMs(pt1(100), 50)).toBeCloseTo((lagDeg(pt1(100), 50) / 360 / 50) * 1000, 6);
  });

  it("кривая фазы одной развёрткой совпадает с поточечной и не скачет через 180°", () => {
    const c: Chain = { lpf1: { type: "PT3", hz: 120 }, dyn: { min: 0, max: 0, expo: 0 }, lpf2: { type: "BIQUAD", hz: 200 }, notches: [] };
    const pts = curve(c, 0, 20, 1000, 60, "lag");
    for (const [f, lag] of [pts[0], pts[30], pts[59]]) expect(lag).toBeCloseTo(lagDeg(c, f), 3);
    for (let i = 1; i < pts.length; i++) expect(pts[i][1]).toBeGreaterThan(pts[i - 1][1] - 1e-9);
    expect(pts[59][1]).toBeGreaterThan(270);   // PT3 + biquad: до 450° на бесконечности
  });
});

describe("фильтр в чипе гироскопа (065)", () => {
  const HW = ["NORMAL", "OPTION_1", "OPTION_2", "EXPERIMENTAL"];
  const chipBoard = (value: string, table?: [number, number][]) => {
    const b = dumpedBoard([param("gyro_hardware_lpf", { group: "filters", scope: "master", type: "enum", options: HW, min: 0, max: 3, value, default: "NORMAL" })]);
    return table && b.header ? { ...b, header: { ...b.header, gyroHw: table } } : b;
  };
  const TABLE: [number, number][] = [[250, 500], [500, 250], [500, 150], [1000, 80]];

  it("полоса и задержка — из таблицы платы по пункту", () => {
    expect(chipFilter(chipBoard("NORMAL", TABLE))).toEqual({ option: "NORMAL", hz: 250, ms: 0.5, wide: false, restart: false });
    expect(chipFilter(chipBoard("EXPERIMENTAL", TABLE))).toMatchObject({ option: "EXPERIMENTAL", hz: 1000, ms: 0.08, wide: true });
  });

  it("изменённый ждёт перезапуска; без таблицы (чип не умеет) — нет строки", () => {
    const b = chipBoard("NORMAL", TABLE);
    expect(chipFilter({ ...b, pending: { gyro_hardware_lpf: "OPTION_1" }, edited: ["gyro_hardware_lpf"] })).toMatchObject({ option: "OPTION_1", hz: 500, restart: true });
    expect(chipFilter(chipBoard("NORMAL"))).toBeNull();
  });
});
