// Плата на раме (прошивка copter/ImuAlign.h): поворот align_board_*, нуль
// акселерометра acc_calibration («x,y,z,флаг», 1/2048 g), калибровка гироскопа.
// Чистая логика для карточки «Плата на раме» во вкладке «Подготовка».

import type { CopterBoard } from "./copterParams";
import { num } from "./copterParams";

/** Настройки, которые рисует карточка «Плата на раме» (во «Прочем» их нет). */
export const BOARD_ALIGN_PARAMS = [
  "align_board_roll",
  "align_board_pitch",
  "align_board_yaw",
  "acc_calibration",
  "gyro_calib_duration",
  "gyro_calib_noise_limit",
  "gyro_offset_yaw",
  "imu_dcm_kp",
  "imu_dcm_ki",
] as const;

export interface AccZero {
  zero: [number, number, number];
  done: boolean;
}

/** acc_calibration как в прошивке (parseAccCalibration); пусто — нули; null — написано не так. */
export function parseAccCalibration(text: string | number | undefined | null): AccZero | null {
  const s = String(text ?? "").trim();
  if (!s) return { zero: [0, 0, 0], done: false };
  const parts = s.split(",").map((x) => x.trim());
  if (parts.length !== 4 || parts.some((x) => !/^-?\d+$/.test(x))) return null;
  const v = parts.map(Number);
  if (v.slice(0, 3).some((x) => x < -999 || x > 999) || (v[3] !== 0 && v[3] !== 1)) return null;
  return { zero: [v[0], v[1], v[2]], done: v[3] === 1 };
}

/** На сколько градусов нуль сдвигает горизонт (без него «верх» читался бы с наклоном). */
export function accZeroTiltDeg(z: AccZero): number {
  const [x, y, zz] = z.zero;
  return (Math.atan2(Math.hypot(x, y), 2048 + zz) * 180) / Math.PI;
}

/** gyro_calib_duration (×10 мс) → секунды; gyro_calib_noise_limit (LSB на ±2000 °/с) → °/с, 0 — не проверять. */
export function gyroCalibration(b: CopterBoard): { seconds: number; noiseDps: number | null } {
  const seconds = num(b, "gyro_calib_duration", 125) / 100;
  const limit = num(b, "gyro_calib_noise_limit", 48);
  return { seconds, noiseDps: limit > 0 ? limit / 16.4 : null };
}

/** Повёрнута ли плата настройками (360 — то же, что 0). */
export function boardRotated(b: CopterBoard): boolean {
  return ["align_board_roll", "align_board_pitch", "align_board_yaw"].some((n) => num(b, n) % 360 !== 0);
}

/** Запасной фильтр Махони включён — тогда видны imu_dcm_kp / imu_dcm_ki. */
export function mahonyActive(b: CopterBoard): boolean {
  return String(b.params.attitude_filter?.value ?? "EKF").toUpperCase() === "MAHONY";
}

/** Сопротивление винтов из живого кадра (kdrag: [1/с, ±%]) → текст; «—», пока не измерено. */
export function dragText(kdrag?: [number, number], unit = "1/с"): string {
  if (!kdrag || !(kdrag[0] > 0)) return "—";
  return `${kdrag[0].toFixed(3)} ${unit} ±${Math.round(kdrag[1])}%`;
}
