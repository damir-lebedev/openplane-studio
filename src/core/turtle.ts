// Turtle mode (FLIP OVER AFTER CRASH) — какие моторы крутятся от стика, как
// в прошивке (plane/include/copter/Turtle.h): крен — моторы этой стороны,
// тангаж от себя — передние, стик ближе 30° к диагонали — один угол,
// рысканье сильнее крена и тангажа — пара моторов одного вращения.
// Сила — стик за мёртвой зоной 15 % с экспо crashflip_expo; остальные
// моторы — crashflip_motor_percent от неё (0 — стоят).

import { FrameMotor } from "./copterParams";

export const TURTLE_DEADBAND = 0.15;
/** Мотор стоит. */
export const TURTLE_STOP = -1;

/** Стики −1…1 (крен + вправо, тангаж + на себя, рысканье + нос вправо) → сила мотора 0…1 или TURTLE_STOP. */
export function turtleMix(motors: FrameMotor[], roll: number, pitch: number, yaw: number, expo = 0.35, other = 0): number[] {
  const ar = Math.abs(roll);
  const ap = Math.abs(pitch);
  const ay = Math.abs(yaw);
  let sr = Math.sign(roll);
  let sp = -Math.sign(pitch); // от себя — вперёд
  let sy = 0;
  let length = Math.hypot(ar, ap);
  if (ay > Math.max(ar, ap)) {
    sr = sp = 0;
    sy = Math.sign(yaw);
    length = ay;
  } else if (length > 0 && (ar + ap) / (Math.SQRT2 * length) < Math.cos(Math.PI / 6)) {
    if (ar > ap) sp = 0;
    else sr = 0;
  }
  const x = Math.max(0, (Math.min(1, length) - TURTLE_DEADBAND) / (1 - TURTLE_DEADBAND));
  const power = (1 - expo) * x + expo * x * x * x;
  // рысканье: в прошивке mix.yaw = +1 у мотора «против часовой»
  const drive = motors.map(([mx, my, spin]) => sr * my + sp * mx - sy * (spin === "ccw" ? 1 : -1));
  const most = Math.max(0, ...drive);
  return drive.map((d) => {
    const c = most > 0 && d > 0 ? (power * d) / most : power * other;
    return power <= 0 || c <= 0 ? TURTLE_STOP : Math.min(1, c);
  });
}

/** Стики из сырых каналов @live (мкс) по порядку map (A — крен, E — тангаж, R — рысканье). */
export function sticksFromChannels(ch: number[], map: string): { roll: number; pitch: number; yaw: number } {
  const stick = (letter: string) => {
    const us = ch[map.indexOf(letter)];
    return us === undefined ? 0 : Math.max(-1, Math.min(1, (us - 1500) / 500));
  };
  return { roll: stick("A"), pitch: -stick("E"), yaw: stick("R") };
}
