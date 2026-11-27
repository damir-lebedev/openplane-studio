import { describe, expect, it } from "vitest";

import {
  ADJ_FUNCTIONS,
  AdjRow,
  adjAbsoluteValue,
  adjActive,
  adjCommand,
  adjMode,
  adjSelectProfile,
  adjStep,
  clearAdjCommand,
  freeAdjSlot,
  newAdjRow,
  parseAdj,
} from "./adjustments";
import { applyMessage, emptyBoard, parseBfDiff } from "./copterParams";

describe("подстройки в полёте (adjrange)", () => {
  it("команды — как в CLI BF, свободный номер, новая строка", () => {
    const r: AdjRow = [3, 1, 1700, 2100, 18, 2, 0, 0];
    expect(adjCommand(r)).toBe("adjrange 3 0 1 1700 2100 18 2 0 0");
    expect(clearAdjCommand(3)).toBe("adjrange 3 0 0 900 900 0 0 0 0");
    expect(freeAdjSlot([[0, 0, 900, 2100, 6, 3, 0, 0], r])).toBe(1);
    expect(newAdjRow(1, 2)).toEqual([1, 0, 900, 2100, 6, 1, 0, 0]);   // каналов мало — последний AUX
  });

  it("как работает ручка: шагом, от центра, профиль", () => {
    const step: AdjRow = [0, 0, 1700, 2100, 18, 2, 0, 0];
    const abs: AdjRow = [1, 0, 900, 2100, 9, 2, 77, 20];
    const sel: AdjRow = [2, 0, 900, 2100, 12, 3, 0, 0];
    expect([adjMode(step), adjMode(abs), adjMode(sel), adjMode([4, 0, 900, 2100, 29, 1, 0, 0])]).toEqual(["step", "absolute", "select", "none"]);
    expect([adjStep(1000), adjStep(1500), adjStep(1701)]).toEqual([-1, 0, 1]);
    // как в прошивке (InflightAdjuster::absoluteValue): целое, за краем — как край
    expect([adjAbsoluteValue(abs, 2000), adjAbsoluteValue(abs, 1250), adjAbsoluteValue(abs, 900)]).toEqual([97, 67, 57]);
    expect([adjSelectProfile(1000), adjSelectProfile(1500), adjSelectProfile(2000)]).toEqual([1, 2, 3]);
    expect([adjActive(step, 1699), adjActive(step, 1700), adjActive(step, 2200), adjActive(step, undefined)]).toEqual([false, true, true, false]);
  });

  it("номера функций — как в BF и без повторов", () => {
    const ids = ADJ_FUNCTIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ADJ_FUNCTIONS.find((f) => f.id === 12)?.name).toBe("RATE PROFILE");
    expect(ADJ_FUNCTIONS.find((f) => f.id === 36)?.name).toBe("PID PROFILE");
    expect(ADJ_FUNCTIONS.find((f) => f.id === 18)?.params).toEqual(["p_roll"]);
  });

  it("ответ @adj: строки по номеру, мусор отброшен; правка — несохранённое", () => {
    expect(parseAdj({ rows: [[5, 1, 1300, 1675, 15, 2, 40, 20], [0, 1, 1700, 2100, 18, 2, 0, 0], [1, 2]] })).toEqual([
      [0, 1, 1700, 2100, 18, 2, 0, 0],
      [5, 1, 1300, 1675, 15, 2, 40, 20],
    ]);
    expect(parseAdj(null)).toEqual([]);
    const loading = applyMessage(emptyBoard(), "params", { count: 0, profiles: 4, profile: 0, rateprofile: 0, unsaved: false });
    const dumped = applyMessage(loading, "adj", { rows: [[0, 1, 1700, 2100, 18, 2, 0, 0]] });
    expect(dumped.adj).toHaveLength(1);
    expect(dumped.unsaved).toBe(false);   // в потоке params — не правка
    const done = applyMessage(dumped, "modes", []);
    expect(applyMessage(done, "adj", { rows: [] }).unsaved).toBe(true);
  });

  it("diff из BF: строки adjrange переносятся", () => {
    const { lines, unknown } = parseBfDiff("adjrange 0 0 1 1700 2100 18 2 0 0\nled 0 0,0::C:0", {});
    expect(lines).toEqual([{ line: "adjrange 0 0 1 1700 2100 18 2 0 0", kind: "adjrange" }]);
    expect(unknown).toEqual(["led 0 0,0::C:0"]);
  });
});
