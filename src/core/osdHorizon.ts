// Искусственный горизонт OSD — та же математика, что в прошивке
// (copter/Osd.h, drawHorizon): линия в 9 знаков, у каждого знака одна из 9
// высот линии. Нос вверх — линия ниже, крен вправо — правый край выше.
// osd_ah_max_pit — тангаж, при котором линия уходит на 4 строки;
// osd_ah_max_rol — крен больше рисуется как этот; osd_ah_invert — наоборот.

export const AH_HALF = 4;
export const AH_ROWS = 4;
export const AH_LEVELS = 9;
export const AH_SIDEBAR_X = 7;
export const AH_SIDEBAR_H = 3;
const CELL_ASPECT = 1.5; // знак 12 × 18 точек

export interface HorizonCell {
  /** столбец от середины, −4…4 */
  dx: number;
  /** строка от середины, −4…4 */
  dy: number;
  /** высота линии в знаке: 0 — у верха, 8 — у низа */
  level: number;
}

export interface HorizonSettings {
  maxPitch: number;
  maxRoll: number;
  invert: boolean;
}

export const HORIZON_DEFAULTS: HorizonSettings = { maxPitch: 20, maxRoll: 40, invert: false };

/** lroundf из C: половины — от нуля. */
const lround = (v: number) => Math.sign(v) * Math.round(Math.abs(v));

export function horizonCells(rollDeg: number, pitchDeg: number, s: HorizonSettings = HORIZON_DEFAULTS): HorizonCell[] {
  const maxPit = s.maxPitch > 0 ? s.maxPitch : 1;
  const maxRol = Math.min(89, s.maxRoll);
  let pitch = Math.max(-maxPit, Math.min(maxPit, Number.isFinite(pitchDeg) ? pitchDeg : 0));
  let roll = Math.max(-maxRol, Math.min(maxRol, Number.isFinite(rollDeg) ? rollDeg : 0));
  if (s.invert) {
    pitch = -pitch;
    roll = -roll;
  }
  const shift = (pitch / maxPit) * AH_ROWS;
  const slope = Math.tan((roll * Math.PI) / 180) / CELL_ASPECT;
  const out: HorizonCell[] = [];
  for (let i = -AH_HALF; i <= AH_HALF; i++) {
    const sub = lround((shift - i * slope) * AH_LEVELS) + Math.floor(AH_LEVELS / 2);
    const r = Math.floor(sub / AH_LEVELS);
    if (r < -AH_ROWS || r > AH_ROWS) continue;
    out.push({ dx: i, dy: r, level: sub - r * AH_LEVELS });
  }
  return out;
}
