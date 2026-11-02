import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { linkBars, rssiSourceText } from "./link";

const live = (x: Partial<CopterLive>) => ({ rx: "ok", ...x }) as CopterLive;

describe("linkBars", () => {
  it("shows only what the board reports", () => {
    expect(linkBars(null, 80, 20)).toEqual([]);
    expect(linkBars(live({}), 80, 20)).toEqual([]);
    expect(linkBars(live({ lq: 100 }), 80, 20).map((b) => b.key)).toEqual(["lq"]);
  });

  it("marks values under the OSD alarm and lost link", () => {
    const [lq, rssi] = linkBars(live({ lq: 60, rssi: 45, dbm: -71 }), 80, 20);
    expect(lq).toMatchObject({ key: "lq", value: 60, alarm: 80, level: "low" });
    expect(rssi).toMatchObject({ key: "rssi", value: 45, level: "good", dbm: -71 });
    expect(linkBars(live({ lq: 100, rx: "fs" }), 80, 20)[0].level).toBe("none");
    expect(linkBars(live({ rssi: 10 }), 80, 0)[0].level).toBe("good");   // порог 0 — без тревоги
  });

  it("names the RSSI source", () => {
    expect(rssiSourceText("channel")).toContain("rssi_channel");
    expect(rssiSourceText(undefined)).toContain("rssi_src_frame_errors");
  });
});
