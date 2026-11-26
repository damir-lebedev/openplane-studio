import { describe, expect, it } from "vitest";

import { batteryPlan, capacityBar, cellScale, cellZone, scalePos } from "./battery";
import { CopterBoard, emptyBoard } from "./copterParams";

const board = (p: Record<string, number | string>): CopterBoard => {
  const b = emptyBoard();
  for (const [k, v] of Object.entries(p)) b.params[k] = { value: v } as CopterBoard["params"][string];
  return b;
};

describe("батарея: шкала банки", () => {
  it("пороги — из настроек платы (x0.01 В), зоны по порядку", () => {
    const s = cellScale(board({ vbat_min_cell_voltage: 340, vbat_warning_cell_voltage: 360, vbat_full_cell_voltage: 410, vbat_max_cell_voltage: 435, battery_cells: 6 }), 3.7);
    expect([s.min, s.warn, s.full, s.max]).toEqual([3.4, 3.6, 4.1, 4.35]);
    expect(s.zones.map((z) => z.zone)).toEqual(["critical", "warning", "ok", "full"]);
    expect(s.lo).toBeCloseTo(3.1);
    expect(s.hi).toBeCloseTo(4.4);
    expect(s.cells).toBe(6);
    expect(s.zone).toBe("ok");
    expect(s.pos).toBeCloseTo((3.7 - 3.1) / 1.3);
  });

  it("нули старого дампа — умолчания BF для LiPo; force_battery_cell_count главнее", () => {
    const s = cellScale(board({ vbat_min_cell_voltage: 0, force_battery_cell_count: 4, battery_cells: 6 }));
    expect([s.min, s.warn, s.full, s.max]).toEqual([3.3, 3.5, 4.1, 4.3]);
    expect(s.cells).toBe(4);
    expect(s.cell).toBeUndefined();
  });

  it("зона банки и место на шкале с упором в края", () => {
    const s = { min: 3.3, warn: 3.5, full: 4.1 };
    expect(cellZone(s, 3.29)).toBe("critical");
    expect(cellZone(s, 3.4)).toBe("warning");
    expect(cellZone(s, 3.9)).toBe("ok");
    expect(cellZone(s, 4.2)).toBe("full");
    expect(scalePos({ lo: 3, hi: 4.4 }, 2)).toBe(0);
    expect(scalePos({ lo: 3, hi: 4.4 }, 5)).toBe(1);
  });

  it("предупреждение ниже минимума не ломает шкалу", () => {
    const s = cellScale(board({ vbat_min_cell_voltage: 360, vbat_warning_cell_voltage: 340 }));
    expect(s.warn).toBe(3.6);
    expect(s.zones.map((z) => z.zone)).toEqual(["critical", "ok", "full"]);
  });
});

describe("батарея: расход и ход разряда", () => {
  it("ёмкость — bat_capacity, иначе из описания коптера", () => {
    expect(capacityBar(board({ battery_mah: 1500 }), 300)?.capacity).toBe(1500);
    expect(capacityBar(board({ bat_capacity: 5000, battery_mah: 1500 }), 1000)?.left).toBeCloseTo(0.8);
    expect(capacityBar(board({}), 300)).toBeNull();
    expect(capacityBar(board({ bat_capacity: 5000 }), undefined)).toBeNull();
  });

  it("тревога по расходу — только с use_cbat_alerts", () => {
    const b = { bat_capacity: 1000, cbat_alert_percent: 20 };
    expect(capacityBar(board(b), 850)?.zone).toBe("ok");
    expect(capacityBar(board({ ...b, use_cbat_alerts: "ON" }), 850)?.zone).toBe("warning");
    expect(capacityBar(board({ ...b, use_cbat_alerts: "ON" }), 1200)?.zone).toBe("critical");
    expect(capacityBar(board({ ...b, use_cbat_alerts: "ON" }), 1200)?.left).toBe(0);
  });

  it("задержки тревог в секундах, ограничение газа и гистерезис", () => {
    const p = batteryPlan(board({ vbat_duration_for_warning: 15, vbat_duration_for_critical: 0, vbat_cutoff_percent: 60, vbat_hysteresis: 5, use_vbat_alerts: "OFF" }));
    expect(p.steps.map((s) => s.delay)).toEqual([1.5, 0]);
    expect(p.cutoff).toBe(60);
    expect(p.hysteresis).toBeCloseTo(0.05);
    expect(p.alerts).toBe(false);
  });
});
