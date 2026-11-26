// «Настройка» (072): живой 3D-коптер. Углы платы (крен вправо +, тангаж нос
// вверх +, курс по часовой +, градусы) → поворот сцены three.js, где нос
// смотрит к −z, право — +x, верх — +y. Порядок «YXZ»: курс, тангаж, крен —
// как у самолёта (сначала развернулись, потом подняли нос, потом накренились).

export type Euler3 = [number, number, number];

const RAD = Math.PI / 180;

/** Курс относительно «нос от себя» (yaw0), в −180…180. */
export function relYaw(yaw: number, yaw0: number): number {
  let d = (yaw - yaw0) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** [x, y, z] радианы для Euler(…, "YXZ"): тангаж — вокруг x, курс — вокруг −y, крен — вокруг −z. */
export function sceneEuler(roll: number, pitch: number, yaw: number): Euler3 {
  return [pitch * RAD, -yaw * RAD, -roll * RAD];
}

/** Плата на раме (align_board_*): те же знаки, что у картинок «сверху/сбоку». */
export function boardEuler(roll: number, pitch: number, yaw: number): Euler3 {
  return sceneEuler(roll, pitch, yaw);
}

/** Свечение диска винта по команде мотора 0…1 (−1 — turtle, тоже крутится). */
export function discGlow(cmd: number | undefined): number {
  if (cmd === undefined || !Number.isFinite(cmd)) return 0;
  return Math.min(1, Math.abs(cmd));
}
