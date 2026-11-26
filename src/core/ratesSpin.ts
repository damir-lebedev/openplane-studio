// Вкладка «Расходы» (053): стики пульта или виртуальные → °/с по кривой
// платы, и поворот 3D-коптера на эти скорости. Мёртвая зона — как в BF 4.3+:
// отклонение за зоной растягивается обратно на весь ход (делитель 500 − deadband).

import { AXES, Axis, CopterBoard, num, rateCurve, rateSpec } from "./copterParams";

export type Sticks = Record<Axis, number>;

export const CENTER_STICKS: Sticks = { roll: 0, pitch: 0, yaw: 0 };

/** Отклонение канала, мкс → −1…1 с мёртвой зоной deadband (мкс у центра). */
export function stickFromUs(us: number | undefined, deadband = 0): number {
  if (us === undefined || !Number.isFinite(us)) return 0;
  const db = Math.max(0, Math.min(100, deadband));
  const d = Math.max(-500, Math.min(500, us - 1500));
  const a = Math.abs(d);
  if (a <= db) return 0;
  return (Math.sign(d) * (a - db)) / (500 - db);
}

/**
 * Стики из живого кадра по порядку map (A — крен, E — тангаж, R — рысканье).
 * Знак — как стик: вправо и от себя — плюс (тангаж от себя = нос вниз).
 */
export function liveSticks(ch: number[], map: string, deadband = 0, yawDeadband = 0): Sticks {
  const at = (letter: string, db: number) => {
    const i = map.indexOf(letter);
    return i < 0 ? 0 : stickFromUs(ch[i], db);
  };
  return { roll: at("A", deadband), pitch: at("E", deadband), yaw: at("R", yawDeadband) };
}

/** Мёртвые зоны с платы (deadband, yaw_deadband), мкс. */
export function deadbands(b: CopterBoard): [number, number] {
  return [num(b, "deadband"), num(b, "yaw_deadband")];
}

/** Скорость вращения по осям, °/с, для этих стиков по кривой платы. */
export function spinRates(b: CopterBoard, s: Sticks): Sticks {
  const out = { ...CENTER_STICKS };
  for (const a of AXES) out[a] = rateCurve(rateSpec(b, a), s[a]);
  return out;
}

/** За сколько секунд полный оборот при стике до упора (0 — ось не крутится). */
export function flipSeconds(b: CopterBoard, axis: Axis): number {
  const top = Math.abs(rateCurve(rateSpec(b, axis), 1));
  return top > 1 ? 360 / top : 0;
}

/**
 * Угловая скорость в осях three.js (x вправо, y вверх, нос — к −z), рад/с, для
 * скоростей стика: крен вправо — вокруг −z, нос вниз (стик от себя) — вокруг −x,
 * нос вправо — вокруг −y. Это вектор в осях самого коптера (поворот «от себя»).
 */
export function bodyOmega(rates: Sticks): [number, number, number] {
  const k = Math.PI / 180;
  return [-rates.pitch * k, -rates.yaw * k, -rates.roll * k];
}
