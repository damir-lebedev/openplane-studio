import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { degToE7, fromOffset, LatLon } from "./geozones";
import { HOME_STEP_M, homeMapScale, homeTrack, HomeTrack, zonesFromHome } from "./homeMap";

const HOME: LatLon = [55.75, 37.62];
const frame = (t: number, n: number | undefined, e: number | undefined, more: Partial<CopterLive> = {}): CopterLive => {
  const at = fromOffset(HOME, n ?? 0, e ?? 0);
  return {
    t, arm: true, state: "ARMED", mode: "ANGLE", rx: "ok", ch: [], att: [0, 0, 0], alt: 20, vz: 0, thr: 0.3, v: 24, hdg: 0,
    motors: [], block: [], modes: [], cpu: 10, hz: 1000, unsaved: false,
    gps: { fix: true, sats: 14, lat: at[0], lon: at[1], spd: 5, ...(n !== undefined ? { home: Math.hypot(n, e ?? 0), dir: 0, n, e } : {}) },
    ...more,
  } as CopterLive;
};

describe("карта: дом и путь", () => {
  it("путь копится точками через 3 м, считает пройденное, дальнее и высоту", () => {
    let tr: HomeTrack | null = null;
    for (let i = 0; i <= 100; ++i) tr = homeTrack(tr, frame(i * 100, i, 0, { alt: 10 + i / 10 }));
    // 0, 3, 6 … 99 — 34 точки; сейчас — последний кадр
    expect(tr!.points).toHaveLength(34);
    expect(tr!.points[1].n).toBe(HOME_STEP_M);
    expect(tr!.now.n).toBe(100);
    expect(tr!.pathM).toBeCloseTo(99, 6);
    expect(tr!.maxDist).toBe(100);
    expect(tr!.maxAlt).toBeCloseTo(20, 6);
    // дом восстановлен из широты/долготы и смещения
    expect(tr!.home[0]).toBeCloseTo(HOME[0], 6);
    expect(tr!.home[1]).toBeCloseTo(HOME[1], 6);
  });

  it("без дома в кадре — путь прежний; новый ARM — путь заново", () => {
    let tr = homeTrack(null, frame(0, 0, 0));
    tr = homeTrack(tr, frame(100, 50, 50));
    expect(tr!.points).toHaveLength(2);
    tr = homeTrack(tr, frame(200, undefined, undefined, { state: "DISARMED" }));
    expect(tr!.points).toHaveLength(2);
    expect(tr!.armed).toBe(false);
    tr = homeTrack(tr, frame(300, 1, 1, { state: "DISARMED" }));
    expect(tr!.points).toHaveLength(3);
    tr = homeTrack(tr, frame(400, 0, 0));
    expect(tr!.points).toHaveLength(1);
    expect(tr!.pathM).toBe(0);
  });

  it("до дома нет — карты нет", () => {
    expect(homeTrack(null, frame(0, undefined, undefined))).toBeNull();
    expect(homeTrack(null, null)).toBeNull();
  });

  it("масштаб по дальнему: 10, 20, 50 … м", () => {
    expect(homeMapScale(0)).toBe(10);
    expect(homeMapScale(9)).toBe(10);
    expect(homeMapScale(12)).toBe(20);
    expect(homeMapScale(300)).toBe(500);
    expect(homeMapScale(99999)).toBe(10000);
  });

  it("зоны геозабора — в метрах от дома; пустые и с ошибкой не рисуются", () => {
    const sq = [fromOffset(HOME, 100, 100), fromOffset(HOME, 100, 200), fromOffset(HOME, 200, 200), fromOffset(HOME, 200, 100)].map(degToE7);
    const z = zonesFromHome(
      [
        { zone: 0, type: "NOFLY", pts: sq, problem: null },
        { zone: 1, type: "NONE", pts: sq, problem: null },
        { zone: 2, type: "FIELD", pts: sq, problem: "пересекается" },
      ],
      HOME,
    );
    expect(z).toHaveLength(1);
    expect(z[0].type).toBe("NOFLY");
    expect(z[0].pts[2][0]).toBeCloseTo(200, 0);
    expect(z[0].pts[2][1]).toBeCloseTo(200, 0);
  });
});
