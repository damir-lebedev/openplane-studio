// Разбор журнала ящика на начале настоящего полёта коптера в симуляторе
// (plane: test/native/test_copter_blackbox, OPENPLANE_COPTER_BLACKBOX_DUMP).

// типов Node в проекте нет (приложение — браузерное), тесты vitest идут в Node
// @ts-ignore
import { readFileSync } from "node:fs";
// @ts-ignore
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { meanRotation, modeSpans, spectrum, summarize } from "./bbanalysis";
import { decodeFlight, extractFlight, parseFields, readHeader, ringFlights, SECTOR, valueAt } from "./blackbox";

const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("./__fixtures__/copter_flight_head.bbl", import.meta.url))));

describe("журнал ящика", () => {
  it("читает заголовок, схему и записи коптера", () => {
    const f = decodeFlight(bytes);
    expect(f.number).toBe(1);
    expect(f.vehicle).toBe("copter");
    expect(f.info.vehicle).toBe("copter");
    expect(f.info.build).toBe("freestyle5");
    expect(f.info.motors).toBe("4");
    expect(f.badSectors).toBe(0);
    expect(f.tornRecords).toBe(0);
    const g = f.series.QGYRO;
    expect(g.fields).toContain("gyrof_roll");
    expect(g.count).toBeGreaterThan(2000);
    expect(f.series.QCTRL.count).toBe(g.count);
    expect(f.series.QSTATE.count).toBeGreaterThan(100);
    // время по порядку, предзапись — до нуля (старт записи по ARM)
    for (let i = 1; i < g.count; i++) expect(g.t[i]).toBeGreaterThanOrEqual(g.t[i - 1]);
    expect(g.t[0]).toBeLessThan(-1.5);
    expect(f.events.some((e) => e.kind === "arm")).toBe(true);
    expect(f.events.find((e) => e.text.startsWith("запись: старт"))?.t).toBeCloseTo(0, 3);
    // моторы — доля хода, батарея — вольты
    const m = f.series.QCTRL.cols.motor1;
    expect(Math.max(...m)).toBeGreaterThan(0.05);
    expect(Math.max(...m)).toBeLessThanOrEqual(1);
    expect(valueAt(f.series.QSTATE, "vbat_v", 0.5)).toBeGreaterThan(20);
  });

  it("поля схемы со смещениями и делителями", () => {
    const fields = parseFields("t_us:I gx:h/10 az:h/1000 mode:B lat:i/10000000");
    expect(fields.map((x) => [x.name, x.offset, x.div])).toEqual([
      ["t_us", 0, 1],
      ["gx", 4, 10],
      ["az", 6, 1000],
      ["mode", 8, 1],
      ["lat", 9, 10000000],
    ]);
  });

  it("сводка, режимы и спектр", () => {
    const f = decodeFlight(bytes);
    const s = summarize(f);
    expect(s.gyroHz).toBeGreaterThan(990);
    expect(s.gyroHz).toBeLessThan(1010);
    expect(s.armedTime).toBeGreaterThan(0.5);
    const spans = modeSpans(f);
    expect(spans.some((x) => x.armed && x.label === "ALT_HOLD")).toBe(true);
    const g = f.series.QGYRO;
    const sp = spectrum(g.cols.gyro_roll, 0, g.count, s.gyroHz!);
    expect(sp).not.toBeNull();
    expect(sp!.freq[sp!.freq.length - 1]).toBeLessThan(s.gyroHz! / 2 + 1);
    expect(sp!.segments).toBeGreaterThan(2);
    // фильтры гироскопа: на верхней трети спектра после фильтров тише, чем до
    const top = Math.floor(sp!.freq.length * 0.66);
    const spf = spectrum(g.cols.gyrof_roll, 0, g.count, s.gyroHz!)!;
    const mean = (a: Float32Array) => a.slice(top).reduce((x, y) => x + y, 0) / (a.length - top);
    expect(mean(spf.db)).toBeLessThan(mean(sp!.db));
    expect(meanRotation(f, 0, 2)).toBeGreaterThan(50);
  });

  it("кольцо с карты: полёты по заголовкам секторов", () => {
    // служебный сектор + сам полёт + стёртое
    const ring = new Uint8Array(SECTOR * (1 + 60 + 10)).fill(0xff);
    ring.set(bytes, SECTOR);
    const flights = ringFlights(ring);
    expect(flights.length).toBe(1);
    expect(flights[0].number).toBe(1);
    expect(flights[0].sectors.length).toBe(60);
    const one = extractFlight(ring, flights[0]);
    expect(readHeader(one, 0)?.flight).toBe(1);
    expect(decodeFlight(one).series.QGYRO.count).toBe(decodeFlight(bytes).series.QGYRO.count);
  });
});
