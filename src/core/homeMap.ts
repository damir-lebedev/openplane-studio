// Карта «дом и путь» на вкладке GPS (137): вид сверху, дом в центре, путь
// коптера из живых кадров ("gps": n/e — метры от дома, как GpsHome::offsetFromHome),
// круг геозабора и зоны в метрах от дома. Путь копится, пока открыта вкладка;
// новый ARM — новый дом (GpsHome) — путь начинается заново.

import type { CopterLive } from "../api";
import { e7ToDeg, FenceZone, fromOffset, LatLon, offsetM } from "./geozones";

/** Точка пути: на север и на восток от дома, м; высота, м; когда, мс. */
export interface HomePoint {
  n: number;
  e: number;
  alt: number;
  t: number;
}

export interface HomeTrack {
  points: HomePoint[];
  /** где коптер сейчас (последний кадр с домом) */
  now: HomePoint;
  /** дом — широта/долгота (из lat/lon и смещения), для зон геозабора */
  home: LatLon;
  /** пройдено, м; дальше всего от дома, м; выше всего, м */
  pathM: number;
  maxDist: number;
  maxAlt: number;
  /** был ли заармлен в прошлом кадре — новый ARM начинает путь заново */
  armed: boolean;
}

/** Шаг точек пути, м (как след возврата RescueTrail::STEP_M), и сколько точек держать. */
export const HOME_STEP_M = 3;
export const HOME_KEEP = 2000;

/** Путь с новым кадром. Нет дома в кадре — путь прежний (видно, где летал). */
export function homeTrack(prev: HomeTrack | null, live: CopterLive | null): HomeTrack | null {
  if (!live) return prev;
  const g = live.gps;
  const armed = live.state !== "DISARMED";
  if (!g || g.n === undefined || g.e === undefined) return prev ? { ...prev, armed } : null;
  const now: HomePoint = { n: g.n, e: g.e, alt: live.alt, t: live.t };
  const home = fromOffset([g.lat, g.lon], -g.n, -g.e);
  const fresh = !prev || (armed && !prev.armed);
  if (fresh) return { points: [now], now, home, pathM: 0, maxDist: Math.hypot(now.n, now.e), maxAlt: Math.max(0, now.alt), armed };
  const last = prev.points[prev.points.length - 1];
  const step = Math.hypot(now.n - last.n, now.e - last.e);
  let points = prev.points;
  let pathM = prev.pathM;
  if (step >= HOME_STEP_M) {
    points = [...points, now];
    if (points.length > HOME_KEEP) points = points.slice(points.length - HOME_KEEP);
    pathM += step;
  }
  return {
    points,
    now,
    home: prev.home,
    pathM,
    maxDist: Math.max(prev.maxDist, Math.hypot(now.n, now.e)),
    maxAlt: Math.max(prev.maxAlt, now.alt),
    armed,
  };
}

/** Радиус карты, м: чтобы путь и забор помещались (10, 20, 50, 100, 200, 500…). */
export function homeMapScale(maxM: number): number {
  for (const r of [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) if (maxM <= r * 0.95) return r;
  return 10000;
}

/** Зоны геозабора — многоугольники в метрах от дома: [n, e][]. Пустые и с ошибкой — не рисуются. */
export function zonesFromHome(zones: FenceZone[], home: LatLon): { type: FenceZone["type"]; pts: [number, number][] }[] {
  return zones
    .filter((z) => z.type !== "NONE" && !z.problem && z.pts.length >= 3)
    .map((z) => ({ type: z.type, pts: z.pts.map((p) => offsetM(home, e7ToDeg(p))) }));
}
