// Разбор полёта по журналу ящика: сводка, полосы режимов для таймлайна,
// спектр шума гироскопа (до и после фильтров) — как в PIDtoolbox и
// Blackbox Explorer, своими словами.

import { Flight, lowerBound, Series } from "./blackbox";

const COPTER_MODES = ["ACRO", "HORIZON", "ANGLE", "ALT_HOLD"];
export const FLAG = { armed: 1, airborne: 2, saturated: 4, crashed: 8, failsafe: 16, rxLost: 32 };

export function names(flight: Flight, key: string, fallback: string[]): string[] {
  const v = flight.info[key];
  return v ? v.split(/\s+/) : fallback;
}

export interface Span {
  t0: number;
  t1: number;
  label: string;
  armed: boolean;
  failsafe: boolean;
}

/** Полосы «режим / ARM / failsafe» во времени — для таймлайна. */
export function modeSpans(flight: Flight): Span[] {
  const q = flight.series.QSTATE;
  const c = flight.series.CTRL;
  const out: Span[] = [];
  const push = (t: number, label: string, armed: boolean, failsafe: boolean) => {
    const last = out[out.length - 1];
    if (last && last.label === label && last.armed === armed && last.failsafe === failsafe) {
      last.t1 = t;
      return;
    }
    if (last) last.t1 = t;
    out.push({ t0: t, t1: t, label, armed, failsafe });
  };
  if (q && q.count) {
    const modes = names(flight, "names.mode", COPTER_MODES);
    for (let i = 0; i < q.count; i++) {
      const f = q.cols.flags[i];
      push(q.t[i], modes[q.cols.mode[i]] ?? "?", (f & FLAG.armed) !== 0, (f & FLAG.failsafe) !== 0);
    }
  } else if (c && c.count) {
    const modes = names(flight, "names.mode", []);
    for (let i = 0; i < c.count; i++) {
      const f = c.cols.flags?.[i] ?? 0;
      push(c.t[i], modes[c.cols.mode[i]] ?? String(c.cols.mode[i]), (f & 1) !== 0, (f & 16) !== 0);
    }
  }
  return out;
}

export interface AxisStats {
  maxRate: number;
  rmsError: number;
}

export interface Summary {
  duration: number;
  armedTime: number;
  axes: AxisStats[];
  maxAltitude: number | null;
  minVolts: number | null;
  maxAmps: number | null;
  mah: number | null;
  saturatedShare: number | null;
  dropped: number;
  maxLoopUs: number | null;
  gyroHz: number | null;
  modes: string[];
}

function maxAbs(a: Float32Array, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
}

/** Частота записей ряда, Гц. */
export function sampleRate(s: Series | undefined): number | null {
  if (!s || s.count < 2) return null;
  const span = s.t[s.count - 1] - s.t[0];
  return span > 0 ? (s.count - 1) / span : null;
}

/** Состояние ARM в момент t (по QSTATE). */
function armedAt(q: Series | undefined, t: number): boolean {
  if (!q || !q.count) return true;
  let i = lowerBound(q.t, q.count, t);
  if (i >= q.count || q.t[i] > t) i--;
  return i >= 0 && (q.cols.flags[i] & FLAG.armed) !== 0;
}

export function summarize(flight: Flight): Summary {
  const g = flight.series.QGYRO;
  const q = flight.series.QSTATE;
  const sys = flight.series.SYS;
  const axes: AxisStats[] = [];
  const AX = ["roll", "pitch", "yaw"];
  for (const a of AX) {
    if (!g) break;
    const f = g.cols[`gyrof_${a}`];
    const sp = g.cols[`sp_${a}`];
    let sum = 0;
    let n = 0;
    let armed = true;
    for (let i = 0; i < g.count; i++) {
      // ARM меняется редко: смотреть QSTATE раз в 20 точек
      if (i % 20 === 0) {
        armed = armedAt(q, g.t[i]);
      }
      if (!armed) continue;
      const e = sp[i] - f[i];
      sum += e * e;
      n++;
    }
    axes.push({ maxRate: maxAbs(f, g.count), rmsError: n ? Math.sqrt(sum / n) : 0 });
  }
  let armedTime = 0;
  let maxAlt: number | null = null;
  let minV: number | null = null;
  let maxA: number | null = null;
  let mah: number | null = null;
  let sat = 0;
  let satN = 0;
  if (q && q.count) {
    for (let i = 1; i < q.count; i++) {
      const armed = (q.cols.flags[i] & FLAG.armed) !== 0;
      if (armed) {
        armedTime += q.t[i] - q.t[i - 1];
        satN++;
        if (q.cols.flags[i] & FLAG.saturated) sat++;
        const v = q.cols.vbat_v[i];
        if (v > 1) minV = minV === null ? v : Math.min(minV, v);
      }
      maxAlt = maxAlt === null ? q.cols.alt_m[i] : Math.max(maxAlt, q.cols.alt_m[i]);
      maxA = maxA === null ? q.cols.amps[i] : Math.max(maxA, q.cols.amps[i]);
    }
    mah = q.cols.mah[q.count - 1];
  } else if (flight.series.CTRL?.cols.flags) {
    // самолёт: ARM — бит 0 флагов CTRL
    const c = flight.series.CTRL;
    for (let i = 1; i < c.count; i++) if (c.cols.flags[i] & 1) armedTime += c.t[i] - c.t[i - 1];
  }
  const modes = Array.from(new Set(modeSpans(flight).filter((s) => s.armed).map((s) => s.label)));
  return {
    duration: flight.stop - flight.start,
    armedTime,
    axes,
    maxAltitude: maxAlt,
    minVolts: minV,
    maxAmps: maxA,
    mah,
    saturatedShare: satN ? sat / satN : null,
    dropped: sys && sys.count ? sys.cols.dropped[sys.count - 1] : 0,
    maxLoopUs: sys && sys.count ? maxAbs(sys.cols.loop_max_us, sys.count) : null,
    gyroHz: sampleRate(g),
    modes,
  };
}

// ---------------- спектр ----------------

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface Spectrum {
  freq: Float32Array;
  /** амплитуда, дБ (°/с) */
  db: Float32Array;
  segments: number;
}

/** Спектр по Уэлчу: окна Ханна по n точек с перекрытием вполовину, среднее мощности. */
export function spectrum(values: Float32Array, from: number, to: number, sampleHz: number, n = 1024): Spectrum | null {
  const len = to - from;
  if (len < 64) return null;
  while (n > len) n >>= 1;
  const hann = new Float64Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    wsum += hann[i];
  }
  const power = new Float64Array(n / 2);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let segments = 0;
  for (let start = from; start + n <= to; start += n / 2) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += values[start + i];
    mean /= n;
    for (let i = 0; i < n; i++) {
      re[i] = (values[start + i] - mean) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < n / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    segments++;
    if (segments >= 400) break;   // длинное окно — хватит
  }
  if (!segments) return null;
  const freq = new Float32Array(n / 2);
  const db = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    freq[k] = (k * sampleHz) / n;
    const amp = (2 * Math.sqrt(power[k] / segments)) / wsum;
    db[k] = 20 * Math.log10(amp + 1e-6);
  }
  return { freq, db, segments };
}

/** Средние обороты мотора в окне (QSTATE rot_hz) — метка на спектре. */
export function meanRotation(flight: Flight, t0: number, t1: number): number | null {
  const q = flight.series.QSTATE;
  if (!q || !q.cols.rot_hz) return null;
  const a = lowerBound(q.t, q.count, t0);
  const b = lowerBound(q.t, q.count, t1);
  let sum = 0;
  let n = 0;
  for (let i = a; i < b; i++) {
    if (q.cols.rot_hz[i] > 0) {
      sum += q.cols.rot_hz[i];
      n++;
    }
  }
  return n ? sum / n : null;
}
