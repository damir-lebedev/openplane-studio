import { describe, expect, it } from "vitest";

import { advise, compatibleBoards, fmtUsd, pickClass } from "./advisor";
import type { CopterEnv } from "./copter";
import type { ManifestBoard } from "./manifest";
import { PilotAnswers } from "./pilot";

const ans = (patch: Partial<PilotAnswers> = {}): PilotAnswers => ({ experience: "new", craft: "quad", classes: [], goals: [], hasDrone: false, ...patch });

describe("подбор дрона (P07)", () => {
  it("класс: выбранный в знакомстве, иначе по целям и опыту", () => {
    expect(pickClass(ans({ classes: ["cine"] }), "mid").cls).toBe("cine");
    // выбранный класс крыла не берётся, если летает только коптеры
    expect(pickClass(ans({ classes: ["wing", "quad7"], craft: "quad" }), "mid").cls).toBe("quad7");
    expect(pickClass(ans(), "mid").cls).toBe("whoop");
    expect(pickClass(ans({ experience: "flying", goals: ["freestyle"] }), "mid").cls).toBe("quad5");
    expect(pickClass(ans({ goals: ["longrange"] }), "mid").cls).toBe("quad7");
    expect(pickClass(ans({ goals: ["longrange"] }), "low").cls).toBe("quad5");
    expect(pickClass(ans({ craft: "wing" }), "mid").cls).toBe("wing");
    expect(pickClass(ans({ craft: "both", goals: ["mapping"] }), "high").cls).toBe("wing");
    expect(pickClass(ans({ experience: "pro" }), "mid").cls).toBe("quad5");
  });

  it("новичку на 7\" — сначала вуп, и он в списке покупок", () => {
    const a = advise(ans({ goals: ["longrange"] }), "mid", "bnf");
    expect(a.cls).toBe("quad7");
    expect(a.whoopFirst).toBe(true);
    expect(a.gear[0].what).toMatch(/Вуп/);
    expect(advise(ans({ experience: "flying", goals: ["longrange"] }), "mid", "bnf").whoopFirst).toBe(false);
  });

  it("сборка: детали из каталога и оценка полёта, которая летает", () => {
    for (const goals of [[], ["freestyle"], ["longrange"]] as PilotAnswers["goals"][]) {
      const a = advise(ans({ experience: "flying", goals }), "mid", "build");
      expect(a.parts.map((p) => p.kind)).toEqual(["frame", "motor", "prop", "esc", "battery", "vtx", "camera"]);
      expect(a.estimate!.thrustToWeight).toBeGreaterThan(1.8);
      expect(a.estimate!.warnings.filter((w) => w.startsWith("esc"))).toEqual([]);
    }
    const lr = advise(ans({ experience: "flying", goals: ["longrange"] }), "mid", "build");
    expect(lr.estimate!.hoverMinutes!).toBeGreaterThan(10);
    expect(advise(ans({ craft: "wing" }), "mid", "build").parts).toEqual([]);
  });

  it("бюджет: цифра только у «не жалко», итог и превышение", () => {
    const low = advise(ans(), "low", "bnf");
    expect(low.digital).toBe(false);
    expect(low.overBudget).toBe(false);
    expect(low.total[0]).toBeLessThanOrEqual(300);
    const hi = advise(ans({ experience: "flying", goals: ["freestyle"] }), "high", "build");
    expect(hi.digital).toBe(true);
    expect(hi.parts.at(-1)!.id).toBe("c-dji");
    // вуп с цифрой не бывает в этом подборе
    expect(advise(ans(), "high", "bnf").digital).toBe(false);
    expect(advise(ans({ experience: "flying", goals: ["longrange"] }), "low", "bnf").overBudget).toBe(true);
    const sum = [hi.drone, ...hi.gear].reduce((s, x) => s + x.usd[1], 0);
    expect(hi.total[1]).toBe(sum);
  });

  it("полётники: коптер — сборки без дампа, крыло — готовые платы", () => {
    const envs = [
      { env: "a", title: "AocodaRC F405 V3", needsBoardDump: false },
      { env: "g", title: "GETFUN F405V3", needsBoardDump: true },
    ] as CopterEnv[];
    const boards = [
      { env: "m", title: "Matek H743-WING", kit: "SENSOR_KIT_MATEK_H743" },
      { env: "e", title: "ESP32", kit: null },
    ] as ManifestBoard[];
    expect(compatibleBoards("quad5", envs, boards)).toEqual(["AocodaRC F405 V3"]);
    expect(compatibleBoards("wing", envs, boards)).toEqual(["Matek H743-WING"]);
  });

  it("цена словами", () => {
    expect(fmtUsd([0, 0])).toBe("бесплатно");
    expect(fmtUsd([90, 140])).toBe("$90–140");
    expect(fmtUsd([20, 20])).toBe("$20");
  });
});
