// «Найти упавший» (P11): последняя точка GPS из журнала телеметрии EdgeTX
// на SD пульта (LOGS/<модель>-<дата>.csv, пишется специальной функцией
// «SD Logs»), расстояние и направление от точки взлёта, ссылки на карты.
// Прошивка (plane: copter/GpsHome.h) после потери фикса шлёт в пульт
// последнюю точку с фиксом, спутники — сколько видно сейчас: строки с
// малым числом спутников в конце журнала — «фикс пропал».
// Без React.

import { N_ } from "../i18n";

export interface RadioLog {
  name: string;
  /** секунды UNIX */
  modified: number;
  size: number;
  /** начало файла (заголовок) */
  head: string;
  /** конец файла; пусто — файл целиком в head */
  tail: string;
}

export interface GpsPoint {
  /** секунды от начала суток журнала (по колонкам Date/Time), NaN — нет времени */
  t: number;
  date: string;
  time: string;
  lat: number;
  lon: number;
  sats: number | null;
  altM: number | null;
}

export interface LostPoint {
  log: string;
  last: GpsPoint;
  start: GpsPoint | null;
  /** от точки взлёта до последней точки, м */
  distanceM: number;
  /** направление от взлёта на последнюю точку, градусы от севера */
  bearingDeg: number;
  /** после последней хорошей точки фикс пропал (спутников меньше FIX_SATS) */
  fixLost: boolean;
  /** сколько ещё секунд журнал писался после последней хорошей точки */
  silentS: number;
}

/** Спутников меньше — фикса, скорее всего, нет. */
export const FIX_SATS = 5;
/** Перерыв в журнале дольше — новый полёт. */
export const SESSION_GAP_S = 60;
const EARTH_R = 6371000;

const colName = (h: string) => h.trim().replace(/\(.*\)$/, "").trim();

function seconds(date: string, time: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const m = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(time.trim());
  if (!m) return NaN;
  const day = d ? Date.UTC(+d[1], +d[2] - 1, +d[3]) / 1000 : 0;
  return day + +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
}

function numOrNull(s: string | undefined): number | null {
  if (s === undefined || s.trim() === "") return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

/** Строки журнала EdgeTX с координатами (по порядку). */
export function parseLog(log: RadioLog): GpsPoint[] {
  const headLines = log.head.split(/\r?\n/);
  const header = headLines[0]?.split(",").map(colName) ?? [];
  const iGps = header.indexOf("GPS");
  if (iGps < 0) return [];
  const iDate = header.indexOf("Date");
  const iTime = header.indexOf("Time");
  const iSats = header.indexOf("Sats");
  const iAlt = header.indexOf("Alt");
  // хвост начинается с обрывка строки — его выбросить
  const lines = log.tail ? log.tail.split(/\r?\n/).slice(1) : headLines.slice(1);
  const out: GpsPoint[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("Date,")) continue;
    const c = line.split(",");
    const g = (c[iGps] ?? "").trim().split(/\s+/);
    if (g.length < 2) continue;
    const lat = parseFloat(g[0]);
    const lon = parseFloat(g[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (lat === 0 && lon === 0) continue;
    const date = iDate >= 0 ? (c[iDate] ?? "") : "";
    const time = iTime >= 0 ? (c[iTime] ?? "") : "";
    out.push({ t: seconds(date, time), date, time: time.trim(), lat, lon, sats: iSats >= 0 ? numOrNull(c[iSats]) : null, altM: iAlt >= 0 ? numOrNull(c[iAlt]) : null });
  }
  return out;
}

/** Расстояние (м) и направление (° от севера) из a в b. */
export function distanceBearing(a: { lat: number; lon: number }, b: { lat: number; lon: number }): { m: number; deg: number } {
  const rad = Math.PI / 180;
  const north = (b.lat - a.lat) * rad * EARTH_R;
  const east = (b.lon - a.lon) * rad * EARTH_R * Math.cos(((a.lat + b.lat) / 2) * rad);
  let deg = (Math.atan2(east, north) / rad + 360) % 360;
  if (north === 0 && east === 0) deg = 0;
  return { m: Math.hypot(north, east), deg };
}

const good = (p: GpsPoint) => p.sats === null || p.sats >= FIX_SATS;

/** Последняя точка последнего полёта в журнале или null. */
export function lostPoint(log: RadioLog): LostPoint | null {
  const all = parseLog(log);
  if (!all.length) return null;
  // последний полёт — после последнего перерыва дольше SESSION_GAP_S
  let from = 0;
  for (let i = 1; i < all.length; i++) if (all[i].t - all[i - 1].t > SESSION_GAP_S) from = i;
  const session = all.slice(from);
  const fixed = session.filter(good);
  const last = fixed.length ? fixed[fixed.length - 1] : session[session.length - 1];
  const start = fixed.length ? fixed[0] : null;
  const end = session[session.length - 1];
  const fixLost = fixed.length > 0 && !good(end);
  const { m, deg } = start ? distanceBearing(start, last) : { m: 0, deg: 0 };
  const silentS = Number.isFinite(end.t - last.t) ? Math.max(0, end.t - last.t) : 0;
  return { log: log.name, last, start, distanceM: m, bearingDeg: deg, fixLost, silentS };
}

/** Из журналов (новые первыми) — первый, где есть координаты. */
export function findLost(logs: RadioLog[]): LostPoint | null {
  for (const l of [...logs].sort((a, b) => b.modified - a.modified)) {
    const p = lostPoint(l);
    if (p) return p;
  }
  return null;
}

const DIRS = [N_("север"), N_("северо-восток"), N_("восток"), N_("юго-восток"), N_("юг"), N_("юго-запад"), N_("запад"), N_("северо-запад")];
/** Сторона света словами (переводится через t). */
export const compassWord = (deg: number) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export const coordText = (lat: number, lon: number) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

export function mapLinks(lat: number, lon: number): { name: string; url: string }[] {
  const la = lat.toFixed(6);
  const lo = lon.toFixed(6);
  return [
    { name: "OpenStreetMap", url: `https://www.openstreetmap.org/?mlat=${la}&mlon=${lo}#map=18/${la}/${lo}` },
    { name: "Google Maps", url: `https://www.google.com/maps/search/?api=1&query=${la},${lo}` },
    { name: N_("Яндекс Карты"), url: `https://yandex.ru/maps/?pt=${lo},${la}&z=18&l=sat` },
  ];
}

/** Готов ли коптер к поиску: пищалка, маяк моторами, координаты в очках. */
export interface FindReadiness {
  beeper: boolean;
  beacon: boolean;
  osdCoords: boolean;
}

const RX_LOST_BIT = 2; // бит условия RX_LOST (номер BF 2 → 1 << 1)

/** params — с платы, pending — ещё не подтверждённые платой правки. */
export function findReadiness(params: Record<string, { value: unknown } | undefined>, pending: Record<string, unknown> = {}): FindReadiness {
  const n = (name: string, d: number) => Number(name in pending ? pending[name] : (params[name]?.value ?? d));
  const visible = (p: number) => (p & 0x3800) !== 0;
  return {
    beeper: (n("beeper_off_flags", 0) & RX_LOST_BIT) === 0,
    beacon: (n("dshot_beacon_off_flags", 514) & RX_LOST_BIT) === 0,
    osdCoords: visible(n("osd_gps_lat_pos", 0)) && visible(n("osd_gps_lon_pos", 0)),
  };
}
