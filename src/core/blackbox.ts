// Чёрный ящик OpenPlane: разбор журнала (.bbl — сектора полёта подряд,
// как их выгружает плата) и файла кольца с SD-карты (BLACKBOX.BIN).
// Формат — BlackBoxFormat.h прошивки; поля каждого типа записи читаются из
// самого лога (записи SCHEMA), поэтому старые журналы и журналы самолёта
// читаются тем же кодом, что и коптера.

export const SECTOR = 4096;
const HEADER = 16;
const MAGIC = 0x4242504f;
const VERSION = 2;
const REC_SCHEMA = 0x01;
const REC_INFO = 0x02;
const REC_EVENT = 0x03;
const REC_END = 0x04;
const REC_ERASED = 0xff;

type FieldType = "I" | "i" | "H" | "h" | "B" | "b" | "f" | "s";

export interface FieldDef {
  name: string;
  type: FieldType;
  div: number;
  offset: number;
}

export interface Schema {
  id: number;
  name: string;
  fields: FieldDef[];
  size: number;
}

/** Записи одного типа столбцами: время (с от старта записи) и поля в единицах. */
export interface Series {
  name: string;
  count: number;
  t: Float64Array;
  cols: Record<string, Float32Array>;
  fields: string[];
}

export type EventKind = "arm" | "disarm" | "mode" | "failsafe" | "crash" | "link" | "battery" | "refused" | "gps" | "record" | "warn" | "other";

export interface FlightEvent {
  t: number;
  text: string;
  kind: EventKind;
}

export interface Flight {
  number: number;
  info: Record<string, string>;
  /** set.<имя>=<значение> из заголовка — что задано в CLI */
  settings: [string, string][];
  events: FlightEvent[];
  end: FlightEvent | null;
  series: Record<string, Series>;
  /** первая и последняя метка данных, с */
  start: number;
  stop: number;
  sectors: number;
  badSectors: number;
  tornRecords: number;
  vehicle: "copter" | "plane";
}

function headerOk(b: Uint8Array, at: number): boolean {
  let sum = 0;
  for (let i = 0; i < 15; i++) sum = (sum + b[at + i]) & 0xff;
  return (~sum & 0xff) === b[at + 15];
}

function crc8(b: Uint8Array, from: number, length: number): number {
  let crc = 0;
  for (let i = 0; i < length; i++) {
    crc ^= b[from + i];
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export interface SectorHeader {
  seq: number;
  startMs: number;
  flight: number;
}

export function readHeader(b: Uint8Array, at: number): SectorHeader | null {
  if (at + HEADER > b.length) return null;
  const v = new DataView(b.buffer, b.byteOffset + at, HEADER);
  if (v.getUint32(0, true) !== MAGIC || b[at + 14] !== VERSION || !headerOk(b, at)) return null;
  return { seq: v.getUint32(4, true), startMs: v.getUint32(8, true), flight: v.getUint16(12, true) };
}

const SIZES: Record<string, number> = { I: 4, i: 4, f: 4, H: 2, h: 2, B: 1, b: 1, s: 0 };

/** "t_us:I gx:h/10 ..." → поля со смещениями. */
export function parseFields(text: string): FieldDef[] {
  const out: FieldDef[] = [];
  let offset = 0;
  for (const part of text.trim().split(/\s+/)) {
    const m = /^([^:]+):([IiHhBbfs])(?:\/(\d+(?:\.\d+)?))?$/.exec(part);
    if (!m) continue;
    const type = m[2] as FieldType;
    out.push({ name: m[1], type, div: m[3] ? Number(m[3]) : 1, offset });
    offset += SIZES[type];
  }
  return out;
}

function classify(text: string): EventKind {
  if (text === "ARM") return "arm";
  if (text === "DISARM") return "disarm";
  if (text.startsWith("режим")) return "mode";
  if (text.startsWith("FAILSAFE") || text.includes("failsafe")) return "failsafe";
  if (text.startsWith("авария") || text.includes("CRASH")) return "crash";
  if (text.startsWith("связь")) return "link";
  if (text.startsWith("батарея")) return "battery";
  if (text.startsWith("ARM отклонён")) return "refused";
  if (text.startsWith("GPS") || text.startsWith("дом")) return "gps";
  if (text.startsWith("запись")) return "record";
  if (text.startsWith("очередь") || text.startsWith("носитель") || text.startsWith("флеш")) return "warn";
  return "other";
}

interface RawRec {
  type: number;
  at: number; // смещение данных (после тип/длина)
  len: number;
}

const textOf = (b: Uint8Array, at: number, len: number) => new TextDecoder().decode(b.subarray(at + 4, at + len));

/** Разобрать полёт: сектора подряд (файл .bbl или выбранные из кольца). */
export function decodeFlight(bytes: Uint8Array): Flight {
  const recs: RawRec[] = [];
  let sectors = 0;
  let badSectors = 0;
  let tornRecords = 0;
  let number = 0;
  for (let at = 0; at + SECTOR <= bytes.length; at += SECTOR) {
    sectors++;
    const h = readHeader(bytes, at);
    if (!h) {
      badSectors++;
      continue;
    }
    if (!number) number = h.flight;
    let pos = at + HEADER;
    const end = at + SECTOR;
    while (pos + 2 <= end) {
      const type = bytes[pos];
      const len = bytes[pos + 1];
      const stop = pos + 2 + len;
      if (type === REC_ERASED || stop + 1 > end) break;
      if (crc8(bytes, pos, 2 + len) !== bytes[stop]) {
        tornRecords++;
        break;
      }
      recs.push({ type, at: pos + 2, len });
      pos = stop + 1;
    }
  }

  // схемы и заголовок
  const schemas = new Map<number, { name: string; text: string }>();
  const info: Record<string, string> = {};
  const settings: [string, string][] = [];
  for (const r of recs) {
    if (r.type === REC_SCHEMA) {
      const text = textOf(bytes, r.at, r.len);
      const m = /^(\d+)\s+(\S+)\s+(.*)$/.exec(text);
      if (!m) continue;
      const id = Number(m[1]);
      if (m[2] === "+") {
        const s = schemas.get(id);
        if (s) s.text += " " + m[3];
      } else {
        schemas.set(id, { name: m[2], text: m[3] });
      }
    } else if (r.type === REC_INFO) {
      const text = textOf(bytes, r.at, r.len);
      const eq = text.indexOf("=");
      if (eq <= 0) continue;
      const k = text.slice(0, eq);
      const v = text.slice(eq + 1);
      if (k.startsWith("set.")) settings.push([k.slice(4), v]);
      else info[k] = v;
    }
  }
  const parsed = new Map<number, Schema>();
  for (const [id, s] of schemas) {
    const fields = parseFields(s.text);
    const size = fields.reduce((n, f) => n + SIZES[f.type], 0);
    parsed.set(id, { id, name: s.name, fields, size });
  }

  // время: u32 мкс с переходом через ноль; начало — событие «запись: старт»
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const times = new Float64Array(recs.length);
  let wrap = 0;
  let prev = -1;
  let zero = NaN;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.len < 4) {
      times[i] = NaN;
      continue;
    }
    const t = dv.getUint32(r.at, true);
    if (prev >= 0 && t + 2 ** 31 < prev) wrap += 2 ** 32;
    prev = t;
    times[i] = (t + wrap) / 1e6;
    if (Number.isNaN(zero) && r.type === REC_EVENT && textOf(bytes, r.at, r.len).startsWith("запись: старт")) zero = times[i];
  }
  if (Number.isNaN(zero)) {
    for (let i = 0; i < recs.length; i++) {
      if (recs[i].type >= 0x10 && !Number.isNaN(times[i])) {
        zero = times[i];
        break;
      }
    }
  }
  if (Number.isNaN(zero)) zero = 0;

  // счёт записей по типам — потом столбцы одним куском
  const counts = new Map<number, number>();
  for (const r of recs) {
    const s = parsed.get(r.type);
    if (s && s.size > 0 && r.len === s.size) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  }
  const series: Record<string, Series> = {};
  const byType = new Map<number, Series>();
  for (const [type, n] of counts) {
    const s = parsed.get(type)!;
    const cols: Record<string, Float32Array> = {};
    const names: string[] = [];
    for (const f of s.fields) {
      if (f.name === "t_us" || f.type === "s") continue;
      cols[f.name] = new Float32Array(n);
      names.push(f.name);
    }
    const ser: Series = { name: s.name, count: 0, t: new Float64Array(n), cols, fields: names };
    series[s.name] = ser;
    byType.set(type, ser);
  }

  const events: FlightEvent[] = [];
  let end: FlightEvent | null = null;
  let start = Infinity;
  let stop = -Infinity;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const t = times[i] - zero;
    if (r.type === REC_EVENT || r.type === REC_END) {
      const text = textOf(bytes, r.at, r.len);
      const e = { t, text, kind: r.type === REC_END ? ("record" as EventKind) : classify(text) };
      if (r.type === REC_END) end = e;
      else events.push(e);
      continue;
    }
    const ser = byType.get(r.type);
    if (!ser) continue;
    const s = parsed.get(r.type)!;
    if (r.len !== s.size) continue;
    const k = ser.count++;
    ser.t[k] = t;
    if (t < start) start = t;
    if (t > stop) stop = t;
    for (const f of s.fields) {
      if (f.name === "t_us") continue;
      const col = ser.cols[f.name];
      if (!col) continue;
      const at = r.at + f.offset;
      let v: number;
      switch (f.type) {
        case "I": v = dv.getUint32(at, true); break;
        case "i": v = dv.getInt32(at, true); break;
        case "H": v = dv.getUint16(at, true); break;
        case "h": v = dv.getInt16(at, true); break;
        case "B": v = bytes[at]; break;
        case "b": v = dv.getInt8(at); break;
        case "f": v = dv.getFloat32(at, true); break;
        default: v = 0;
      }
      col[k] = f.div !== 1 ? v / f.div : v;
    }
  }
  // по времени (заголовок пишется при открытии полёта — после предзаписи)
  events.sort((a, b) => a.t - b.t);
  for (const ser of Object.values(series)) sortSeries(ser);
  if (!Number.isFinite(start)) {
    start = 0;
    stop = 0;
  }
  return {
    number,
    info,
    settings,
    events,
    end,
    series,
    start,
    stop,
    sectors,
    badSectors,
    tornRecords,
    vehicle: info.vehicle === "copter" || series.QGYRO ? "copter" : "plane",
  };
}

function sortSeries(s: Series) {
  let sorted = true;
  for (let i = 1; i < s.count; i++) {
    if (s.t[i] < s.t[i - 1]) {
      sorted = false;
      break;
    }
  }
  if (sorted) return;
  const order = Array.from({ length: s.count }, (_, i) => i).sort((a, b) => s.t[a] - s.t[b]);
  const t = new Float64Array(s.count);
  order.forEach((j, i) => (t[i] = s.t[j]));
  s.t = t;
  for (const name of s.fields) {
    const src = s.cols[name];
    const dst = new Float32Array(s.count);
    order.forEach((j, i) => (dst[i] = src[j]));
    s.cols[name] = dst;
  }
}

/** Полёты в файле кольца (BLACKBOX.BIN с карты): по заголовкам секторов. */
export interface RingFlight {
  number: number;
  sectors: number[]; // индексы секторов по порядку
  startMs: number;
  lastMs: number;
}

export function ringFlights(bytes: Uint8Array, firstSector = 1): RingFlight[] {
  const found: { seq: number; flight: number; index: number; ms: number }[] = [];
  const total = Math.floor(bytes.length / SECTOR);
  for (let i = firstSector; i < total; i++) {
    const h = readHeader(bytes, i * SECTOR);
    if (h) found.push({ seq: h.seq, flight: h.flight, index: i, ms: h.startMs });
  }
  found.sort((a, b) => a.seq - b.seq);
  const out: RingFlight[] = [];
  let lastSeq = -1;
  for (const s of found) {
    const cur = out[out.length - 1];
    // тот же полёт — и через сектора без заголовка (сбой записи), до 8 подряд
    if (cur && cur.number === s.flight && s.seq - lastSeq > 0 && s.seq - lastSeq <= 9) {
      cur.sectors.push(s.index);
      cur.lastMs = s.ms;
    } else {
      out.push({ number: s.flight, sectors: [s.index], startMs: s.ms, lastMs: s.ms });
    }
    lastSeq = s.seq;
  }
  return out;
}

export function extractFlight(bytes: Uint8Array, flight: RingFlight): Uint8Array {
  const out = new Uint8Array(flight.sectors.length * SECTOR);
  flight.sectors.forEach((index, k) => out.set(bytes.subarray(index * SECTOR, (index + 1) * SECTOR), k * SECTOR));
  return out;
}

/** Похоже ли на файл кольца (служебный первый сектор, дальше сектора полётов). */
export function looksLikeRing(bytes: Uint8Array): boolean {
  return bytes.length >= 2 * SECTOR && !readHeader(bytes, 0) && bytes.length > 64 * SECTOR;
}

/** Индекс первой точки с t ≥ x (двоичный поиск). */
export function lowerBound(t: Float64Array, count: number, x: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Значение поля в момент x (ближайшая точка не позже). */
export function valueAt(s: Series | undefined, field: string, x: number): number | null {
  if (!s || !s.count || !s.cols[field]) return null;
  let i = lowerBound(s.t, s.count, x);
  if (i >= s.count || s.t[i] > x) i--;
  return s.cols[field][Math.min(s.count - 1, Math.max(0, i))];
}
