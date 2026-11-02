// Пищалка коптера и команды стиками — данные для вкладок «Пищалка» и
// «Режимы», как в прошивке (plane/include/copter/Beeper.h, StickCommands.h).
// Условия — имена и номера Betaflight: бит в beeper_off_flags = номер − 1.
// Без React.

import { N_ } from "../i18n";

export type BeepKind = "event" | "alarm" | "never";

export interface BeeperCondition {
  name: string;
  /** номер BF (бит = n − 1) */
  n: number;
  kind: BeepKind;
  text: string;
}

export const BEEPER_CONDITIONS: BeeperCondition[] = [
  { name: "GYRO_CALIBRATED", n: 1, kind: "event", text: N_("гироскоп откалиброван (при включении и стиками)") },
  { name: "RX_LOST", n: 2, kind: "alarm", text: N_("нет связи с пультом (если она была) — пока не вернётся") },
  { name: "RX_LOST_LANDING", n: 3, kind: "alarm", text: N_("failsafe сажает коптер") },
  { name: "DISARMING", n: 4, kind: "event", text: N_("DISARM") },
  { name: "ARMING", n: 5, kind: "event", text: N_("ARM") },
  { name: "ARMING_GPS_FIX", n: 6, kind: "event", text: N_("ARM, GPS видит достаточно спутников") },
  { name: "BAT_CRIT_LOW", n: 7, kind: "alarm", text: N_("батарея почти пустая — часто") },
  { name: "BAT_LOW", n: 8, kind: "alarm", text: N_("батарея садится — раз в 2 с") },
  { name: "GPS_STATUS", n: 9, kind: "alarm", text: N_("режим GPS BEEP SATELLITE COUNT: число спутников писками") },
  { name: "RX_SET", n: 10, kind: "alarm", text: N_("режим BEEPER — «поиск модели» (не глушится)") },
  { name: "ACC_CALIBRATION", n: 11, kind: "event", text: N_("горизонт записан (стиками)") },
  { name: "ACC_CALIBRATION_FAIL", n: 12, kind: "event", text: N_("горизонт не записан — стоит слишком криво") },
  { name: "READY_BEEP", n: 13, kind: "event", text: N_("всё проверено — можно ARM") },
  { name: "MULTI_BEEPS", n: 14, kind: "event", text: N_("подтверждение команды стиками: профиль N — N писков") },
  { name: "DISARM_REPEAT", n: 15, kind: "alarm", text: N_("ARM стиками: стики держат в положении DISARM") },
  { name: "ARMED", n: 16, kind: "never", text: N_("у нас не бывает: моторы на холостых не стоят") },
  { name: "SYSTEM_INIT", n: 17, kind: "event", text: N_("плата включилась") },
  { name: "ON_USB", n: 18, kind: "alarm", text: N_("пищать и без батареи, от USB (выключено — на столе тихо)") },
  { name: "BLACKBOX_ERASE", n: 19, kind: "event", text: N_("чёрный ящик стёрт") },
  { name: "CRASH_FLIP", n: 20, kind: "alarm", text: N_("turtle mode: заармлен, моторы наоборот") },
  { name: "CAM_CONNECTION_OPEN", n: 21, kind: "never", text: N_("у нас не бывает: управления камерой нет") },
  { name: "CAM_CONNECTION_CLOSE", n: 22, kind: "never", text: N_("у нас не бывает: управления камерой нет") },
  { name: "RC_SMOOTHING_INIT_FAIL", n: 23, kind: "never", text: N_("у нас не бывает: сглаживание стиков не «запускается»") },
  { name: "ARMING_GPS_NO_FIX", n: 24, kind: "event", text: N_("ARM, а спутников GPS мало") },
];

/** Маяк моторами (DShot) — только эти два, как в BF. */
export const BEACON_CONDITIONS = ["RX_LOST", "RX_SET"];

export const bit = (n: number) => 2 ** (n - 1);

export function isOn(offMask: number, n: number): boolean {
  return Math.floor(offMask / bit(n)) % 2 === 0;
}

/** Новая маска «выключено» после галочки. */
export function toggled(offMask: number, n: number, on: boolean): number {
  const off = !isOn(offMask, n);
  if (on && off) return offMask - bit(n);
  if (!on && !off) return offMask + bit(n);
  return offMask;
}

// ---------------- команды стиками ----------------

/** Положение стика: −1 — низ/влево/на себя, 0 — центр, 1 — верх/вправо/от себя. */
export type StickPos = -1 | 0 | 1;

export interface StickCombo {
  /** газ, рыск, тангаж (1 — от себя), крен */
  sticks: [StickPos, StickPos, StickPos, StickPos];
  title: string;
  /** только в ANGLE/HORIZON или только в ACRO */
  when?: "level" | "acro";
}

export const STICK_COMBOS: StickCombo[] = [
  { sticks: [-1, -1, -1, 0], title: N_("Калибровка гироскопа") },
  { sticks: [1, -1, -1, 0], title: N_("Горизонт = как стоит сейчас") },
  { sticks: [-1, -1, 0, -1], title: N_("PID-профиль 1") },
  { sticks: [-1, -1, 1, 0], title: N_("PID-профиль 2") },
  { sticks: [-1, -1, 0, 1], title: N_("PID-профиль 3") },
  { sticks: [-1, -1, -1, 1], title: N_("Сохранить настройки") },
  { sticks: [1, 0, 1, 0], title: N_("Горизонт: нос ниже на 0.1°"), when: "level" },
  { sticks: [1, 0, 0, 1], title: N_("Горизонт: правее на 0.1°"), when: "level" },
  { sticks: [1, 0, 1, 0], title: N_("Профиль расходов 1"), when: "acro" },
  { sticks: [1, 0, -1, 0], title: N_("Профиль расходов 2"), when: "acro" },
];

/** ARM / DISARM стиками — когда ARM нет в таблице режимов. */
export const STICK_ARM: StickCombo[] = [
  { sticks: [-1, 1, 0, 0], title: N_("ARM (держать 0.5 с)") },
  { sticks: [-1, -1, 0, 0], title: N_("DISARM (на земле, 0.5 с)") },
];

/**
 * Две ручки пульта (Mode 2): левая — рыск (x) и газ (y), правая — крен (x) и
 * тангаж (y). Координаты −1…1, y вверх.
 */
export function gimbals(c: StickCombo): { left: [number, number]; right: [number, number] } {
  const [thr, yaw, pit, rol] = c.sticks;
  return { left: [yaw, thr], right: [rol, pit] };
}
