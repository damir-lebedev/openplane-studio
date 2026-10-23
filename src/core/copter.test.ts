import { describe, expect, it } from "vitest";

import manifestJson from "./__fixtures__/manifest.json";
import {
  blankCopter,
  boardDumpCommands,
  cliSetup,
  copterFromKit,
  copterHash,
  findCopterBuild,
  findCopterEnv,
  inFreeBand,
  isCopter,
  setupError,
  switchIssues,
  vtxFrequency,
} from "./copter";
import { Manifest } from "./manifest";

const manifest = manifestJson as unknown as Manifest;

describe("коптер в ангаре", () => {
  it("сборки коптера — из описания прошивки, отдельно от плат самолёта", () => {
    const env = findCopterEnv(manifest, "getfun-f405v3-quad")!;
    expect(env.build).toBe("longrange7li");
    expect(env.esc).toBe("MULTISHOT");
    expect(env.uploadProtocol).toBe("dfu");
    expect(findCopterBuild(manifest, env.build)?.frame).toBe("QUAD_X");
    expect(manifest.boards.some((b) => b.env === "getfun-f405v3-quad")).toBe(false);
  });

  it("набор GETFUN: сборка и комплектующие, видео — 25 мВт и канал в разрешённой полосе", () => {
    const c = copterFromKit(manifest, "getfun7li", "Квадрик");
    expect(isCopter(c)).toBe(true);
    expect(isCopter({ id: "plane-1" })).toBe(false);
    expect(c.board).toBe("getfun-f405v3-quad");
    expect(c.parts.goggles).toContain("Cobra X");
    expect(c.vtxMaxPowerMw).toBe(25);
    expect(vtxFrequency(c.vtxBand, c.vtxChannel)).toBe(5769);
    expect(inFreeBand(5769)).toBe(true);
    expect(inFreeBand(5658)).toBe(false);   // R1 — уже вне 5725–5875
  });

  it("первая настройка: CRSF, потолок, тумблеры ARM/режимы/пищалка и три уровня мощности", () => {
    const c = blankCopter(manifest, "Q");
    c.vtxMaxPowerMw = 200;
    const cmds = cliSetup(c).map((l) => l.cmd);
    expect(cmds).toContain("set serialrx_provider = CRSF");
    expect(cmds).toContain("set vtx_max_power_mw = 200");
    expect(cmds).toContain("set vtx_band = 5");
    expect(cmds).toContain("aux 0 0 0 1700 2100 0 0");       // ARM — AUX1 вверх
    expect(cmds).toContain("aux 1 1 1 900 1300 0 0");        // ANGLE — AUX2 внизу
    expect(cmds).toContain("aux 2 2 1 1300 1700 0 0");       // HORIZON — посередине
    expect(cmds).toContain("aux 3 13 3 1700 2100 0 0");      // BEEPER — AUX4
    expect(cmds).toContain("vtx 0 2 0 0 1 900 1300");
    expect(cmds).toContain("vtx 2 2 0 0 12 1700 2100");      // максимум — прошивка опустит до потолка
    expect(cmds.every((l) => l.length < 120)).toBe(true);   // строка команды платы — до 128 байт

    c.switches = { arm: 0, modes: -1, vtxPower: -1, beeper: -1 };
    const only = cliSetup(c).map((l) => l.cmd);
    expect(only.filter((l) => l.startsWith("aux"))).toEqual(["aux 0 0 0 1700 2100 0 0"]);
    expect(only.some((l) => l.startsWith("vtx "))).toBe(false);
  });

  it("тумблеры: ARM не на AUX1 и два дела на одном канале — замечания", () => {
    expect(switchIssues({ arm: 0, modes: 1, vtxPower: 2, beeper: 3 })).toEqual([]);
    expect(switchIssues({ arm: 1, modes: 2, vtxPower: 2, beeper: -1 })).toHaveLength(2);
    expect(switchIssues({ arm: -1, modes: 1, vtxPower: -1, beeper: -1 })[0]).toContain("ARM");
  });

  it("ответы платы: ошибки @set / @error / @save — текстом, удачные и чужие строки — нет", () => {
    expect(setupError('@set {"name":"vtx_band","ok":false,"error":"допустимо 0 - 10","value":5}')).toBe("vtx_band: допустимо 0 - 10");
    expect(setupError('@error {"cmd":"aux","error":"только без ARM"}')).toBe("aux: только без ARM");
    expect(setupError('@save {"ok":false,"stored":false}')).not.toBeNull();
    expect(setupError('@set {"name":"vtx_band","ok":true,"value":5}')).toBeNull();
    expect(setupError("# vtx_band = 5")).toBeNull();
  });

  it("дамп платы: три команды tools/bf_board.py по имени заголовка", () => {
    const [read, backup, header] = boardDumpCommands("config/boards/GETFUNF405V3.h");
    expect(read).toContain("--out stack/GETFUNF405V3_bf.txt");
    expect(backup).toContain("stack/GETFUNF405V3_original.bin");
    expect(header).toContain("--out include/config/boards/GETFUNF405V3.h");
  });

  it("хэш прошивки: от сборки, проекта и коммита, не от названия", async () => {
    const c = blankCopter(manifest, "A");
    const h = await copterHash(c, "abc");
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(await copterHash({ ...c, name: "B" }, "abc")).toBe(h);
    expect(await copterHash(c, "abd")).not.toBe(h);
    expect(await copterHash({ ...c, board: "aocodarc-f405v3-quad" }, "abc")).not.toBe(h);
  });
});
