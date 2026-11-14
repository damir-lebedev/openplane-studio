import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { climbAt, driftScale, driftStats, driftTrail, DriftTrail, posHoldMissing, throttleZones } from "./posHold";

const frame = (t: number, more: Partial<CopterLive>): CopterLive =>
  ({ t, arm: true, state: "ARMED", mode: "POS_HOLD", rx: "ok", ch: [], att: [0, 0, 0], alt: 10, vz: 0, thr: 0.3, v: 24, hdg: 0, motors: [], block: [], modes: [], cpu: 10, hz: 1000, unsaved: false, ...more }) as CopterLive;

describe("картинка дрейфа", () => {
  it("POS HOLD: точки — от цели удержания; новая цель — след заново", () => {
    let trail: DriftTrail | null = null;
    for (let i = 0; i < 20; ++i) {
      trail = driftTrail(trail, frame(i * 250, { pos: { n: 30 + 0.1 * i, e: -12, vn: 0, ve: 0, hold: "HOLD", tn: 30, te: -12.5 } }));
    }
    expect(trail!.anchor).toBe("hold");
    expect(trail!.points).toHaveLength(20);
    const s = driftStats(trail)!;
    expect(s.now).toBeCloseTo(Math.hypot(1.9, 0.5), 3);
    expect(s.max).toBeCloseTo(s.now, 3);
    expect(s.rms).toBeLessThan(s.max);
    // стик: цель едет за коптером — следа нет, пока не встанет
    trail = driftTrail(trail, frame(6000, { pos: { n: 40, e: -12, vn: 4, ve: 0, hold: "MOVE", tn: 40, te: -12 } }));
    expect(trail!.points).toHaveLength(1);
    expect(driftStats(trail)!.now).toBeCloseTo(0, 6);
  });

  it("чаще 5 раз в секунду точки не копятся, старше 30 с — уходят", () => {
    let trail: DriftTrail | null = null;
    for (let i = 0; i < 100; ++i) trail = driftTrail(trail, frame(i * 50, { pos: { n: 0, e: 0.01 * i, vn: 0, ve: 0, hold: "HOLD", tn: 0, te: 0 } }));
    expect(trail!.points.length).toBeLessThanOrEqual(26);
    // последняя точка — свежая
    expect(trail!.points[trail!.points.length - 1].e).toBeCloseTo(0.99, 5);
    trail = driftTrail(trail, frame(60000, { pos: { n: 0, e: 0, vn: 0, ve: 0, hold: "HOLD", tn: 0, te: 0 } }));
    expect(trail!.points).toHaveLength(1);
  });

  it("без удержания — от места, где начали смотреть; без оценки — по фиксам GPS", () => {
    let trail = driftTrail(null, frame(0, { pos: { n: 100, e: 50, vn: 0, ve: 0 } }));
    trail = driftTrail(trail, frame(500, { pos: { n: 100.6, e: 49.2, vn: 0, ve: 0 } }));
    expect(trail!.anchor).toBe("est");
    expect(driftStats(trail)!.now).toBeCloseTo(1, 3);

    const gps = (lat: number, lon: number) => ({ fix: true, sats: 14, lat, lon, spd: 0 });
    let raw = driftTrail(null, frame(0, { gps: gps(55.75, 37.61) }));
    raw = driftTrail(raw, frame(500, { gps: gps(55.75001, 37.61) }));   // 1.11 м на север
    expect(raw!.anchor).toBe("gps");
    expect(driftStats(raw)!.now).toBeCloseTo(1.11, 1);
    // ни оценки, ни фикса — картинки нет
    expect(driftTrail(raw, frame(900, { gps: { ...gps(0, 0), fix: false } }))).toBeNull();
    expect(driftStats(null)).toBeNull();
  });

  it("масштаб — чтобы след помещался", () => {
    expect(driftScale(0.3)).toBe(1);
    expect(driftScale(0.99)).toBe(2);
    expect(driftScale(4)).toBe(5);
    expect(driftScale(12)).toBe(20);
    expect(driftScale(900)).toBe(200);
  });
});

describe("POS HOLD и ALT HOLD по настройкам", () => {
  const auto = (name: string, value: number | string, more = {}) => param(name, { group: "autopilot", scope: "master", default: value, value, from: "table", ...more });

  it("чего не хватает для удержания позиции", () => {
    const board = dumpedBoard([auto("pos_hold_without_mag", "OFF", { type: "enum", options: ["OFF", "ON"] }), auto("gps_minimum_sats", 8, { group: "gps" })]);
    const gps = { fix: true, sats: 12, lat: 0, lon: 0, spd: 0 };
    const mag = { raw: [1, 2, 3] as [number, number, number], f: 48, cal: true, ok: true, bad: false };
    expect(posHoldMissing(board, null)).toEqual([]);
    expect(posHoldMissing(board, frame(0, { gps, mag }))).toEqual([]);
    expect(posHoldMissing(board, frame(0, { mag }))).toEqual(["GPS не отвечает"]);
    expect(posHoldMissing(board, frame(0, { gps: { ...gps, sats: 5 }, mag }))).toEqual(["спутников меньше gps_minimum_sats"]);
    expect(posHoldMissing(board, frame(0, { gps, mag: { ...mag, cal: false } }))[0]).toMatch(/не откалиброван/);
    expect(posHoldMissing(board, frame(0, { gps, mag: { ...mag, bad: true } }))[0]).toMatch(/расходится/);
    expect(posHoldMissing(board, frame(0, { gps }))[0]).toMatch(/компаса нет/);
    const without = dumpedBoard([auto("pos_hold_without_mag", "ON", { type: "enum", options: ["OFF", "ON"] })]);
    expect(posHoldMissing(without, frame(0, { gps }))).toEqual([]);
  });

  it("стик газа: зона удержания вокруг центра, набор и снижение — как в прошивке", () => {
    const z = throttleZones(dumpedBoard([auto("alt_hold_deadband", 20), auto("alt_hold_adjust_rate", 50)]));
    expect(z.low).toBeCloseTo(0.4, 6);
    expect(z.high).toBeCloseTo(0.6, 6);
    expect(z.climb).toBe(5);
    expect(z.descent).toBe(3);
    expect(climbAt(z, 0.5)).toBe(0);
    expect(climbAt(z, 0.59)).toBe(0);
    expect(climbAt(z, 1)).toBeCloseTo(5, 6);
    expect(climbAt(z, 0.8)).toBeCloseTo(2.5, 6);
    expect(climbAt(z, 0)).toBeCloseTo(-3, 6);
    // старая прошивка без настроек — умолчания BF
    expect(throttleZones(dumpedBoard([])).climb).toBe(5);
  });
});
