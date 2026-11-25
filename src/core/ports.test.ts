import { describe, expect, it } from "vitest";

import { applyMessage, CopterBoard } from "./copterParams";
import { param, dumpedBoard } from "./__fixtures__/copterBoard";
import { assignCommands, boardUarts, movedRoles, portMap, roleOn, roleProblem, serialLines } from "./ports";

// Плата как SpeedyBee F405 V4: UART1…6, у UART5 только RX; приёмник UART2, MSP UART4, ESC UART5.
function v4(values: Partial<Record<string, number>> = {}, vtxProtocol = "AUTO"): CopterBoard {
  const defaults: Record<string, number> = { serial_rx_uart: 2, serial_gps_uart: 0, serial_msp_uart: 4, serial_esc_uart: 5, serial_vtx_uart: 0 };
  const ports = Object.entries(defaults).map(([name, def]) =>
    param(name, { group: "ports", scope: "master", min: 0, max: 8, default: def, value: values[name] ?? def, set: name in values, profiles: undefined }),
  );
  const vtx = param("vtx_protocol", { type: "enum", group: "vtx", scope: "master", default: "AUTO", value: vtxProtocol, profiles: undefined });
  const b = dumpedBoard([...ports, vtx]);
  const uarts: [number, number, number][] = [
    [1, 1, 1],
    [2, 1, 1],
    [3, 1, 1],
    [4, 1, 1],
    [5, 1, 0],
    [6, 1, 1],
  ];
  return { ...b, header: b.header ? { ...b.header, uarts } : b.header };
}

describe("порты (P63)", () => {
  it("UART платы и карта ролей из заголовка и настроек", () => {
    const b = v4();
    expect(boardUarts(b)).toHaveLength(6);
    expect(boardUarts(b)[4]).toEqual({ n: 5, rx: true, tx: false });
    const m = portMap(b);
    expect(m).toEqual({ rx: 2, gps: 0, msp: 4, esc: 5, vtx: 0 });
    expect(roleOn(m, 4)).toBe("msp");
    expect(roleOn(m, 1)).toBeNull();
    expect(movedRoles(b)).toEqual([]);
  });

  it("без uarts в заголовке (старая прошивка) — портов нет", () => {
    const b = applyMessage(v4(), "params", { count: 0, profiles: 4, profile: 0, rateprofile: 0, build: "x", source: "MODEL", unsaved: false });
    expect(boardUarts(b)).toEqual([]);
  });

  it("роль без нужной ножки не встаёт: SmartAudio — только на TX, MSP — на оба провода", () => {
    const u5 = boardUarts(v4())[4];
    expect(roleProblem(u5, "vtx")).toMatch(/TX/);
    expect(roleProblem(u5, "msp")).toMatch(/TX/);
    expect(roleProblem(u5, "gps")).toBeNull();
    expect(roleProblem({ n: 9, rx: false, tx: true }, "rx")).toMatch(/RX/);
  });

  it("переназначение: сначала освободить UART, потом занять; та же роль — ничего", () => {
    const m = portMap(v4());
    expect(assignCommands(m, 1, "gps")).toEqual([["serial_gps_uart", 1]]);
    expect(assignCommands(m, 4, "gps")).toEqual([
      ["serial_msp_uart", 0],
      ["serial_gps_uart", 4],
    ]);
    expect(assignCommands(m, 2, null)).toEqual([["serial_rx_uart", 0]]);
    expect(assignCommands(m, 2, "rx")).toEqual([]);
    // приёмник с UART2 на UART6 — одной командой: роль уходит со старого места сама
    expect(assignCommands(m, 6, "rx")).toEqual([["serial_rx_uart", 6]]);
  });

  it("строки serial — как в CLI Betaflight; Tramp — свой бит", () => {
    expect(serialLines(v4())).toEqual([
      "serial 0 0 115200 57600 0 115200",
      "serial 1 64 115200 57600 0 115200",
      "serial 2 0 115200 57600 0 115200",
      "serial 3 1 115200 57600 0 115200",
      "serial 4 1024 115200 57600 0 115200",
      "serial 5 0 115200 57600 0 115200",
    ]);
    const moved = v4({ serial_gps_uart: 1, serial_vtx_uart: 6 }, "TRAMP");
    expect(serialLines(moved)[0]).toBe("serial 0 2 115200 57600 0 115200");
    expect(serialLines(moved)[5]).toBe("serial 5 8192 115200 57600 0 115200");
    expect(movedRoles(moved)).toEqual(["gps", "vtx"]);
  });
});
