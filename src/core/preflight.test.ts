import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import type { AuxRow } from "./copterParams";
import { preflight, preflightOsd, preflightReady } from "./preflight";

const live = (patch: Partial<CopterLive> = {}): CopterLive => ({
  t: 1,
  arm: false,
  state: "DISARMED",
  mode: "ANGLE",
  rx: "ok",
  ch: [],
  att: [0, 0, 0],
  alt: 0,
  vz: 0,
  thr: 0,
  v: 25.1,
  cell: 4.18,
  bat: "OK",
  full: true,
  hdg: 0,
  motors: [0, 0, 0, 0],
  block: ["THROTTLE", "ARMSWITCH"],
  modes: [],
  cpu: 30,
  hz: 2000,
  unsaved: false,
  ...patch,
});
const aux: AuxRow[] = [
  [0, 0, 0, 1700, 2100, 0, 0],   // ARM
  [1, 1, 1, 900, 1300, 0, 0],    // ANGLE
];
const state = (items: ReturnType<typeof preflight>) => Object.fromEntries(items.map((x) => [x.id, x.ok]));

describe("перед полётом (P08)", () => {
  it("всё готово, кроме винтов — их подтверждает человек", () => {
    const items = preflight(live(), aux, false);
    expect(state(items)).toEqual({ battery: true, radio: true, armSwitch: true, angle: true, arm: true, failsafe: null, props: null });
    expect(preflightReady(items)).toBe(false);
    expect(preflightReady(preflight(live(), aux, true))).toBe(false);   // failsafe не проверен
    expect(preflightReady(preflight(live(), aux, true, true))).toBe(true);
  });

  it("не полная батарея, нет пульта, GPS ищет, ANGLE не на тумблере, CLI открыт", () => {
    const items = preflight(live({ full: false, cell: 3.85, rx: "lost", gps: { fix: false, sats: 4, lat: 0, lon: 0, spd: 0 }, block: ["RXLOSS", "CLI", "THROTTLE"] }), aux.slice(0, 1), true);
    expect(state(items)).toMatchObject({ battery: false, radio: false, gps: false, angle: false, rescue: false, arm: false });
    expect(items.find((x) => x.id === "battery")!.vars).toEqual({ cell: "3.85" });
    // RXLOSS — уже в «пульте», газ — обычное дело на земле
    expect(items.find((x) => x.id === "arm")!.vars).toEqual({ why: "CLI OPEN" });
  });

  it("без батареи и без связи — нет списка", () => {
    expect(state(preflight(live({ v: 0, bat: "NOT PRESENT", full: undefined }), aux, true)).battery).toBe(false);
    expect(preflight(null, aux, true)).toEqual([]);
  });

  it("строка в очках — как preflightText в прошивке", () => {
    expect(preflightOsd(live())).toBe("BATT OK  RX OK");
    expect(preflightOsd(live({ full: false, rx: "lost", gps: { fix: false, sats: 3, lat: 0, lon: 0, spd: 0 } }))).toBe("NOT FULL  GPS WAIT  NO RADIO");
    expect(preflightOsd(live({ bat: "CRITICAL", gps: { fix: true, sats: 12, lat: 0, lon: 0, spd: 0 } }))).toBe("BATT LOW  GPS OK  RX OK");
    expect(preflightOsd(live({ v: 0, bat: "NOT PRESENT" }))).toBe("RX OK");
  });
});
