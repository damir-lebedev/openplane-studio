// Геозабор (P44): круг от дома и потолок, за которые коптер не вылетит в
// любом режиме, и в ACRO, — прошивка copter/Geofence.h (geofence_*). В очках —
// радар 9 × 5 (osd_fence_map_pos) и расстояние до края (osd_fence_pos);
// fenceMap() рисует тот же радар, что прошивка (Osd.h, drawFenceMap).

import type { CopterLive } from "../api";
import { N_ } from "../i18n";
import { CopterBoard, num, ParamValue } from "./copterParams";

export const isGeofenceParam = (name: string) => name.startsWith("geofence");

export type FenceNoGps = "WARN" | "RETURN" | "LAND";

export interface GeofenceView {
  on: boolean;
  /** м от дома; 0 — круга нет */
  radius: number;
  /** м над точкой ARM; 0 — потолка нет */
  alt: number;
  noGps: FenceNoGps;
  /** радар и расстояние в очках включены (бит «показан» osd_*_pos) */
  mapShown: boolean;
  distShown: boolean;
  /** годных многоугольников на плате (поле и запретные зоны, P44 б) */
  zones: number;
}

const OSD_PROFILE_MASK = 0x3800;

/** Забор на плате; null — прошивка старая, его нет. */
export function geofenceOf(b: CopterBoard): GeofenceView | null {
  if (!b.params.geofence) return null;
  const ng = String(b.params.geofence_no_gps?.value ?? "RETURN");
  return {
    on: String(b.params.geofence.value) === "ON",
    radius: num(b, "geofence_radius", 200),
    alt: num(b, "geofence_alt", 120),
    noGps: ng === "WARN" || ng === "LAND" ? ng : "RETURN",
    mapShown: (num(b, "osd_fence_map_pos", 2164) & OSD_PROFILE_MASK) !== 0,
    distShown: (num(b, "osd_fence_pos", 2326) & OSD_PROFILE_MASK) !== 0,
    zones: (b.fence ?? []).filter((z) => z.type !== "NONE" && !z.problem).length,
  };
}

export interface GeofencePreset {
  id: "yard" | "arena" | "field";
  title: string;
  desc: string;
  radius: number;
  alt: number;
}

export const GEOFENCE_PRESETS: GeofencePreset[] = [
  { id: "yard", title: N_("Двор"), desc: N_("50 м вокруг, не выше 30 м"), radius: 50, alt: 30 },
  { id: "arena", title: N_("Площадка"), desc: N_("150 м вокруг, не выше 60 м — игра, тренировка"), radius: 150, alt: 60 },
  { id: "field", title: N_("Поле"), desc: N_("400 м вокруг, не выше 120 м"), radius: 400, alt: 120 },
];

export function geofencePresetOf(v: GeofenceView): GeofencePreset["id"] | null {
  return GEOFENCE_PRESETS.find((p) => p.radius === v.radius && p.alt === v.alt)?.id ?? null;
}

/** Команды на плату: включить/выключить и (по желанию) набор. */
export function geofenceCommands(on: boolean, preset?: GeofencePreset): [string, ParamValue][] {
  const cmds: [string, ParamValue][] = [["geofence", on ? "ON" : "OFF"]];
  if (preset) cmds.push(["geofence_radius", preset.radius], ["geofence_alt", preset.alt]);
  return cmds;
}

/** Включить радар и расстояние в очках (бит «показан», место — прежнее). */
export function geofenceOsdCommands(b: CopterBoard): [string, ParamValue][] {
  const cmds: [string, ParamValue][] = [];
  for (const [name, def] of [["osd_fence_map_pos", 2164], ["osd_fence_pos", 2326]] as const) {
    const v = num(b, name, def);
    if (b.params[name] && (v & OSD_PROFILE_MASK) === 0) cmds.push([name, v | 0x0800]);
  }
  return cmds;
}

export interface GeofenceNote {
  text: string;
  warn: boolean;
}

/** Что пилоту знать про забор с этими числами. */
export function geofenceNotes(v: GeofenceView, b: CopterBoard, live: CopterLive | null): GeofenceNote[] {
  const notes: GeofenceNote[] = [];
  if (!v.on) return notes;
  const area = v.radius > 0 || v.zones > 0;
  if (area && live && !live.gps) notes.push({ text: N_("GPS не виден — с забором коптер не заармится."), warn: true });
  if (v.radius > 0) notes.push({ text: N_("Дом — точка ARM: армиться в середине площадки, а не у её края."), warn: false });
  if (v.radius > 0 && v.zones > 0) notes.push({ text: N_("Круг и поле вместе: действует то, что ближе. Только поле — поставьте радиус 0."), warn: false });
  const minStart = num(b, "gps_rescue_min_start_dist", 15);
  if (v.radius > 0 && v.radius < 2 * minStart) notes.push({ text: N_("Круг меньше двух gps_rescue_min_start_dist — у края коптер будет садиться, а не разворачивать."), warn: true });
  if (area && v.noGps === "WARN") notes.push({ text: N_("WARN: без GPS забор не держит — коптер может вылететь. Для игры и соревнований — RETURN или LAND."), warn: true });
  if (area && (!v.mapShown || !v.distShown)) notes.push({ text: N_("Радар забора в очках выключен — включите кнопкой ниже."), warn: false });
  return notes;
}

/** Предупреждение прошивки по битам живого кадра (как geofenceText в Geofence.h). */
export function geofenceFlagText(f: number): string | null {
  if (f & 16) return "FENCE LAND";
  if (f & 2) return "FENCE RETURN";
  if (f & 8) return "FENCE NO GPS";
  if (f & 1) return "FENCE";
  if (f & 4) return "FENCE ALT";
  return null;
}

/** Где коптер сейчас (для картинки); null — нет живых кадров. */
export function geofenceNow(live: CopterLive | null): { dist: number | null; dir: number | null; hdg: number; margin: number | null; flag: string | null } | null {
  if (!live) return null;
  return {
    dist: live.gps?.home ?? null,
    dir: live.gps?.dir ?? null,
    hdg: live.hdg ?? 0,
    margin: live.fence?.m ?? null,
    flag: live.fence ? geofenceFlagText(live.fence.f) : null,
  };
}

export const FENCE_MAP_COLS = 9;
export const FENCE_MAP_ROWS = 5;
const FENCE_MAP_SPAN = 3.5;
const CELL_ASPECT = 1.5;

/**
 * Радар как в очках: строки по 9 знаков; «^» — коптер носом вверх, «H» —
 * дом, «.» — край забора. homeRelDeg — направление на дом от носа (по часовой).
 */
export function fenceMap(radius: number, homeDist: number, homeRelDeg: number): string[] {
  const cell = radius / FENCE_MAP_SPAN;
  const rel = (homeRelDeg * Math.PI) / 180;
  const homeFwd = homeDist * Math.cos(rel);
  const homeRight = homeDist * Math.sin(rel);
  const cc = Math.floor(FENCE_MAP_COLS / 2);
  const cr = Math.floor(FENCE_MAP_ROWS / 2);
  const g: string[][] = [];
  for (let r = 0; r < FENCE_MAP_ROWS; r++) {
    const row: string[] = [];
    for (let c = 0; c < FENCE_MAP_COLS; c++) {
      const right = (c - cc) * cell - homeRight;
      const fwd = (cr - r) * cell * CELL_ASPECT - homeFwd;
      const d = Math.hypot(right, fwd);
      const half = 0.55 * cell * (Math.abs(fwd) > Math.abs(right) ? CELL_ASPECT : 1);
      row.push(Math.abs(d - radius) <= half ? "." : " ");
    }
    g.push(row);
  }
  const hc = cc + Math.round(homeRight / cell);
  const hr = cr - Math.round(homeFwd / (cell * CELL_ASPECT));
  if (hc >= 0 && hc < FENCE_MAP_COLS && hr >= 0 && hr < FENCE_MAP_ROWS && (hc !== cc || hr !== cr)) g[hr][hc] = "H";
  g[cr][cc] = "^";
  return g.map((r) => r.join(""));
}
