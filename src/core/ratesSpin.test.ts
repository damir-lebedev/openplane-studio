import { describe, expect, it } from "vitest";
import { bodyOmega, flipSeconds, liveSticks, spinRates, stickFromUs } from "./ratesSpin";
import { CopterBoard, CopterParam, emptyBoard } from "./copterParams";

function board(values: Record<string, number | string>): CopterBoard {
  const b = emptyBoard();
  for (const [name, value] of Object.entries(values)) {
    b.params[name] = { name, value, default: value, type: typeof value === "string" ? "enum" : "int", group: "rates", min: 0, max: 2000, scope: "rate" } as CopterParam;
    b.order.push(name);
  }
  return b;
}

// ACTUAL: центр 70 °/с, максимум 670 °/с, экспо 0 — как в BF по умолчанию (rc 7, srate 67)
const ACT = board({ rates_type: "ACTUAL", roll_rc_rate: 7, roll_srate: 67, roll_expo: 0, pitch_rc_rate: 7, pitch_srate: 67, pitch_expo: 0, yaw_rc_rate: 7, yaw_srate: 36, yaw_expo: 0, deadband: 10, yaw_deadband: 20 });

describe("ratesSpin: стики → °/с → вращение модели", () => {
  it("мёртвая зона растягивает остаток хода на весь стик (BF 4.3+)", () => {
    expect(stickFromUs(1500, 10)).toBe(0);
    expect(stickFromUs(1509, 10)).toBe(0);
    expect(stickFromUs(2000, 10)).toBe(1);
    expect(stickFromUs(1000, 10)).toBe(-1);
    expect(stickFromUs(1755, 10)).toBeCloseTo(0.5, 5);
    expect(stickFromUs(2100, 0)).toBe(1);   // выше хода — упор
    expect(stickFromUs(undefined)).toBe(0);
  });

  it("каналы — по map: TAER отдаёт крен из второго канала", () => {
    const s = liveSticks([1000, 2000, 1500, 1500], "TAER1234");
    expect(s).toEqual({ roll: 1, pitch: 0, yaw: 0 });
    const r = liveSticks([1500, 1000, 1500, 1500], "AETR1234");
    expect(r.pitch).toBe(-1);   // стик на себя
  });

  it("скорости и время оборота — по кривой платы", () => {
    const r = spinRates(ACT, { roll: 1, pitch: 0, yaw: -1 });
    expect(r.roll).toBeCloseTo(670, 0);
    expect(r.pitch).toBe(0);
    expect(r.yaw).toBeCloseTo(-360, 0);
    expect(flipSeconds(ACT, "roll")).toBeCloseTo(360 / 670, 3);
    expect(flipSeconds(board({ yaw_rc_rate: 0, yaw_srate: 0 }), "yaw")).toBe(0);
  });

  it("оси three.js: крен вправо — вокруг −z, нос вниз — вокруг −x, нос вправо — вокруг −y", () => {
    const [x, y, z] = bodyOmega({ roll: 180, pitch: 90, yaw: 45 });
    expect(z).toBeCloseTo(-Math.PI, 6);
    expect(x).toBeCloseTo(-Math.PI / 2, 6);
    expect(y).toBeCloseTo(-Math.PI / 4, 6);
  });
});
