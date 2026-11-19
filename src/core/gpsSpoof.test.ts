import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { BLIND_PHASE_TEXT, blindView, SPOOF_REASON_TEXT, spoofSettings, spoofView } from "./gpsSpoof";

const live = (gps: CopterLive["gps"]) => ({ gps }) as CopterLive;
const gps = { fix: true, sats: 14, lat: 55.75, lon: 37.62, spd: 0 };

describe("gpsSpoof", () => {
  it("доверие и причина из живого кадра", () => {
    expect(spoofView(null).known).toBe(false);
    expect(spoofView(live(gps)).known).toBe(false);   // старая прошивка — доверия нет
    expect(spoofView(live({ ...gps, trust: 87 }))).toEqual({ known: true, trust: 87, reason: null, level: "ok" });
    expect(spoofView(live({ ...gps, trust: 25 })).level).toBe("warn");
    expect(spoofView(live({ ...gps, trust: 0, spoof: "VELOCITY" }))).toEqual({ known: true, trust: 0, reason: "VELOCITY", level: "bad" });
    expect(spoofView(live({ ...gps, trust: 140 })).trust).toBe(100);
    expect(spoofView(live({ ...gps, trust: 0, spoof: "SOMETHING_NEW" })).reason).toBeNull();
    for (const r of ["JUMP", "VELOCITY", "WIND", "ALTITUDE", "RECEIVER"] as const) expect(SPOOF_REASON_TEXT[r]).toBeTruthy();
  });

  it("настройки: поддержка прошивкой, включено по умолчанию, правка поверх", () => {
    expect(spoofSettings({}).supported).toBe(false);
    const params = { gps_spoof_detect: { value: "ON" }, osd_warn_gps_spoof: { value: "OFF" } };
    expect(spoofSettings(params)).toEqual({ supported: true, detect: true, osdWarn: false, blindSupported: false, blindS: 0 });
    expect(spoofSettings(params, { osd_warn_gps_spoof: "ON", gps_spoof_detect: "OFF" })).toMatchObject({ supported: true, detect: false, osdWarn: true });
    const withBlind = { ...params, deadreck_max_s: { value: 120 } };
    expect(spoofSettings(withBlind)).toMatchObject({ blindSupported: true, blindS: 120 });
    expect(spoofSettings(withBlind, { deadreck_max_s: 0 }).blindS).toBe(0);
  });

  it("домой вслепую: этап, расстояние и неуверенность из живого кадра", () => {
    expect(blindView(null)).toBeNull();
    expect(blindView({} as CopterLive)).toBeNull();
    expect(blindView({ blind: { phase: "FLY_HOME", n: 120, e: -50, err: 14.6 } } as CopterLive)).toEqual({ phase: "FLY_HOME", dist: 130, err: 15 });
    for (const p of ["CLIMB", "FLY_HOME", "LAND"]) expect(BLIND_PHASE_TEXT[p]).toBeTruthy();
  });
});
