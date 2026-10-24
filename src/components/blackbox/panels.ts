// Какие графики есть: ряд журнала, поле, цвет. Коптер — как разбирают
// настройку в Betaflight (уставка против гироскопа, P/I/D/F, моторы), самолёт —
// углы и цели, выходы, высота; любой другой канал — «свой график».

import { Flight } from "../../core/blackbox";
import { N_ } from "../../i18n";

export interface Trace {
  series: string;
  field: string;
  label: string;
  color: string;
  scale?: number;
  width?: number;
  alpha?: number;
  dash?: number[];
}

export interface PanelDef {
  id: string;
  title: string;
  unit: string;
  traces: Trace[];
  range?: [number, number];
  symmetric?: boolean;
  height?: number;
  /** заголовок с переключателем оси (PID) */
  axisTabs?: boolean;
}

export const COLORS = {
  setpoint: "#e7eef6",
  gyro: "#39d0ff",
  raw: "#6f8296",
  p: "#4ea8ff",
  i: "#e3b341",
  d: "#d2a8ff",
  f: "#3fb950",
  motors: ["#ff7b72", "#ffa657", "#3fb950", "#39d0ff", "#d2a8ff", "#f778ba", "#e3b341", "#a5d6ff"],
  throttle: "#e3b341",
  alt: "#79c0ff",
  volts: "#3fb950",
  amps: "#ff7b72",
};

export const MODE_COLORS: Record<string, string> = {
  ACRO: "#f85149",
  HORIZON: "#d2a8ff",
  ANGLE: "#3fb950",
  ALT_HOLD: "#39d0ff",
  MANUAL: "#f85149",
  STABILIZE: "#3fb950",
  CRUISE: "#39d0ff",
  RTH: "#e3b341",
};

export const AXES = [N_("Крен"), N_("Тангаж"), N_("Рысканье")];
const AX = ["roll", "pitch", "yaw"];

function ratePanel(a: number): PanelDef {
  return {
    id: `rate${a}`,
    title: AXES[a],
    unit: N_("°/с"),
    symmetric: true,
    traces: [
      { series: "QGYRO", field: `gyro_${AX[a]}`, label: N_("до фильтров"), color: COLORS.raw, alpha: 0.55, width: 1 },
      { series: "QGYRO", field: `gyrof_${AX[a]}`, label: N_("гироскоп"), color: COLORS.gyro, width: 1.5 },
      { series: "QGYRO", field: `sp_${AX[a]}`, label: N_("уставка"), color: COLORS.setpoint, width: 1.4 },
    ],
  };
}

export function pidPanel(axis: number): PanelDef {
  const ax = AX[axis];
  return {
    id: "pid",
    title: N_("PID"),
    unit: "%",
    symmetric: true,
    axisTabs: true,
    traces: [
      { series: "QCTRL", field: `p_${ax}`, label: "P", color: COLORS.p, scale: 100, width: 1.3 },
      { series: "QCTRL", field: `i_${ax}`, label: "I", color: COLORS.i, scale: 100, width: 1.6 },
      { series: "QCTRL", field: `d_${ax}`, label: "D", color: COLORS.d, scale: 100, width: 1.1, alpha: 0.85 },
      { series: "QCTRL", field: `f_${ax}`, label: "F", color: COLORS.f, scale: 100, width: 1.3 },
    ],
  };
}

function motorsPanel(flight: Flight | null): PanelDef {
  const count = Number(flight?.info.motors ?? 4) || 4;
  const traces: Trace[] = [];
  for (let m = 1; m <= Math.min(8, count); m++) {
    traces.push({ series: m <= 4 ? "QCTRL" : "QMOT8", field: `motor${m}`, label: `M${m}`, color: COLORS.motors[m - 1], scale: 100, width: 1.2 });
  }
  return { id: "motors", title: N_("Моторы"), unit: "%", range: [0, 100], traces };
}

export const COPTER_PANELS = (flight: Flight | null, axis: number): PanelDef[] => [
  ratePanel(0),
  ratePanel(1),
  ratePanel(2),
  pidPanel(axis),
  motorsPanel(flight),
  {
    id: "throttle",
    title: N_("Газ"),
    unit: "%",
    range: [0, 100],
    traces: [
      { series: "QSTATE", field: "rc_throttle", label: N_("стик"), color: COLORS.raw, scale: 100, width: 1.2 },
      { series: "QCTRL", field: "thrust", label: N_("смеситель"), color: COLORS.throttle, scale: 100, width: 1.5 },
      { series: "QSTATE", field: "hover", label: N_("висение"), color: COLORS.setpoint, scale: 100, width: 1, dash: [4, 4] },
    ],
  },
  {
    id: "altitude",
    title: N_("Высота"),
    unit: N_("м"),
    traces: [
      { series: "QSTATE", field: "alt_target_m", label: N_("цель"), color: COLORS.setpoint, width: 1, dash: [4, 4] },
      { series: "QSTATE", field: "alt_m", label: N_("высота"), color: COLORS.alt, width: 1.6 },
    ],
  },
  {
    id: "attitude",
    title: N_("Углы"),
    unit: "°",
    symmetric: true,
    traces: [
      { series: "QSTATE", field: "roll", label: N_("крен"), color: COLORS.motors[0], width: 1.4 },
      { series: "QSTATE", field: "pitch", label: N_("тангаж"), color: COLORS.motors[3], width: 1.4 },
    ],
  },
  {
    id: "sticks",
    title: N_("Стики"),
    unit: "%",
    range: [-100, 100],
    traces: [
      { series: "QSTATE", field: "rc_roll", label: N_("крен"), color: COLORS.motors[0], scale: 100, width: 1.3 },
      { series: "QSTATE", field: "rc_pitch", label: N_("тангаж"), color: COLORS.motors[3], scale: 100, width: 1.3 },
      { series: "QSTATE", field: "rc_yaw", label: N_("рысканье"), color: COLORS.motors[4], scale: 100, width: 1.3 },
    ],
  },
  {
    id: "battery",
    title: N_("Батарея"),
    unit: N_("В"),
    traces: [{ series: "QSTATE", field: "vbat_v", label: N_("напряжение"), color: COLORS.volts, width: 1.6 }],
  },
  {
    id: "current",
    title: N_("Ток"),
    unit: N_("А"),
    traces: [{ series: "QSTATE", field: "amps", label: N_("ток"), color: COLORS.amps, width: 1.4 }],
  },
  {
    id: "loop",
    title: N_("Время цикла"),
    unit: N_("мкс"),
    traces: [{ series: "QGYRO", field: "work_us", label: N_("работа такта"), color: COLORS.raw, width: 1 }],
  },
];

export const PLANE_PANELS: PanelDef[] = [
  {
    id: "p_roll",
    title: N_("Крен"),
    unit: "°",
    symmetric: true,
    traces: [
      { series: "CTRL", field: "want_roll", label: N_("цель"), color: COLORS.setpoint, width: 1.2, dash: [4, 3] },
      { series: "CTRL", field: "roll", label: N_("крен"), color: COLORS.gyro, width: 1.6 },
    ],
  },
  {
    id: "p_pitch",
    title: N_("Тангаж"),
    unit: "°",
    symmetric: true,
    traces: [
      { series: "CTRL", field: "want_pitch", label: N_("цель"), color: COLORS.setpoint, width: 1.2, dash: [4, 3] },
      { series: "CTRL", field: "pitch", label: N_("тангаж"), color: COLORS.gyro, width: 1.6 },
    ],
  },
  {
    id: "p_gyro",
    title: N_("Гироскоп"),
    unit: N_("°/с"),
    symmetric: true,
    traces: [
      { series: "IMU", field: "gx", label: "X", color: COLORS.motors[0], width: 1 },
      { series: "IMU", field: "gy", label: "Y", color: COLORS.motors[2], width: 1 },
      { series: "IMU", field: "gz", label: "Z", color: COLORS.motors[3], width: 1 },
    ],
  },
  {
    id: "p_out",
    title: N_("Выходы"),
    unit: N_("мкс"),
    traces: ["ail_l", "ail_r", "ele", "rud", "esc"].map((f, k) => ({ series: "CTRL", field: f, label: f, color: COLORS.motors[k], width: 1.2 })),
  },
  {
    id: "p_alt",
    title: N_("Высота"),
    unit: N_("м"),
    traces: [
      { series: "BARO", field: "target_alt_m", label: N_("цель"), color: COLORS.setpoint, width: 1, dash: [4, 4] },
      { series: "BARO", field: "alt_m", label: N_("высота"), color: COLORS.alt, width: 1.6 },
    ],
  },
  {
    id: "p_air",
    title: N_("Скорость"),
    unit: N_("м/с"),
    traces: [
      { series: "AIR", field: "ias_ms", label: N_("приборная"), color: COLORS.gyro, width: 1.5 },
      { series: "GPS", field: "speed_ms", label: "GPS", color: COLORS.throttle, width: 1.2 },
    ],
  },
];

export const COPTER_DEFAULT = ["rate0", "rate1", "rate2", "pid", "motors", "throttle", "altitude", "battery"];
export const PLANE_DEFAULT = ["p_roll", "p_pitch", "p_gyro", "p_out", "p_alt", "p_air"];

/** Свой график по любому полю: id "custom:<ряд>.<поле>". */
export function customPanel(id: string): PanelDef | null {
  const m = /^custom:([^.]+)\.(.+)$/.exec(id);
  if (!m) return null;
  return { id, title: `${m[1]}.${m[2]}`, unit: "", traces: [{ series: m[1], field: m[2], label: m[2], color: COLORS.gyro, width: 1.4 }] };
}

export function availableTraces(p: PanelDef, flight: Flight): Trace[] {
  return p.traces.filter((tr) => flight.series[tr.series]?.cols[tr.field] && flight.series[tr.series].count > 0);
}
