import { describe, expect, it } from "vitest";

import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { COLS, MenuKey, menuChanges, menuPress, menuScreen, menuStart, MenuState, PAGE_MAIN, PAGE_PID, PAGE_VTX } from "./osdMenu";

const board = dumpedBoard([
  param("p_roll", { value: 45 }),
  param("vtx_band", { group: "vtx", scope: "master", min: 0, max: 10, value: 5 }),
  param("vtx_low_power_disarm", { group: "vtx", scope: "master", type: "enum", options: ["OFF", "ON", "UNTIL_FIRST_ARM"], value: 2 }),
]);

function keys(s: MenuState, ...ks: MenuKey[]) {
  let exit = null;
  for (const k of ks) ({ state: s, exit } = menuPress(board, s, k));
  return { s, exit };
}

describe("меню в очках (CMS)", () => {
  it("экран как в прошивке: заголовок по центру, курсор, значение справа, подсказка внизу", () => {
    const scr = menuScreen(board, menuStart(board));
    expect(scr).toHaveLength(16);
    expect(scr.every((r) => r.length === COLS)).toBe(true);
    expect(scr[0].trim()).toBe("MENU");
    expect(scr[2]).toBe(" >PROFILES" + " ".repeat(18) + "> ");
    expect(scr[15]).toBe("PITCH MOVE  ROLL SET  YAW BACK");
    expect(menuScreen(board, menuStart(board), 13)).toHaveLength(13);
  });

  it("вниз, вправо — в PID, крен вправо — P крена +1, назад — курсор на PID", () => {
    let { s } = keys(menuStart(board), "down", "right");
    expect(s.page).toBe(PAGE_PID);
    expect(menuScreen(board, s)[0].trim()).toBe("PID  PROFILE 1");
    ({ s } = keys(s, "right", "right"));
    expect(menuScreen(board, s)[2].trimEnd().endsWith("47")).toBe(true);
    expect(menuChanges(board, s)).toEqual([{ name: "p_roll", from: 45, to: 47 }]);
    ({ s } = keys(s, "back"));
    expect(s.page).toBe(PAGE_MAIN);
    expect(s.cursor).toBe(1);
  });

  it("строки, которых нет на плате, не меняются; длинная страница листается", () => {
    let { s } = keys(menuStart(board), "down", "right");
    for (let i = 0; i < 11; i++) ({ s } = keys(s, "down"));
    expect(s.cursor).toBe(11);
    expect(s.top).toBeGreaterThan(0);
    expect(menuScreen(board, s)[1][COLS - 2]).toBe("^");
    ({ s } = keys(s, "right"));
    expect(menuChanges(board, s)).toEqual([]);
  });

  it("VTX: полоса буквой, ENUM — словом; выход — SAVE+EXIT, EXIT, назад из главного", () => {
    const { s } = keys(menuStart(board), "down", "down", "down", "down", "right");
    expect(s.page).toBe(PAGE_VTX);
    const scr = menuScreen(board, s);
    expect(scr[2].trimEnd().endsWith(" R")).toBe(true);
    expect(scr[5].trimEnd().endsWith("UNTIL_FIRST_ARM")).toBe(true);
    expect(keys(menuStart(board), "up", "up", "right").exit).toBe("save");
    expect(keys(menuStart(board), "up", "right").exit).toBe("discard");
    expect(keys(menuStart(board), "back").exit).toBe("discard");
  });

  it("профили по кругу: 4 → 1", () => {
    const { s } = keys(menuStart(board), "right", "left");
    expect(s.pidProfile).toBe(3);
  });
});
