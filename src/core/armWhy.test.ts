import { describe, expect, it } from "vitest";

import { ARM_WHY_CODES, armWhy, armWhyList } from "./armWhy";
import { ARM_TEXT } from "./copterParams";

describe("почему не армится (P10)", () => {
  it("у каждого кода прошивки — слово для очков, что сделать и значок", () => {
    expect(ARM_WHY_CODES.sort()).toEqual(Object.keys(ARM_TEXT).sort());
    for (const code of ARM_WHY_CODES) {
      const x = armWhy(code);
      expect(x.word.length).toBeLessThanOrEqual(11);   // строка OSD, как armBlockWord
      expect(x.how).not.toBe("");
    }
  });

  it("слова — как в прошивке (armBlockWord)", () => {
    expect(armWhy("RXLOSS").word).toBe("NO RADIO");
    expect(armWhy("THROTTLE").word).toBe("THR DOWN");
    expect(armWhy("MSP").word).toBe("NOT SAVED");
    expect(armWhy("ANGLE").word).toBe("NOT LEVEL");
  });

  it("кнопки: калибровка, закрыть CLI, сохранить/отменить, вкладка", () => {
    expect(armWhy("NO_ACC_CAL").fixes).toEqual([{ kind: "key", key: "o", label: "Откалибровать установку" }]);
    expect(armWhy("CLI").fixes[0]).toMatchObject({ kind: "command", cmd: "exit" });
    expect(armWhy("MSP").fixes.map((f) => f.kind)).toEqual(["save", "revert"]);
    expect(armWhy("NO_ARM_AUX").fixes[0]).toMatchObject({ kind: "tab", tab: "modes" });
  });

  it("незнакомый код — сам код и «без описания»; обычное на столе — в конце", () => {
    expect(armWhy("NEWFLAG")).toMatchObject({ word: "NEWFLAG", what: "причина без описания", fixes: [] });
    expect(armWhyList(["THROTTLE", "RXLOSS", "ARMSWITCH", "CLI"]).map((x) => x.code)).toEqual(["RXLOSS", "CLI", "THROTTLE", "ARMSWITCH"]);
  });
});
