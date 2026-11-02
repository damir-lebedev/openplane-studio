import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { drillFeed, drillHint, drillReactionMs, drillStart, type DrillState } from "./failsafeDrill";

const live = (t: number, x: Partial<CopterLive>) => ({ t, arm: false, rx: "ok", block: [], ...x }) as unknown as CopterLive;

function run(frames: CopterLive[]): DrillState {
  return frames.reduce(drillFeed, drillStart());
}

describe("failsafe drill", () => {
  it("passes: armed, radio off, motors stop, radio back, no re-arm", () => {
    const s = run([
      live(0, {}),
      live(100, { arm: true, gps: { fix: true, sats: 12, lat: 0, lon: 0, spd: 0, home: 0 } }),
      live(200, { arm: true }),
      live(300, { arm: true, rx: "lost" }),
      live(600, { arm: false, rx: "lost", block: ["RXLOSS", "FAILSAFE"] }),
      live(2000, { rx: "ok", block: ["FAILSAFE"] }),
      live(3600, { rx: "ok" }),
    ]);
    expect(s.step).toBe("done");
    expect(drillReactionMs(s)).toBe(300);
    expect(s.homeAtArm).toBe(true);
    expect(drillHint(s)).toMatch(/Готово/);
  });

  it("fails when motors keep spinning without the radio", () => {
    const s = run([live(0, { arm: true }), live(100, { arm: true, rx: "fs" }), live(1700, { arm: true, rx: "fs" })]);
    expect(s.step).toBe("failed");
    expect(drillHint(s)).toMatch(/моторы крутятся/);
  });

  it("fails when it re-arms by itself after the radio is back", () => {
    const s = run([live(0, { arm: true }), live(100, { arm: true, rx: "lost" }), live(400, { rx: "lost" }), live(900, { rx: "ok" }), live(1000, { arm: true })]);
    expect(s.step).toBe("failed");
  });

  it("starts over if the pilot disarms before switching the radio off; link flicker restarts the hold", () => {
    expect(run([live(0, { arm: true }), live(100, {})]).step).toBe("arm");
    const s = run([live(0, { arm: true }), live(100, { arm: true, rx: "lost" }), live(400, { rx: "lost" }), live(900, { rx: "ok" }), live(1500, { rx: "lost" }), live(1600, { rx: "ok" }), live(2500, { rx: "ok" })]);
    expect(s.step).toBe("radioOn");
    expect(s.homeAtArm).toBe(false);
  });
});
