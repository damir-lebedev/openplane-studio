import { describe, expect, it } from "vitest";

import { EZ_DEFAULT, ezLimit, MIX_CASES, mixQuadX, yawKept } from "./mixerType";

const span = (m: number[]) => Math.max(...m) - Math.min(...m);

describe("mixer_type (как copter/Mixer.h)", () => {
  it("мелкие команды — одинаково во всех типах", () => {
    const c = { throttle: 0.5, roll: 0.1, pitch: 0, yaw: 0.05, stick: 1 };
    const ref = mixQuadX("LEGACY", c).motors;
    for (const type of ["LINEAR", "DYNAMIC", "EZLANDING"] as const) {
      mixQuadX(type, c).motors.forEach((v, i) => expect(v).toBeCloseTo(ref[i], 5));
    }
  });

  it("на упоре LEGACY урезает рысканье, LINEAR — нет (газ в середину)", () => {
    const c = { throttle: 0.5, roll: 0.3, pitch: 0, yaw: 0.3, stick: 1 };
    const a = mixQuadX("LEGACY", c);
    const b = mixQuadX("LINEAR", c);
    expect(a.clipped && b.clipped).toBe(true);
    expect(b.throttle).toBeCloseTo(0.5, 5);
    expect(yawKept(b, c)).toBeGreaterThan(yawKept(a, c) + 0.1);
  });

  it("DYNAMIC: середина газа — LEGACY, полный — LINEAR", () => {
    const mid = { throttle: 0.5, roll: 0.3, pitch: 0, yaw: 0.3, stick: 1 };
    mixQuadX("DYNAMIC", mid).motors.forEach((v, i) => expect(v).toBeCloseTo(mixQuadX("LEGACY", mid).motors[i], 5));
    const top = { ...mid, throttle: 1 };
    mixQuadX("DYNAMIC", top).motors.forEach((v, i) => expect(v).toBeCloseTo(mixQuadX("LINEAR", top).motors[i], 5));
  });

  it("EZLANDING: у земли разница не больше ez_landing_limit, стик за порогом — полный ход", () => {
    const c = MIX_CASES.touchdown;
    expect(span(mixQuadX("LEGACY", c).motors)).toBeCloseTo(0.6, 4);
    expect(span(mixQuadX("EZLANDING", c).motors)).toBeCloseTo(0.15, 4);
    expect(ezLimit({ ...c, stick: 0.125 }, EZ_DEFAULT)).toBeCloseTo(0.575, 4);
    expect(span(mixQuadX("EZLANDING", { ...c, stick: 0.3 }).motors)).toBeCloseTo(0.6, 4);
  });
});
