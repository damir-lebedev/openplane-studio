import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { fenceMap, geofenceCommands, geofenceFlagText, geofenceNotes, geofenceNow, geofenceOf, geofenceOsdCommands, geofencePresetOf, GEOFENCE_PRESETS } from "./geofence";

const safety = (name: string, value: number | string, options?: string[]) =>
  param(name, { group: "safety", scope: "master", type: options ? "enum" : "int", value, default: value, options });

const board = (on: string, radius = 200, alt = 120, noGps = "RETURN", mapPos = 2164) =>
  dumpedBoard([
    safety("geofence", on, ["OFF", "ON"]),
    safety("geofence_radius", radius),
    safety("geofence_alt", alt),
    safety("geofence_no_gps", noGps, ["WARN", "RETURN", "LAND"]),
    param("osd_fence_map_pos", { group: "osd", scope: "master", value: mapPos }),
    param("osd_fence_pos", { group: "osd", scope: "master", value: 2326 }),
    param("gps_rescue_min_start_dist", { group: "gps", scope: "master", value: 15 }),
  ]);

const live = (patch: Partial<CopterLive> = {}) => ({ alt: 0, hdg: 0, ...patch }) as CopterLive;

describe("геозабор", () => {
  it("с платы: включён ли, числа, радар в очках; старая прошивка — null", () => {
    expect(geofenceOf(board("ON"))).toEqual({ on: true, radius: 200, alt: 120, noGps: "RETURN", mapShown: true, distShown: true, zones: 0 });
    expect(geofenceOf(board("OFF", 50, 30, "LAND", 116))).toMatchObject({ on: false, noGps: "LAND", mapShown: false });
    expect(geofenceOf(dumpedBoard([param("p_roll")]))).toBeNull();
  });

  it("наборы и команды", () => {
    expect(geofencePresetOf(geofenceOf(board("ON", 150, 60))!)).toBe("arena");
    expect(geofencePresetOf(geofenceOf(board("ON", 151, 60))!)).toBeNull();
    expect(geofenceCommands(true, GEOFENCE_PRESETS[0])).toEqual([["geofence", "ON"], ["geofence_radius", 50], ["geofence_alt", 30]]);
    expect(geofenceCommands(false)).toEqual([["geofence", "OFF"]]);
    // радар выключен — включить, место прежнее
    expect(geofenceOsdCommands(board("ON", 200, 120, "RETURN", 116))).toEqual([["osd_fence_map_pos", 2164]]);
    expect(geofenceOsdCommands(board("ON"))).toEqual([]);
  });

  it("заметки: без GPS не армится, WARN не держит, радар выключен", () => {
    const texts = (b = board("ON"), l: CopterLive | null = live()) => geofenceNotes(geofenceOf(b)!, b, l).map((n) => n.text);
    expect(texts(board("OFF"))).toEqual([]);
    expect(texts(board("ON"), live({ gps: undefined })).some((t) => t.includes("не заармится"))).toBe(true);
    expect(texts(board("ON", 200, 120, "WARN")).some((t) => t.startsWith("WARN"))).toBe(true);
    expect(texts(board("ON", 200, 120, "RETURN", 116)).some((t) => t.includes("Радар"))).toBe(true);
    expect(texts(board("ON", 20)).some((t) => t.includes("gps_rescue_min_start_dist"))).toBe(true);
  });

  it("живой кадр: надпись по битам, до края", () => {
    expect(geofenceFlagText(0)).toBeNull();
    expect(geofenceFlagText(1 | 2 | 32)).toBe("FENCE RETURN");
    expect(geofenceFlagText(8 | 16)).toBe("FENCE LAND");
    expect(geofenceFlagText(4)).toBe("FENCE ALT");
    expect(geofenceNow(live({ fence: { f: 1, m: 12 }, gps: { fix: true, sats: 12, lat: 0, lon: 0, spd: 3, home: 188, dir: 90 } }))).toEqual({
      dist: 188,
      dir: 90,
      hdg: 0,
      margin: 12,
      flag: "FENCE",
    });
    expect(geofenceNow(null)).toBeNull();
  });

  it("радар как в прошивке: из дома — весь круг; в 60 м к северу носом на север — край впереди, дом сзади", () => {
    const home = fenceMap(100, 0, 0);
    expect(home).toHaveLength(5);
    expect(home[2][4]).toBe("^");
    expect(home[0][4]).toBe(".");
    expect(home[4][4]).toBe(".");
    expect(home[2][0]).toBe(".");
    expect(home[2][8]).toBe(".");
    expect(home).toEqual(["  .....  ", " .     . ", "..  ^  ..", " .     . ", "  .....  "]);
    // те же знаки, что выдала прошивка (test_geofence_params_logic_and_osd)
    expect(fenceMap(100, 60, 180)).toEqual(["         ", "  .....  ", " .. ^ .. ", "..  H  ..", " .     . "]);
  });
});
