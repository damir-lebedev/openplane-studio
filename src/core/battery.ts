// Вкладка «Питание» (127): шкала напряжения банки с порогами тревог,
// расход ёмкости и что прошивка сделает по ходу разряда (copter/Battery.h).
// Только расчёт по настройкам платы и живому кадру — картинка в MiscTabs.

import type { CopterBoard } from "./copterParams";
import { num } from "./copterParams";

/** Умолчания BF для LiPo, если плата отдала 0 (старый дамп). */
const LIPO = { min: 3.3, warn: 3.5, full: 4.1, max: 4.3 };

export type CellZone = "critical" | "warning" | "ok" | "full";

export interface CellScale {
  /** пороги на банку, В */
  min: number;
  warn: number;
  full: number;
  max: number;
  /** края шкалы, В */
  lo: number;
  hi: number;
  /** зоны слева направо */
  zones: { from: number; to: number; zone: CellZone }[];
  /** банок: force_battery_cell_count → battery_cells → 0 (неизвестно) */
  cells: number;
  /** текущая банка (если батарея есть) и её место на шкале 0..1 */
  cell?: number;
  pos?: number;
  zone?: CellZone;
}

const cellParam = (b: CopterBoard, name: string, fallback: number) => {
  const v = num(b, name, 0) / 100;
  return v > 0.5 ? v : fallback;
};

/** В какой зоне банка (без гистерезиса и задержек — это видно на шкале). */
export function cellZone(s: Pick<CellScale, "min" | "warn" | "full">, cell: number): CellZone {
  if (cell < s.min) return "critical";
  if (cell < s.warn) return "warning";
  if (cell < s.full) return "ok";
  return "full";
}

export function cellScale(b: CopterBoard, cell?: number): CellScale {
  const min = cellParam(b, "vbat_min_cell_voltage", LIPO.min);
  const warn = Math.max(min, cellParam(b, "vbat_warning_cell_voltage", LIPO.warn));
  const max = Math.max(warn, cellParam(b, "vbat_max_cell_voltage", LIPO.max));
  const full = Math.min(max, Math.max(warn, cellParam(b, "vbat_full_cell_voltage", LIPO.full)));
  const lo = Math.floor((min - 0.3) * 10) / 10;
  const hi = Math.ceil((max + 0.05) * 10) / 10;
  const cells = num(b, "force_battery_cell_count", 0) || num(b, "battery_cells", 0);
  const zones = [
    { from: lo, to: min, zone: "critical" as const },
    { from: min, to: warn, zone: "warning" as const },
    { from: warn, to: full, zone: "ok" as const },
    { from: full, to: hi, zone: "full" as const },
  ].filter((z) => z.to > z.from);
  const s: CellScale = { min, warn, full, max, lo, hi, zones, cells };
  if (cell !== undefined && cell > 0.5) {
    s.cell = cell;
    s.pos = Math.min(1, Math.max(0, (cell - lo) / (hi - lo)));
    s.zone = cellZone(s, cell);
  }
  return s;
}

/** Место напряжения на шкале 0..1. */
export const scalePos = (s: Pick<CellScale, "lo" | "hi">, v: number) => Math.min(1, Math.max(0, (v - s.lo) / (s.hi - s.lo)));

export interface CapacityBar {
  /** ёмкость, мА·ч (bat_capacity → battery_mah) */
  capacity: number;
  used: number;
  /** осталось, 0..1 */
  left: number;
  /** тревога по расходу включена и где она (доля остатка) */
  alerts: boolean;
  alertAt: number;
  zone: "ok" | "warning" | "critical";
}

/** Расход ёмкости; null — ёмкость не задана или ток не измеряется. */
export function capacityBar(b: CopterBoard, mah?: number): CapacityBar | null {
  const capacity = num(b, "bat_capacity", 0) || num(b, "battery_mah", 0);
  if (capacity <= 0 || mah === undefined) return null;
  const used = Math.max(0, mah);
  const left = Math.max(0, 1 - used / capacity);
  const alerts = String(b.params.use_cbat_alerts?.value ?? "OFF").toUpperCase() === "ON";
  const alertAt = Math.min(100, Math.max(0, num(b, "cbat_alert_percent", 10))) / 100;
  const zone = !alerts ? "ok" : left <= 0 ? "critical" : left <= alertAt ? "warning" : "ok";
  return { capacity, used, left, alerts, alertAt, zone };
}

export interface BatteryStep {
  at: CellZone;
  /** порог на банку, В */
  volts: number;
  /** задержка до тревоги, с */
  delay: number;
}

/** Ход разряда: когда WARNING и CRITICAL и что после. */
export function batteryPlan(b: CopterBoard) {
  const s = cellScale(b);
  const alerts = String(b.params.use_vbat_alerts?.value ?? "ON").toUpperCase() !== "OFF";
  const cutoff = Math.min(100, Math.max(0, num(b, "vbat_cutoff_percent", 100)));
  const steps: BatteryStep[] = [
    { at: "warning", volts: s.warn, delay: num(b, "vbat_duration_for_warning", 20) / 10 },
    { at: "critical", volts: s.min, delay: num(b, "vbat_duration_for_critical", 20) / 10 },
  ];
  /** гистерезис на всю батарею, В */
  const hysteresis = num(b, "vbat_hysteresis", 1) / 100;
  return { alerts, steps, cutoff, hysteresis, cells: s.cells };
}
