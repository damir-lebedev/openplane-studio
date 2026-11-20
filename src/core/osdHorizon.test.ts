import { describe, expect, it } from "vitest";

import { horizonCells } from "./osdHorizon";

// Те же случаи, что test_osd_horizon_timer_and_esc в прошивке.
describe("horizonCells", () => {
  const at = (cells: ReturnType<typeof horizonCells>, dx: number) => cells.find((c) => c.dx === dx);

  it("ровно — 9 знаков посередине строки", () => {
    const c = horizonCells(0, 0);
    expect(c).toHaveLength(9);
    expect(c.every((x) => x.dy === 0 && x.level === 4)).toBe(true);
  });

  it("нос вверх — линия ниже, дальше osd_ah_max_pit не уходит", () => {
    expect(at(horizonCells(0, 20), -4)).toEqual({ dx: -4, dy: 4, level: 4 });
    expect(at(horizonCells(0, 60), -4)).toEqual({ dx: -4, dy: 4, level: 4 });
    expect(at(horizonCells(0, -2.5), -4)).toEqual({ dx: -4, dy: -1, level: 8 });
  });

  it("крен вправо — правый край выше; invert — наоборот; больше max_rol — как при нём", () => {
    const r = horizonCells(30, 0);
    expect(at(r, 4)!.dy).toBe(-2);
    expect(at(r, -4)!.dy).toBe(2);
    expect(at(r, -1)).toEqual({ dx: -1, dy: 0, level: 7 });
    expect(at(horizonCells(30, 0, { maxPitch: 20, maxRoll: 40, invert: true }), -4)!.dy).toBe(-2);
    expect(at(horizonCells(80, 0), 4)).toEqual({ dx: 4, dy: -2, level: 2 });
  });
});
