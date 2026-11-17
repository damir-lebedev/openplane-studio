import { describe, expect, it } from "vitest";

import { compassWord, distanceBearing, findLost, findReadiness, lostPoint, mapLinks, parseLog, type RadioLog } from "./findLost";

const HEADER = "Date,Time,1RSS(dB),RQly(%),FM,GPS,GSpd(kmh),Alt(m),Sats,Thr";
const row = (time: string, gps: string, sats: number | "", date = "2026-11-18") => `${date},${time},-60,100,ANGL,${gps},0,12,${sats},0`;
const log = (rows: string[], extra: Partial<RadioLog> = {}): RadioLog => ({
  name: "Quad-2026-11-18.csv",
  modified: 100,
  size: 1,
  head: [HEADER, ...rows].join("\n") + "\n",
  tail: "",
  ...extra,
});

// 100 м на север от 55.75, 37.61
const dLat = (100 / 6371000) * (180 / Math.PI);

describe("find lost: EdgeTX log", () => {
  it("parses GPS column with units in other headers, skips empty and zero rows", () => {
    const p = parseLog(log([row("10:00:00.000", "", 0), row("10:00:01.000", "0.000000 0.000000", 0), row("10:00:02.500", "55.750000 37.610000", 12)]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ lat: 55.75, lon: 37.61, sats: 12, altM: 12, time: "10:00:02.500" });
  });

  it("last good point of the last flight, distance and direction from takeoff", () => {
    const l = log([
      row("09:00:00.000", "54.000000 36.000000", 12), // утренний полёт
      row("10:00:00.000", "55.750000 37.610000", 12), // взлёт
      row("10:01:00.000", `${(55.75 + dLat / 2).toFixed(6)} 37.610000`, 11),
      row("10:02:00.000", `${(55.75 + dLat).toFixed(6)} 37.610000`, 10),
      row("10:02:01.000", `${(55.75 + dLat).toFixed(6)} 37.610000`, 2), // перевернулся: фикс пропал
      row("10:02:30.000", `${(55.75 + dLat).toFixed(6)} 37.610000`, 0),
    ]);
    const p = lostPoint(l)!;
    expect(p.start?.time).toBe("10:00:00.000");
    expect(p.last.time).toBe("10:02:00.000");
    expect(p.distanceM).toBeCloseTo(100, 0);
    expect(p.bearingDeg).toBeCloseTo(0, 0);
    expect(p.fixLost).toBe(true);
    expect(p.silentS).toBeCloseTo(30, 3);
  });

  it("uses the tail when the file is big and drops the broken first line", () => {
    const tail = `,37.6\n${row("11:00:00.000", "55.700000 37.600000", 9)}\n${row("11:00:05.000", "55.700100 37.600000", 9)}\n`;
    const p = lostPoint(log([row("08:00:00.000", "1.000000 1.000000", 9)], { tail }))!;
    expect(p.last.lat).toBe(55.7001);
    expect(p.start?.lat).toBe(55.7);
    expect(p.fixLost).toBe(false);
  });

  it("no GPS column or no points — null; newest log with points wins", () => {
    expect(lostPoint({ name: "a", modified: 1, size: 1, head: "Date,Time,RxBt(V)\n2026-11-18,10:00:00.000,16.0\n", tail: "" })).toBeNull();
    const old = log([row("10:00:00.000", "50.000000 30.000000", 12)], { name: "old.csv", modified: 10 });
    const empty = log([row("12:00:00.000", "", 0)], { name: "empty.csv", modified: 30 });
    const fresh = log([row("11:00:00.000", "51.000000 31.000000", 12)], { name: "fresh.csv", modified: 20 });
    expect(findLost([old, empty, fresh])?.log).toBe("fresh.csv");
    expect(findLost([])).toBeNull();
  });

  it("without Sats column every point counts as fixed", () => {
    const head = "Date,Time,GPS\n2026-11-18,10:00:00.000,55.1 37.1\n2026-11-18,10:00:01.000,55.2 37.2\n";
    const p = lostPoint({ name: "x", modified: 1, size: 1, head, tail: "" })!;
    expect(p.last.lat).toBe(55.2);
    expect(p.fixLost).toBe(false);
  });
});

describe("find lost: helpers", () => {
  it("distance, bearing and compass words", () => {
    const east = distanceBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 });
    expect(east.deg).toBeCloseTo(90, 3);
    expect(east.m).toBeCloseTo(111.2, 0);
    expect(compassWord(0)).toBe("север");
    expect(compassWord(350)).toBe("север");
    expect(compassWord(225)).toBe("юго-запад");
  });

  it("map links carry the point", () => {
    const links = mapLinks(55.75, 37.61);
    expect(links[0].url).toContain("mlat=55.750000&mlon=37.610000");
    expect(links[1].url).toContain("query=55.750000,37.610000");
    expect(links[2].url).toContain("pt=37.610000,55.750000");
  });

  it("readiness: RX_LOST beeper, motor beacon, OSD coordinates", () => {
    expect(findReadiness({})).toEqual({ beeper: true, beacon: false, osdCoords: false });
    expect(
      findReadiness({
        beeper_off_flags: { value: 2 },
        dshot_beacon_off_flags: { value: 512 },
        osd_gps_lat_pos: { value: 0x0800 | 97 },
        osd_gps_lon_pos: { value: 0x0800 | 129 },
      }),
    ).toEqual({ beeper: false, beacon: true, osdCoords: true });
    expect(findReadiness({ dshot_beacon_off_flags: { value: 514 } }, { dshot_beacon_off_flags: 512 }).beacon).toBe(true);   // правка ещё в пути
  });
});
