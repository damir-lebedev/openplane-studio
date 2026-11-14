// Калибровка компаса коптера (прошивка copter/Compass.h): коптер крутят во
// все стороны, сырое поле датчика (кадр @live, "mag".raw, мкТл) ложится на
// эллипсоид. По точкам считаем его центр (mag_zero_* — железо рядом сдвигает
// поле) и полуоси (mag_scale_* — растяжение по осям); а по тому, как поле
// поворачивается вместе с рамой (углы из того же кадра), — как стоит датчик
// (align_mag): в правильной установке поле Земли в земных осях не меняется,
// как ни крути коптер.

import { N_ } from "../i18n";
import { ParamValue } from "./copterParams";

export type Vec3 = [number, number, number];

/** Отсчёт: сырое поле (мкТл, оси датчика) и углы коптера (крен, тангаж, рысканье, °). */
export interface MagSample {
  m: Vec3;
  att: Vec3;
}

export interface MagFit {
  /** центр, мкТл — mag_zero_* */
  zero: Vec3;
  /** множители по осям — mag_scale_* */
  scale: Vec3;
  /** модуль поля после калибровки, мкТл (Земля — 25…65) */
  field: number;
  /** разброс модуля после калибровки, доля поля (хорошо — меньше 0.05) */
  residual: number;
}

/** Порядок — как MagAlign в прошивке и align_mag в BF. */
export const MAG_ALIGNS = ["DEFAULT", "CW0", "CW90", "CW180", "CW270", "CW0FLIP", "CW90FLIP", "CW180FLIP", "CW270FLIP"] as const;
export type MagAlign = (typeof MAG_ALIGNS)[number];

/** Сколько точек и какая доля сферы нужны, чтобы считать. */
export const MAG_MIN_SAMPLES = 120;
export const MAG_MIN_COVERAGE = 0.55;
/** Точка ближе этого к уже взятой не нужна, мкТл. */
export const MAG_MIN_STEP = 2.5;
export const MAG_MAX_SAMPLES = 1500;

const SECTORS_Z = 6;
const SECTORS_AZ = 12;

/** Добавить отсчёт, если он не рядом с уже взятыми (коптер лежит — точки не копятся). */
export function addMagSample(list: MagSample[], s: MagSample): MagSample[] {
  if (list.length >= MAG_MAX_SAMPLES) return list;
  if (!s.m.every(Number.isFinite)) return list;
  // сравниваем с последними: соседние по времени — соседние и на сфере
  for (let i = list.length - 1; i >= 0 && i >= list.length - 40; --i) {
    const p = list[i].m;
    if (Math.hypot(p[0] - s.m[0], p[1] - s.m[1], p[2] - s.m[2]) < MAG_MIN_STEP) return list;
  }
  return [...list, s];
}

/** Середина между крайними значениями по осям — центр, пока точек мало для расчёта. */
export function roughCenter(samples: MagSample[]): Vec3 {
  if (!samples.length) return [0, 0, 0];
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of samples) {
    for (let i = 0; i < 3; ++i) {
      lo[i] = Math.min(lo[i], s.m[i]);
      hi[i] = Math.max(hi[i], s.m[i]);
    }
  }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
}

/** Доля сферы, на которой уже есть точки (72 равных по площади сектора), 0…1. */
export function magCoverage(samples: MagSample[], center: Vec3 = roughCenter(samples)): number {
  const seen = new Set<number>();
  for (const s of samples) {
    const x = s.m[0] - center[0];
    const y = s.m[1] - center[1];
    const z = s.m[2] - center[2];
    const r = Math.hypot(x, y, z);
    if (r < 1e-6) continue;
    const zi = Math.min(SECTORS_Z - 1, Math.floor(((z / r + 1) / 2) * SECTORS_Z));
    const ai = Math.min(SECTORS_AZ - 1, Math.floor(((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * SECTORS_AZ));
    seen.add(zi * SECTORS_AZ + ai);
  }
  return seen.size / (SECTORS_Z * SECTORS_AZ);
}

/** Решение A·x = b методом Гаусса с выбором главного элемента; null — вырождено. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; ++c) {
    let best = c;
    for (let r = c + 1; r < n; ++r) if (Math.abs(m[r][c]) > Math.abs(m[best][c])) best = r;
    if (Math.abs(m[best][c]) < 1e-12) return null;
    [m[c], m[best]] = [m[best], m[c]];
    for (let r = 0; r < n; ++r) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j <= n; ++j) m[r][j] -= k * m[c][j];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/**
 * Эллипсоид с осями вдоль осей датчика по точкам (наименьшие квадраты):
 * A·x² + B·y² + C·z² + D·x + E·y + F·z = 1. null — точек мало или они не
 * на эллипсоиде (коптер крутили в одной плоскости).
 */
export function fitMag(samples: MagSample[]): MagFit | null {
  if (samples.length < 20) return null;
  // к нулю и единичному размеру: иначе система плохо обусловлена
  const c0 = roughCenter(samples);
  let size = 0;
  for (const s of samples) size = Math.max(size, Math.hypot(s.m[0] - c0[0], s.m[1] - c0[1], s.m[2] - c0[2]));
  if (size < 1) return null;
  const ata = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
  const atb = new Array<number>(6).fill(0);
  for (const s of samples) {
    const x = (s.m[0] - c0[0]) / size;
    const y = (s.m[1] - c0[1]) / size;
    const z = (s.m[2] - c0[2]) / size;
    const row = [x * x, y * y, z * z, x, y, z];
    for (let i = 0; i < 6; ++i) {
      atb[i] += row[i];
      for (let j = 0; j < 6; ++j) ata[i][j] += row[i] * row[j];
    }
  }
  const q = solve(ata, atb);
  if (!q) return null;
  const [A, B, C, D, E, F] = q;
  if (!(A > 0 && B > 0 && C > 0)) return null;
  const center: Vec3 = [-D / (2 * A), -E / (2 * B), -F / (2 * C)];
  const g = 1 + (D * D) / (4 * A) + (E * E) / (4 * B) + (F * F) / (4 * C);
  if (!(g > 0)) return null;
  const radii: Vec3 = [Math.sqrt(g / A) * size, Math.sqrt(g / B) * size, Math.sqrt(g / C) * size];
  const field = Math.cbrt(radii[0] * radii[1] * radii[2]);
  const scale: Vec3 = [field / radii[0], field / radii[1], field / radii[2]];
  // растяжение больше чем вдвое — это не компас, а точки в одной плоскости
  if (scale.some((k) => k < 0.5 || k > 2)) return null;
  const zero: Vec3 = [center[0] * size + c0[0], center[1] * size + c0[1], center[2] * size + c0[2]];
  let sum = 0;
  for (const s of samples) {
    const len = Math.hypot(...applyMagFit(s.m, { zero, scale }));
    sum += (len - field) * (len - field);
  }
  return { zero, scale, field, residual: Math.sqrt(sum / samples.length) / field };
}

/** Поле после калибровки, мкТл (в осях датчика). */
export function applyMagFit(m: Vec3, fit: Pick<MagFit, "zero" | "scale">): Vec3 {
  return [(m[0] - fit.zero[0]) * fit.scale[0], (m[1] - fit.zero[1]) * fit.scale[1], (m[2] - fit.zero[2]) * fit.scale[2]];
}

/** Поле из осей датчика в оси рамы (X к носу, Y влево, Z вверх) — как alignMag в прошивке. */
export function alignMag(a: MagAlign, v: Vec3): Vec3 {
  let [x, y, z] = v;
  const i = Math.max(0, MAG_ALIGNS.indexOf(a) - 1);   // DEFAULT = CW0
  const flip = i >= 4;
  const turns = i % 4;
  if (flip) {
    x = -x;
    z = -z;
  }
  for (let k = 0; k < turns; ++k) [x, y] = [y, -x];
  return [x, y, z];
}

/** Вектор из осей рамы (X нос, Y влево, Z вверх) в земные (север', восток', вниз) по углам коптера. */
function toEarth(b: Vec3, att: Vec3): Vec3 {
  const d = Math.PI / 180;
  const [cr, sr] = [Math.cos(att[0] * d), Math.sin(att[0] * d)];
  const [cp, sp] = [Math.cos(att[1] * d), Math.sin(att[1] * d)];
  const [cy, sy] = [Math.cos(att[2] * d), Math.sin(att[2] * d)];
  // рама FRD: вперёд, вправо, вниз
  const [x, y, z] = [b[0], -b[1], -b[2]];
  // Rz(рысканье)·Ry(тангаж)·Rx(крен)
  const x1 = x;
  const y1 = cr * y - sr * z;
  const z1 = sr * y + cr * z;
  const x2 = cp * x1 + sp * z1;
  const z2 = -sp * x1 + cp * z1;
  return [cy * x2 - sy * y1, sy * x2 + cy * y1, z2];
}

export interface AlignGuess {
  align: MagAlign;
  /** разброс поля в земных осях, доля поля (хорошо — меньше 0.2) */
  spread: number;
  /** во сколько раз следующая по качеству установка хуже */
  margin: number;
  /** уверенно: разброс мал и вторая установка заметно хуже */
  sure: boolean;
}

/** Как стоит датчик: установка, при которой поле в земных осях меньше всего «гуляет». */
export function detectAlign(samples: MagSample[], fit: MagFit): AlignGuess | null {
  if (samples.length < 30) return null;
  const scored = MAG_ALIGNS.slice(1).map((align) => {
    const sum: Vec3 = [0, 0, 0];
    const sq: Vec3 = [0, 0, 0];
    for (const s of samples) {
      const e = toEarth(alignMag(align, applyMagFit(s.m, fit)), s.att);
      for (let i = 0; i < 3; ++i) {
        sum[i] += e[i];
        sq[i] += e[i] * e[i];
      }
    }
    const n = samples.length;
    const variance = sq.reduce((acc, v, i) => acc + v / n - (sum[i] / n) * (sum[i] / n), 0);
    return { align, spread: Math.sqrt(Math.max(0, variance)) / fit.field };
  });
  scored.sort((a, b) => a.spread - b.spread);
  const [best, second] = scored;
  const margin = second.spread / Math.max(1e-6, best.spread);
  return { ...best, margin, sure: best.spread < 0.25 && margin > 1.8 };
}

/** Оценка калибровки словами. */
export function magVerdict(fit: MagFit): { ok: boolean; text: string } {
  if (fit.field < 20 || fit.field > 70) return { ok: false, text: N_("Поле не похоже на земное: рядом магнит, железо или силовой провод. Отойдите от стола и повторите.") };
  if (fit.residual > 0.1) return { ok: false, text: N_("Точки лежат неровно: что-то магнитное двигалось рядом (или коптер крутили рядом с железом). Повторите подальше от металла.") };
  if (fit.residual > 0.05) return { ok: true, text: N_("Годится, но точки лежат не идеально — на улице, подальше от металла, выйдет точнее.") };
  return { ok: true, text: N_("Отлично: точки легли на сферу.") };
}

/** Команды записи калибровки (и установки, если она найдена). */
export function magCommands(fit: MagFit, align?: MagAlign): [string, ParamValue][] {
  const axes = ["x", "y", "z"];
  const cmds: [string, ParamValue][] = [];
  axes.forEach((a, i) => {
    // ровно ноль по всем осям прошивка считает «не откалиброван»
    let zero = Math.round(fit.zero[i] * 10);
    if (i === 2 && zero === 0 && Math.round(fit.zero[0] * 10) === 0 && Math.round(fit.zero[1] * 10) === 0) zero = 1;
    cmds.push([`mag_zero_${a}`, Math.max(-30000, Math.min(30000, zero))]);
  });
  axes.forEach((a, i) => cmds.push([`mag_scale_${a}`, Math.max(500, Math.min(2000, Math.round(fit.scale[i] * 1000)))]));
  if (align) cmds.push(["align_mag", align]);
  return cmds;
}

/** Точка на картинке сферы: поле от центра, в долях радиуса, повёрнутое на угол обзора. */
export function spherePoint(m: Vec3, center: Vec3, radius: number, viewDeg: number): { x: number; y: number; depth: number } {
  const r = radius > 1e-6 ? radius : 1;
  const x = (m[0] - center[0]) / r;
  const y = (m[1] - center[1]) / r;
  const z = (m[2] - center[2]) / r;
  const a = (viewDeg * Math.PI) / 180;
  // вокруг вертикали, затем наклон на зрителя 20°
  const xr = x * Math.cos(a) - y * Math.sin(a);
  const yr = x * Math.sin(a) + y * Math.cos(a);
  const tilt = (20 * Math.PI) / 180;
  return { x: xr, y: -(z * Math.cos(tilt) - yr * Math.sin(tilt)), depth: yr * Math.cos(tilt) + z * Math.sin(tilt) };
}
