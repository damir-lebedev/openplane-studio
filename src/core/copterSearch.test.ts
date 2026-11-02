import { describe, expect, it } from "vitest";

import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { BF_DIFFERENCES, BF_TABS, norm, searchCopter } from "./copterSearch";
import { TABS } from "./copterParams";

const board = dumpedBoard([
  param("p_roll", { text: "P крена" }),
  param("p_pitch", { text: "P тангажа" }),
  param("motor_poles", { group: "motors", scope: "master", text: "полюсов у мотора" }),
  param("failsafe_procedure", { type: "enum", group: "safety", scope: "master", options: ["AUTO-LAND", "DROP"], text: "что делать при потере связи" }),
]);

describe("поиск настроек коптера", () => {
  it("имя BF целиком — первая строка, с вкладкой и настройкой", () => {
    const [top] = searchCopter("p_roll", board);
    expect(top).toMatchObject({ tab: "pid", param: "p_roll", name: "p_roll" });
  });

  it("начало имени, пробел вместо _ и регистр", () => {
    expect(searchCopter("P ROLL", board)[0].param).toBe("p_roll");
    expect(searchCopter("motor_po", board)[0]).toMatchObject({ tab: "motors", param: "motor_poles" });
  });

  it("словами по описанию: все слова запроса, ё = е", () => {
    expect(searchCopter("потере связи", board)[0]).toMatchObject({ tab: "failsafe", param: "failsafe_procedure" });
    expect(searchCopter("крена", board).map((h) => h.param)).toEqual(["p_roll"]);
  });

  it("имя BF, которого у нас нет, ведёт на вкладку с объяснением", () => {
    const [top] = searchCopter("dyn_notch_count", board);
    expect(top).toMatchObject({ tab: "filters", name: "dyn_notch" });
    expect(top.note).toBeTruthy();
    expect(searchCopter("газ висения", null)[0].tab).toBe("overview");
    expect(searchCopter("led_strip", null)[0]).toMatchObject({ tab: "other", name: "led_strip" });
  });

  it("без платы — темы и вкладки; по названию вкладки", () => {
    expect(searchCopter("p_roll", null).some((h) => h.param)).toBe(false);
    expect(searchCopter("фильтры", null)[0].tab).toBe("filters");
    expect(searchCopter("betaflight", null)[0].tab).toBe("frombf");
  });

  it("ищет и по переводу описания", () => {
    const en = (s: string) => (s === "P крена" ? "Roll P" : s);
    expect(searchCopter("roll p", board, en)[0].param).toBe("p_roll");
  });

  it("короткий запрос — пусто", () => {
    expect(searchCopter("p", board)).toEqual([]);
    expect(norm(" Dyn_Notch  Ёлка ")).toBe("dyn notch елка");
  });
});

describe("«Я с Betaflight»", () => {
  it("каждая наша вкладка в таблице BF существует", () => {
    const ids = new Set<string>([...TABS.map((x) => x.id), "flight"]);
    for (const row of BF_TABS) for (const tab of row.ours) expect(ids.has(tab)).toBe(true);
    for (const d of BF_DIFFERENCES) if (d.tab) expect(ids.has(d.tab)).toBe(true);
  });
});
