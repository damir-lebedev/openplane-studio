// Поле и запретные зоны геозабора (P44 б) — прошивка copter/GeoZones.h:
// FIELD — летать только внутри, NOFLY — запретная зона внутри поля. Плата
// присылает "@fence {zone, type, pts: [[latE7, lonE7]…], problem}" на каждую
// из 8 зон (в потоке params и в ответ на geozone …); пишем строками CLI
// "geozone …". Геометрия — как в прошивке: метры от первой точки (плоская
// Земля до 20 км), «стороны пересекаются», ближайшая сторона, радар.

import { N_ } from "../i18n";

export type FenceZoneType = "NONE" | "FIELD" | "NOFLY";

export interface FenceZone {
  zone: number;
  type: FenceZoneType;
  /** точки, 1e-7 градуса: [широта, долгота] */
  pts: [number, number][];
  /** почему прошивка зону не применяет (null — годится) */
  problem: string | null;
}

export const FENCE_ZONES = 8;
export const FENCE_POINTS = 16;
const R_EARTH = 6371000;
const MAX_SIZE_M = 20000;

/** Точка в градусах: [широта, долгота]. */
export type LatLon = [number, number];

export const e7ToDeg = (p: [number, number]): LatLon => [p[0] / 1e7, p[1] / 1e7];
export const degToE7 = (p: LatLon): [number, number] => [Math.round(p[0] * 1e7), Math.round(p[1] * 1e7)];
/** 7 знаков после точки — как в diff прошивки (1 см). */
export const fmtDeg = (d: number) => d.toFixed(7);

/** Смещение b от a, м: [на север, на восток] — как GeoZoneTable::offsetM. */
export function offsetM(a: LatLon, b: LatLon): [number, number] {
  const k = (Math.PI / 180) * R_EARTH;
  return [(b[0] - a[0]) * k, (b[1] - a[1]) * k * Math.cos((a[0] * Math.PI) / 180)];
}

/** Обратно: точка в n м к северу и e м к востоку от a. */
export function fromOffset(a: LatLon, n: number, e: number): LatLon {
  const k = (Math.PI / 180) * R_EARTH;
  return [a[0] + n / k, a[1] + e / (k * Math.cos((a[0] * Math.PI) / 180))];
}

function cross(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
  return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
}

function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const d1 = cross(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = cross(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = cross(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = cross(a[0], a[1], b[0], b[1], d[0], d[1]);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/** Почему зона не годится (те же правила, что problem() в прошивке); null — годится. */
export function zoneProblem(pts: LatLon[]): string | null {
  if (pts.length < 3) return N_("меньше 3 точек");
  if (pts.length > FENCE_POINTS) return N_("больше 16 точек");
  const m = pts.map((p) => offsetM(pts[0], p));
  if (m.some(([n, e]) => Math.abs(n) > MAX_SIZE_M || Math.abs(e) > MAX_SIZE_M)) return N_("точки дальше 20 км друг от друга");
  const k = m.length;
  for (let a = 0; a < k; a++) {
    const a2 = (a + 1) % k;
    for (let b = a + 1; b < k; b++) {
      const b2 = (b + 1) % k;
      if (b === a2 || b2 === a) continue;
      if (segmentsCross(m[a], m[a2], m[b], m[b2])) return N_("стороны пересекаются");
    }
  }
  return null;
}

/** Площадь, м² (по модулю), — для подписи «поле 2.4 га». */
export function zoneAreaM2(pts: LatLon[]): number {
  if (pts.length < 3) return 0;
  const m = pts.map((p) => offsetM(pts[0], p));
  let s = 0;
  for (let i = 0, j = m.length - 1; i < m.length; j = i++) s += m[j][1] * m[i][0] - m[i][1] * m[j][0];
  return Math.abs(s) / 2;
}

/**
 * Координаты из буфера: по точке на строку или через «;» — «56.3268710, 44.0059870»
 * (Яндекс и Google Карты копируют так), «56.32687 44.00599»; KML «долгота,широта,высота»
 * — с меткой kml. Ошибка — номер строки.
 */
export function parseCoordList(text: string): { pts: LatLon[]; error: string | null; line?: number } {
  const pts: LatLon[] = [];
  const kml = /<coordinates>/i.test(text);
  const body = kml ? (text.match(/<coordinates>([\s\S]*?)<\/coordinates>/i)?.[1] ?? "") : text;
  const items = kml ? body.trim().split(/\s+/) : body.split(/[\n;]+/);
  let line = 0;
  for (const raw of items) {
    line++;
    const s = raw.trim();
    if (!s) continue;
    const nums = s.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (nums.length < 2) return { pts, error: N_("не понял строку — нужно «широта, долгота»"), line };
    const p: LatLon = kml ? [nums[1], nums[0]] : [nums[0], nums[1]];
    if (Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return { pts, error: N_("широта −90…90, долгота −180…180"), line };
    pts.push(p);
  }
  // KML и карты замыкают кольцо — последняя точка = первая
  if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  if (pts.length > FENCE_POINTS) return { pts, error: N_("больше 16 точек — уберите лишние") };
  return { pts, error: null };
}

/** Строки CLI: зона целиком заново (старые точки стираются). */
export function zoneCommands(zone: number, type: Exclude<FenceZoneType, "NONE">, pts: LatLon[]): string[] {
  return [`geozone ${zone} clear`, `geozone ${zone} ${type}`, ...pts.map((p, i) => `geozone ${zone} ${i} ${fmtDeg(p[0])} ${fmtDeg(p[1])}`)];
}

export const clearZoneCommand = (zone: number) => `geozone ${zone} clear`;

/** Свободный номер зоны; −1 — все 8 заняты. */
export function freeZone(zones: FenceZone[]): number {
  for (let i = 0; i < FENCE_ZONES; i++) if (!zones.some((z) => z.zone === i && z.type !== "NONE")) return i;
  return -1;
}

/** Ответ "@fence" → таблица зон платы (без мутаций). */
export function applyFence(zones: FenceZone[], z: FenceZone): FenceZone[] {
  const rest = zones.filter((x) => x.zone !== z.zone);
  return (z.type === "NONE" && z.pts.length === 0 ? rest : [...rest, z]).sort((a, b) => a.zone - b.zone);
}

export interface Nearest {
  inside: boolean;
  dist: number;
  /** единичный вектор к ближайшей точке стороны: [север, восток] */
  toward: [number, number];
}

/** Ближайшая сторона многоугольника (метры) — как polygonNearest в прошивке. */
export function polygonNearest(poly: [number, number][], p: [number, number]): Nearest {
  let inside = false;
  let best = Infinity;
  let bn = p[0];
  let be = p[1];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ni, ei] = poly[i];
    const [nj, ej] = poly[j];
    if (ni > p[0] !== nj > p[0] && p[1] < ((ej - ei) * (p[0] - ni)) / (nj - ni) + ei) inside = !inside;
    const sn = ni - nj;
    const se = ei - ej;
    const len2 = sn * sn + se * se;
    const t = Math.max(0, Math.min(1, len2 > 1e-6 ? ((p[0] - nj) * sn + (p[1] - ej) * se) / len2 : 0));
    const qn = nj + t * sn;
    const qe = ej + t * se;
    const d = Math.hypot(qn - p[0], qe - p[1]);
    if (d < best) {
      best = d;
      bn = qn;
      be = qe;
    }
  }
  return { inside, dist: best, toward: best > 1e-3 ? [(bn - p[0]) / best, (be - p[1]) / best] : [0, 0] };
}

/**
 * Запас до края для точки p (градусы): поле — внутри +, снаружи −;
 * запретная зона — наоборот; итог — наименьший (как Geofence::updatePosition).
 * null — годных зон нет.
 */
export function zonesMargin(zones: { type: FenceZoneType; pts: LatLon[] }[], p: LatLon): number | null {
  const ok = zones.filter((z) => z.type !== "NONE" && !zoneProblem(z.pts));
  if (!ok.length) return null;
  const ref = ok[0].pts[0];
  const pm = offsetM(ref, p);
  let field = -Infinity;
  let anyField = false;
  let best = Infinity;
  for (const z of ok) {
    const r = polygonNearest(z.pts.map((q) => offsetM(ref, q)), pm);
    if (z.type === "FIELD") {
      anyField = true;
      field = Math.max(field, r.inside ? r.dist : -r.dist);
    } else best = Math.min(best, r.inside ? -r.dist : r.dist);
  }
  return anyField ? Math.min(field, best) : best;
}

/** Расстояние от точки до отрезка (для радара). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const sx = bx - ax;
  const sy = by - ay;
  const len2 = sx * sx + sy * sy;
  const t = Math.max(0, Math.min(1, len2 > 1e-6 ? ((px - ax) * sx + (py - ay) * sy) / len2 : 0));
  return Math.hypot(ax + t * sx - px, ay + t * sy - py);
}

const FENCE_MAP_COLS = 9;
const FENCE_MAP_ROWS = 5;
const FENCE_MAP_SPAN = 3.5;
const CELL_ASPECT = 1.5;

/**
 * Радар со сторонами поля, как в очках (Osd.h, drawFenceMap): коптер в
 * середине носом вверх, edges — [вперёд1, вправо1, вперёд2, вправо2] м от
 * коптера, scale — столько метров на FENCE_MAP_SPAN знаков.
 */
export function fenceMapEdges(scale: number, edges: [number, number, number, number][]): string[] {
  const cell = Math.max(1, scale) / FENCE_MAP_SPAN;
  const cc = Math.floor(FENCE_MAP_COLS / 2);
  const cr = Math.floor(FENCE_MAP_ROWS / 2);
  const rows: string[] = [];
  for (let r = 0; r < FENCE_MAP_ROWS; r++) {
    let row = "";
    for (let c = 0; c < FENCE_MAP_COLS; c++) {
      const right = (c - cc) * cell;
      const fwd = ((cr - r) * cell * CELL_ASPECT) / CELL_ASPECT;
      const hit = edges.some((e) => segDist(right, fwd, e[1], e[0] / CELL_ASPECT, e[3], e[2] / CELL_ASPECT) <= 0.55 * cell);
      row += r === cr && c === cc ? "^" : hit ? "." : " ";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Стороны зон в осях носа от коптера в p (градусы), нос — hdg (градусы от
 * севера), и масштаб радара (дальняя точка), — для fenceMapEdges.
 */
export function radarEdges(zones: { pts: LatLon[] }[], p: LatLon, hdg: number): { edges: [number, number, number, number][]; scale: number } {
  const edges: [number, number, number, number][] = [];
  let scale = 0;
  const h = (hdg * Math.PI) / 180;
  const ch = Math.cos(h);
  const sh = Math.sin(h);
  const rot = ([n, e]: [number, number]): [number, number] => [n * ch + e * sh, -n * sh + e * ch];
  for (const z of zones) {
    const m = z.pts.map((q) => offsetM(p, q));
    m.forEach(([n, e]) => (scale = Math.max(scale, Math.hypot(n, e))));
    for (let i = 0; i < m.length; i++) {
      const a = rot(m[i]);
      const b = rot(m[(i + 1) % m.length]);
      edges.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return { edges, scale };
}
