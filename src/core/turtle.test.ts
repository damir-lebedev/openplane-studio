import { describe, expect, it } from "vitest";

import { FrameMotor } from "./copterParams";
import { sticksFromChannels, TURTLE_DEADBAND, TURTLE_STOP, turtleMix } from "./turtle";

// Квадро X как в прошивке: 1 задний правый, 2 передний правый, 3 задний левый, 4 передний левый.
const QUAD: FrameMotor[] = [
  [-0.71, 0.71, "cw", false],
  [0.71, 0.71, "ccw", false],
  [-0.71, -0.71, "ccw", false],
  [0.71, -0.71, "cw", false],
];
const spinning = (m: number[]) => m.map((v) => v !== TURTLE_STOP);

describe("turtle mode: какие моторы крутятся (как copter/Turtle.h)", () => {
  it("стик выбирает сторону, угол или пару рысканья", () => {
    expect(spinning(turtleMix(QUAD, 0.1, 0, 0, 0))).toEqual([false, false, false, false]); // мёртвая зона
    expect(spinning(turtleMix(QUAD, 1, 0, 0, 0))).toEqual([true, true, false, false]); // вправо — правые
    expect(spinning(turtleMix(QUAD, -1, 0, 0, 0))).toEqual([false, false, true, true]);
    expect(spinning(turtleMix(QUAD, 0, -1, 0, 0))).toEqual([false, true, false, true]); // от себя — передние
    expect(spinning(turtleMix(QUAD, 0, 1, 0, 0))).toEqual([true, false, true, false]);
    expect(spinning(turtleMix(QUAD, 0.7, -0.7, 0, 0))).toEqual([false, true, false, false]); // угол
    expect(spinning(turtleMix(QUAD, 0.985, -0.174, 0, 0))).toEqual([true, true, false, false]); // 10° от оси — ось
    // рысканье вправо — моторы «по часовой» (в прошивке mix.yaw = −1), влево — другая пара
    expect(spinning(turtleMix(QUAD, 0.2, 0, 1, 0))).toEqual([true, false, false, true]);
    expect(spinning(turtleMix(QUAD, 0, 0, -1, 0))).toEqual([false, true, true, false]);
  });

  it("сила: экспо и остальные моторы", () => {
    const x = (0.5 - TURTLE_DEADBAND) / (1 - TURTLE_DEADBAND);
    expect(turtleMix(QUAD, 0.5, 0, 0, 0.35)[0]).toBeCloseTo(0.65 * x + 0.35 * x ** 3, 5);
    expect(turtleMix(QUAD, 1, 0, 0, 0)[0]).toBe(1);
    expect(turtleMix(QUAD, 1, 0, 0, 0, 0.5)[2]).toBeCloseTo(0.5, 6);
  });

  it("стики из каналов @live по map", () => {
    const s = sticksFromChannels([1500, 1000, 2000, 1750], "TAER1234"); // T, A, E, R
    expect(s.roll).toBe(-1);
    expect(s.pitch).toBe(-1); // от себя (E 2000) — тангаж «вперёд»
    expect(s.yaw).toBe(0.5);
  });
});
