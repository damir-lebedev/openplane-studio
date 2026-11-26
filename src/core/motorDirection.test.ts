import { describe, expect, it } from "vitest";

import { Dir, flipSteps, runSteps, saveSteps, startSteps, wizardPct } from "./motorDirection";

async function lines(steps: Parameters<typeof runSteps>[0]) {
  const out: string[] = [];
  await runSteps(steps, { send: async (l) => void out.push(l), spin: (on) => void out.push(on ? "SPIN" : "STOP"), sleep: async () => {} });
  return out;
}

describe("motorDirection", () => {
  it("старт: всем обычное, потом крутить", async () => {
    expect(await lines(startSteps())).toEqual(["motor stop", "dshot all 7", "SPIN"]);
  });
  it("щелчок разворачивает и возвращает назад", async () => {
    const dirs: Dir[] = ["normal", "normal", "normal", "normal"];
    const a = flipSteps(2, dirs);
    expect(a.dirs).toEqual(["normal", "normal", "reversed", "normal"]);
    expect(await lines(a.steps)).toEqual(["STOP", "motor stop", "dshot 2 8", "SPIN"]);
    const b = flipSteps(2, a.dirs);
    expect(b.dirs[2]).toBe("normal");
    expect(await lines(b.steps)).toContain("dshot 2 7");
  });
  it("команда dshot — только после остановки моторов", () => {
    const { steps } = flipSteps(0, ["normal"]);
    const stop = steps.findIndex((s) => "line" in s && s.line === "motor stop");
    const cmd = steps.findIndex((s) => "line" in s && s.line.startsWith("dshot"));
    const wait = steps.findIndex((s) => "wait" in s);
    expect(stop).toBeLessThan(wait);
    expect(wait).toBeLessThan(cmd);
  });
  it("сохранение всем", async () => {
    expect(await lines(saveSteps())).toEqual(["STOP", "motor stop", "dshot all 12"]);
  });
  it("тяга мастера не выше предела проверки", () => {
    expect(wizardPct(30)).toBe(6);
    expect(wizardPct(4)).toBe(4);
  });
});
