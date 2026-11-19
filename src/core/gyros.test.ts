import { describe, expect, it } from "vitest";

import { gyroReport } from "./gyros";

describe("два гироскопа", () => {
  it("оба живы, в деле первый, второй ждёт вращения", () => {
    const r = gyroReport([3, 1, 0]);
    expect(r.lines.map((l) => [l.name, l.state, l.tone])).toEqual([
      ["Первый", "в деле", "ok"],
      ["Второй", "в запасе", "muted"],
    ]);
    expect(r.hint).toMatch(/покрутите/);
  });

  it("BOTH и оси совпали — оба в деле", () => {
    const r = gyroReport([3, 3, 1]);
    expect(r.lines.every((l) => l.state === "в деле")).toBe(true);
    expect(r.hintTone).toBe("ok");
  });

  it("второй повёрнут — предупреждение; второй не ответил — без подсказки про оси", () => {
    expect(gyroReport([3, 1, 2]).hintTone).toBe("warn");
    const dead = gyroReport([1, 1, 0]);
    expect(dead.lines[1]).toEqual({ name: "Второй", state: "не отвечает", tone: "warn" });
    expect(dead.hint).toBeNull();
  });
});
