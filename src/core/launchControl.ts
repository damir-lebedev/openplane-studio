// Launch control (037): гоночный старт — как прошивка (copter/LaunchControl.h)
// ведёт раму на земле до рывка газом. Здесь — то же для картинки во вкладке PID.

export const LAUNCH_MODES = ["NORMAL", "PITCHONLY", "FULL"] as const;
export type LaunchMode = (typeof LAUNCH_MODES)[number];

/** Настройки, которые показывает карточка (в общем списке PID их нет). */
export const LAUNCH_PARAMS = ["launch_control_mode", "launch_trigger_throttle_percent", "launch_angle_limit", "launch_control_gain", "launch_trigger_allow_reset"];

export const LAUNCH_MAX_RATE = 100; // °/с на половине хода стика
export const LAUNCH_MIN_RATE = 5; // у самого предела
export const LAUNCH_WINDOW = 10; // за столько градусов до предела — медленнее
export const LAUNCH_BACK_GAIN = 4; // за пределом: (°/с) назад на градус

/** Уставка тангажа, °/с (+ нос вверх), по стику −1…1 (+ на себя) и тангажу рамы (+ нос вверх). */
export function launchPitchRate(stick: number, pitchDeg: number, mode: LaunchMode, limitDeg: number): number {
  let sp = 2 * LAUNCH_MAX_RATE * Math.min(0.5, Math.max(-0.5, stick));
  if (mode === "PITCHONLY" && sp > 0) sp = 0;
  if (limitDeg > 0) {
    const left = limitDeg - -pitchDeg;
    if (left <= 0) sp = Math.max(sp, Math.min(LAUNCH_MAX_RATE, -left * LAUNCH_BACK_GAIN));
    else if (sp < 0 && left < LAUNCH_WINDOW) {
      const k = left / LAUNCH_WINDOW;
      sp = -(LAUNCH_MIN_RATE + k * (Math.max(-sp, LAUNCH_MIN_RATE) - LAUNCH_MIN_RATE));
    }
  }
  return sp;
}

/** Какие моторы работают, пока коптер ждёт рывка. */
export function launchMotors(mode: LaunchMode): { front: boolean; rear: boolean } {
  return { front: mode !== "PITCHONLY", rear: true };
}

/** Наклон рамы на картинке: предел, а без предела — пример 45°. */
export function launchPictureAngle(limitDeg: number): { deg: number; limited: boolean } {
  return limitDeg > 0 ? { deg: Math.min(80, limitDeg), limited: true } : { deg: 45, limited: false };
}
