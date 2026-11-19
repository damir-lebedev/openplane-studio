import { describe, expect, it } from "vitest";
import { escRows, escTotalAmps, escTrouble } from "./escTelemetry";

describe("EDT регуляторов (091)", () => {
  it("строки по моторам: null — не приходило, флаги статуса и стресс", () => {
    const rows = escRows([
      [45, 16.5, 12, 0x03],
      [null, 16.4, null, null],
      [101, 16.5, 14, 0x40 | 9],
      [50, 15.6, 13, 0x80 | 0x20],
    ]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ tempC: 45, volts: 16.5, amps: 12, stress: 3, alert: false, hot: false, sag: false });
    expect(rows[1]).toMatchObject({ tempC: null, amps: null, stress: null, warning: false });
    expect(rows[2]).toMatchObject({ hot: true, warning: true, stress: 9 });
    expect(rows[3]).toMatchObject({ alert: true, error: true, sag: true });   // на 0.8 В ниже остальных
    expect(escTrouble(rows)).toBe(true);
    expect(escTotalAmps(rows)).toBeNull();   // у M2 тока нет
    expect(escTotalAmps(rows.filter((r) => r.amps !== null))).toBe(39);
  });

  it("всё спокойно и пустой кадр", () => {
    const rows = escRows([[40, 16.8, 5, 0], [41, 16.7, 5, 0], [39, 16.8, 6, 1]]);
    expect(escTrouble(rows)).toBe(false);
    expect(escTotalAmps(rows)).toBe(16);
    expect(escRows(undefined)).toEqual([]);
    expect(escTotalAmps([])).toBeNull();
  });
});
