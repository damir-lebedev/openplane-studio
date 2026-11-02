import { describe, expect, it } from "vitest";

import { BEACON_CONDITIONS, BEEPER_CONDITIONS, bit, gimbals, isOn, STICK_ARM, STICK_COMBOS, toggled } from "./beeper";
import { applyMessage, emptyBoard, GROUP_TAB, TABS } from "./copterParams";

describe("пищалка", () => {
  it("условия — номера и имена Betaflight, 24 штуки", () => {
    expect(BEEPER_CONDITIONS).toHaveLength(24);
    BEEPER_CONDITIONS.forEach((c, i) => expect(c.n).toBe(i + 1));
    expect(BEEPER_CONDITIONS.find((c) => c.n === 18)?.name).toBe("ON_USB");
    expect(BEACON_CONDITIONS.map((n) => bit(BEEPER_CONDITIONS.find((c) => c.name === n)!.n)).reduce((a, b) => a + b)).toBe(514);
  });

  it("галочка меняет только свой бит маски «выключено»", () => {
    expect(isOn(0, 2)).toBe(true);
    expect(isOn(514, 2)).toBe(false);
    expect(isOn(514, 1)).toBe(true);
    expect(toggled(514, 2, true)).toBe(512);
    expect(toggled(512, 2, true)).toBe(512);
    expect(toggled(0, 24, false)).toBe(2 ** 23);
    expect(toggled(2 ** 24 - 1, 1, true)).toBe(2 ** 24 - 2);
  });

  it("вкладка «Пищалка» — для группы beeper", () => {
    expect(GROUP_TAB.beeper).toBe("beeper");
    expect(TABS.some((x) => x.id === "beeper")).toBe(true);
  });

  it("ошибка «послушать» гаснет ответом @beep", () => {
    let b = applyMessage(emptyBoard(), "error", { cmd: "beep", error: "только без ARM" });
    expect(b.errors.beep).toBe("только без ARM");
    b = applyMessage(b, "beep", { ok: true, name: "RX_LOST" });
    expect(b.errors.beep).toBeUndefined();
  });
});

describe("команды стиками", () => {
  it("газ и рыск — левая ручка, крен и тангаж — правая (Mode 2)", () => {
    // калибровка гироскопа: газ низ, рыск влево, тангаж на себя
    expect(gimbals(STICK_COMBOS[0])).toEqual({ left: [-1, -1], right: [0, -1] });
    // ARM: газ низ, рыск вправо
    expect(gimbals(STICK_ARM[0])).toEqual({ left: [1, -1], right: [0, 0] });
  });

  it("одна команда — одно положение в своём режиме", () => {
    const seen = new Set<string>();
    for (const c of [...STICK_COMBOS, ...STICK_ARM]) {
      const key = `${c.sticks.join(",")}/${c.when ?? "any"}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
