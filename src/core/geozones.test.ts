import { describe, expect, it } from "vitest";

import { applyMessage, emptyBoard } from "./copterParams";
import { applyFence, fenceMapEdges, fromOffset, LatLon, offsetM, parseCoordList, radarEdges, zoneAreaM2, zoneCommands, zoneProblem, zonesMargin } from "./geozones";

const ref: LatLon = [56, 44];
const at = (n: number, e: number) => fromOffset(ref, n, e);
// поле 200 м на север × 300 м на восток (как в тесте прошивки)
const field = [at(0, 0), at(200, 0), at(200, 300), at(0, 300)];

describe("поле и запретные зоны (P44 б)", () => {
  it("метры туда и обратно, площадь, проверки как в прошивке", () => {
    const [n, e] = offsetM(ref, at(123, -45));
    expect(n).toBeCloseTo(123, 3);
    expect(e).toBeCloseTo(-45, 3);
    expect(zoneAreaM2(field)).toBeCloseTo(60000, -1);
    expect(zoneProblem(field)).toBeNull();
    expect(zoneProblem(field.slice(0, 2))).toBe("меньше 3 точек");
    expect(zoneProblem([at(10, 10), at(30, 30), at(10, 30), at(30, 10)])).toBe("стороны пересекаются");
    expect(zoneProblem([at(0, 0), at(30000, 0), at(0, 10)])).toBe("точки дальше 20 км друг от друга");
  });

  it("запас до края: поле, запретная зона внутри, снаружи — минус", () => {
    const zones = [{ type: "FIELD" as const, pts: field }];
    expect(zonesMargin(zones, at(20, 150))).toBeCloseTo(20, 1);
    expect(zonesMargin(zones, at(210, 150))).toBeCloseTo(-10, 1);
    const withNoFly = [...zones, { type: "NOFLY" as const, pts: [at(60, 140), at(100, 140), at(100, 160), at(60, 160)] }];
    expect(zonesMargin(withNoFly, at(41, 150))).toBeCloseTo(19, 1);
    expect(zonesMargin(withNoFly, at(80, 150))!).toBeLessThan(0);
    expect(zonesMargin([{ type: "FIELD", pts: field.slice(0, 2) }], at(0, 0))).toBeNull();
  });

  it("координаты из буфера: карты, точка с запятой, KML, ошибки", () => {
    expect(parseCoordList("56.3268710, 44.0059870\n56.33 44.01\n\n56.331, 44.02; 56.4, 44.1").pts).toEqual([[56.326871, 44.005987], [56.33, 44.01], [56.331, 44.02], [56.4, 44.1]]);
    const kml = parseCoordList("<Polygon><coordinates>44.0,56.0,0 44.1,56.0,0 44.1,56.1,0 44.0,56.0,0</coordinates></Polygon>");
    expect(kml.pts).toEqual([[56.0, 44.0], [56.0, 44.1], [56.1, 44.1]]);   // кольцо разомкнуто
    expect(parseCoordList("56.3, 44\nабв").line).toBe(2);
    expect(parseCoordList("95, 44").error).toBeTruthy();
  });

  it("строки CLI и ответ @fence в состояние платы", () => {
    expect(zoneCommands(2, "NOFLY", [[56, 44], [56.0001, 44], [56, 44.0001]])).toEqual([
      "geozone 2 clear",
      "geozone 2 NOFLY",
      "geozone 2 0 56.0000000 44.0000000",
      "geozone 2 1 56.0001000 44.0000000",
      "geozone 2 2 56.0000000 44.0001000",
    ]);
    let b = applyMessage({ ...emptyBoard(), loading: true }, "fence", { zone: 1, type: "FIELD", pts: [[560000000, 440000000]], problem: "меньше 3 точек" });
    expect(b.fence).toHaveLength(1);
    expect(b.unsaved).toBe(false);   // в потоке params — не «изменено»
    b = applyMessage({ ...b, loading: false }, "fence", { zone: 0, type: "NONE", pts: [], problem: null });
    expect(b.fence.map((z) => z.zone)).toEqual([1]);
    expect(b.unsaved).toBe(true);
    expect(applyFence(b.fence, { zone: 1, type: "NONE", pts: [], problem: null })).toEqual([]);
  });

  it("радар со сторонами — как в прошивке: сторона в 40 м впереди", () => {
    const rows = fenceMapEdges(100, [[40, -200, 40, 200]]);
    expect(rows).toEqual(["         ", ".........", "    ^    ", "         ", "         "]);
    // стороны из зон в осях носа: нос на восток — северная сторона слева
    const { edges, scale } = radarEdges([{ pts: field }], at(160, 150), 90);
    expect(scale).toBeGreaterThan(150);
    expect(edges.some((e) => Math.abs(e[1] + 40) < 1 && Math.abs(e[3] + 40) < 1)).toBe(true);
  });
});
