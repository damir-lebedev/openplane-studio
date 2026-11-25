import { describe, expect, it } from "vitest";

import { accVerdict, emptyTrace, magnitude, pushTrace, TRACE_MS, tracePath, traceRange, traceStats } from "./sensorTrace";

describe("sensorTrace", () => {
  it("держит только последние TRACE_MS и не меняет старую дорожку", () => {
    let tr = emptyTrace(2);
    const first = pushTrace(tr, 0, [1, 2]);
    tr = pushTrace(first, 5000, [3, 4]);
    tr = pushTrace(tr, TRACE_MS + 1000, [5, 6]);
    expect(first.t).toEqual([0]);
    expect(tr.t).toEqual([5000, TRACE_MS + 1000]);
    expect(tr.v).toEqual([
      [3, 5],
      [4, 6],
    ]);
  });

  it("время назад (переподключение) — начинает заново", () => {
    const tr = pushTrace(pushTrace(emptyTrace(1), 9000, [1]), 100, [2]);
    expect(tr.t).toEqual([100]);
  });

  it("пределы: не уже minSpan, с запасом, без данных — вокруг нуля", () => {
    expect(traceRange(emptyTrace(1), 4)).toEqual([-2, 2]);
    let tr = emptyTrace(1);
    tr = pushTrace(tr, 0, [10]);
    tr = pushTrace(tr, 100, [10.2]);
    const [lo, hi] = traceRange(tr, 4);
    expect(hi - lo).toBeCloseTo(4.8);
    expect((hi + lo) / 2).toBeCloseTo(10.1);
    tr = pushTrace(tr, 200, [-90]);
    expect(traceRange(tr, 4)[0]).toBeLessThan(-90);
  });

  it("линия: последний кадр у правого края, NaN рвёт линию", () => {
    let tr = emptyTrace(1);
    tr = pushTrace(tr, 0, [0]);
    tr = pushTrace(tr, TRACE_MS / 2, [NaN]);
    tr = pushTrace(tr, TRACE_MS, [1]);
    expect(tracePath(tr, 0, [0, 1], 100, 50)).toBe("M0.0 50.0M100.0 0.0");
  });

  it("среднее и шум; модуль; акселерометр на столе", () => {
    let tr = emptyTrace(1);
    for (const [i, x] of [1, 3, 1, 3].entries()) tr = pushTrace(tr, i * 10, [x]);
    expect(traceStats(tr, 0)).toEqual({ mean: 2, sd: 1 });
    expect(traceStats(emptyTrace(1), 0)).toBeNull();
    expect(magnitude([0, 0.6, 0.8])).toBeCloseTo(1);
    expect(accVerdict([0, 0, 1.02], true)).toBe("ok");
    expect(accVerdict([0, 0, 0.5], true)).toBe("off");
    expect(accVerdict([0, 0, 0.5], false)).toBeNull();
  });
});
