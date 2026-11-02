import { describe, expect, it } from "vitest";

import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { radioReady, radioSetupSteps } from "./radioSetup";

const rx = (provider: string, telemetry?: string) =>
  dumpedBoard([
    param("serialrx_provider", { type: "enum", group: "receiver", scope: "master", options: ["IBUS", "SBUS", "CRSF"], value: provider, default: "CRSF" }),
    ...(telemetry ? [param("crsf_telemetry", { type: "enum", group: "receiver", scope: "master", options: ["OFF", "ON"], value: telemetry, default: "ON" })] : []),
  ]);

describe("настройка с пульта (188)", () => {
  it("CRSF и телеметрия — плата готова, остальное на пульте", () => {
    const steps = radioSetupSteps(rx("CRSF", "ON"));
    expect(steps.map((s) => [s.key, s.ok])).toEqual([
      ["crsf", true],
      ["telemetry", true],
      ["lua", null],
      ["menu", null],
    ]);
    expect(radioReady(rx("CRSF", "ON"))).toBe(true);
  });

  it("телеметрия выключена — кнопка включить; SBUS — без кнопки", () => {
    const off = radioSetupSteps(rx("CRSF", "OFF"));
    expect(off[1].ok).toBe(false);
    expect(off[1].fix).toMatchObject({ name: "crsf_telemetry", value: "ON" });
    const sbus = radioSetupSteps(rx("SBUS", "ON"));
    expect(sbus[0].ok).toBe(false);
    expect(sbus[0].fix).toBeUndefined();
    expect(radioReady(rx("SBUS", "ON"))).toBe(false);
  });
});
