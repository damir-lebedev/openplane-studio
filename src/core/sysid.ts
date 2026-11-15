// Идентификация коптера по записи chirp: частотная характеристика «команда
// оси → угловая скорость» и модель по ней. Те же формулы, что в прошивке
// (plane/include/copter/SysId.h — там же объяснение и вывод); сверка —
// sysid.test.ts: один и тот же опыт в обоих языках даёт одни и те же числа.
//
//   r  — возбуждение chirp, u — команда оси (сумма PID + r),
//   y  — гироскоп до фильтров, yf — после.
// Опора — возбуждение (измерение идёт в замкнутом контуре):
//   объект G = Sry/Sru, контур как летал L = Srr/Sru − 1, фильтр F = Syf/Syy.

export interface Cx {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const cabs = (a: Cx) => Math.hypot(a.re, a.im);
export const carg = (a: Cx) => Math.atan2(a.im, a.re);
export const cnorm = (a: Cx) => a.re * a.re + a.im * a.im;
export const cadd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const cmul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const cscale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });
export function cdiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
export const cpolar = (mag: number, phase: number): Cx => ({ re: mag * Math.cos(phase), im: mag * Math.sin(phase) });

/** БПФ на месте, длина — степень двойки. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlr = Math.cos(ang),
      wli = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1,
        wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k,
          q = i + k + len / 2;
        const br = re[q] * wr - im[q] * wi,
          bi = re[q] * wi + im[q] * wr;
        const ar = re[p],
          ai = im[p];
        re[p] = ar + br;
        im[p] = ai + bi;
        re[q] = ar - br;
        im[q] = ai - bi;
        const nr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nr;
      }
    }
  }
}

export interface Band {
  /** где в полосе было возбуждение (среднее с весом его мощности), Гц */
  hz: number;
  /** G: команда оси → гироскоп, (°/с) на единицу хода */
  plant: Cx;
  /** L: разомкнутый контур, как он летал */
  loop: Cx;
  /** F: гироскоп до фильтров → после */
  gyroFilter: Cx;
  /** γ²(r→y)·γ²(r→u), 0…1 */
  coherence: number;
  /** СПМ гироскопа до фильтров мимо возбуждения (шум, вибрация), (°/с)²/Гц */
  noise: number;
  count: number;
}

export interface Response {
  bands: Band[];
  sampleHz: number;
  seconds: number;
}

export interface EstimateOptions {
  segment?: number;
  bandsPerOctave?: number;
  minHz?: number;
  maxHz?: number;
}

export const OVERLAP = 0.75;

/** Частотные характеристики по записи одного свипа (спектры по Уэлчу, полосы по логарифму). */
export function estimate(r: ArrayLike<number>, u: ArrayLike<number>, y: ArrayLike<number>, yf: ArrayLike<number>, sampleHz: number, opt: EstimateOptions = {}): Response {
  const n = r.length;
  const out: Response = { bands: [], sampleHz, seconds: sampleHz > 0 ? n / sampleHz : 0 };
  if (n < 256 || u.length !== n || y.length !== n || yf.length !== n || sampleHz <= 0) return out;
  let N = 256;
  if (opt.segment && opt.segment > 0) {
    while (N * 2 <= opt.segment) N *= 2;
  } else {
    while (N * 2 <= Math.floor(n / 4) && N * 2 <= 4.2 * sampleHz) N *= 2;
  }
  if (N > n) return out;
  const hop = Math.floor(N * (1 - OVERLAP));
  const half = N / 2;
  const bandsPerOctave = opt.bandsPerOctave ?? 12;

  const window = new Float64Array(N);
  let wPower = 0;
  for (let i = 0; i < N; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    wPower += window[i] * window[i];
  }

  const srr = new Float64Array(half),
    suu = new Float64Array(half),
    syy = new Float64Array(half),
    sff = new Float64Array(half);
  const sruR = new Float64Array(half),
    sruI = new Float64Array(half),
    sryR = new Float64Array(half),
    sryI = new Float64Array(half),
    syfR = new Float64Array(half),
    syfI = new Float64Array(half);
  const src = [r, u, y, yf];
  const re = [0, 1, 2, 3].map(() => new Float64Array(N));
  const im = [0, 1, 2, 3].map(() => new Float64Array(N));
  let segments = 0;
  for (let start = 0; start + N <= n; start += hop) {
    for (let c = 0; c < 4; c++) {
      const s = src[c];
      let mean = 0;
      for (let i = 0; i < N; i++) mean += s[start + i];
      mean /= N;
      const dr = re[c],
        di = im[c];
      for (let i = 0; i < N; i++) {
        dr[i] = (s[start + i] - mean) * window[i];
        di[i] = 0;
      }
      fft(dr, di);
    }
    const [Rr, Ur, Yr, Fr] = re;
    const [Ri, Ui, Yi, Fi] = im;
    for (let k = 1; k < half; k++) {
      srr[k] += Rr[k] * Rr[k] + Ri[k] * Ri[k];
      suu[k] += Ur[k] * Ur[k] + Ui[k] * Ui[k];
      syy[k] += Yr[k] * Yr[k] + Yi[k] * Yi[k];
      sff[k] += Fr[k] * Fr[k] + Fi[k] * Fi[k];
      // conj(A)·B
      sruR[k] += Rr[k] * Ur[k] + Ri[k] * Ui[k];
      sruI[k] += Rr[k] * Ui[k] - Ri[k] * Ur[k];
      sryR[k] += Rr[k] * Yr[k] + Ri[k] * Yi[k];
      sryI[k] += Rr[k] * Yi[k] - Ri[k] * Yr[k];
      syfR[k] += Yr[k] * Fr[k] + Yi[k] * Fi[k];
      syfI[k] += Yr[k] * Fi[k] - Yi[k] * Fr[k];
    }
    segments++;
  }
  if (segments === 0) return out;

  const df = sampleHz / N;
  const lo = opt.minHz && opt.minHz > df ? opt.minHz : df;
  const hi = opt.maxHz && opt.maxHz > 0 ? opt.maxHz : 0.5 * sampleHz;
  const total = Math.floor(Math.log2(hi / lo) * bandsPerOctave) + 1;
  if (total <= 0) return out;
  interface Sum {
    rr: number;
    uu: number;
    yy: number;
    fhz: number;
    ru: Cx;
    ry: Cx;
    yf: Cx;
    bins: number;
  }
  const sums: Sum[] = [];
  for (let b = 0; b < total; b++) sums.push({ rr: 0, uu: 0, yy: 0, fhz: 0, ru: cx(0), ry: cx(0), yf: cx(0), bins: 0 });
  for (let k = 1; k < half; k++) {
    const f = k * df;
    if (f < lo || f > hi) continue;
    const b = Math.floor(Math.log2(f / lo) * bandsPerOctave);
    if (b < 0 || b >= total) continue;
    const s = sums[b];
    s.rr += srr[k];
    s.uu += suu[k];
    s.yy += syy[k];
    s.fhz += f * srr[k];
    s.ru.re += sruR[k];
    s.ru.im += sruI[k];
    s.ry.re += sryR[k];
    s.ry.im += sryI[k];
    s.yf.re += syfR[k];
    s.yf.im += syfI[k];
    s.bins++;
  }
  // отрезки перекрыты на 75 %: независимых усреднений примерно вдвое меньше
  const psdScale = 2 / (sampleHz * wPower);
  for (const s of sums) {
    if (s.bins === 0 || s.rr <= 0 || s.uu <= 0 || s.yy <= 0 || cabs(s.ru) <= 0) continue;
    const count = s.bins * segments;
    const nEff = 0.5 * count;
    const fair = (g2: number) => {
      if (nEff <= 1.5) return 0;
      const v = (nEff * g2 - 1) / (nEff - 1);
      return v < 0 ? 0 : v > 1 ? 1 : v;
    };
    const gRy = fair(cnorm(s.ry) / (s.rr * s.yy));
    const gRu = fair(cnorm(s.ru) / (s.rr * s.uu));
    const coherent = cnorm(s.ry) / s.rr;
    const loop = cdiv(cx(s.rr), s.ru);
    out.bands.push({
      hz: s.fhz / s.rr,
      plant: cdiv(s.ry, s.ru),
      loop: { re: loop.re - 1, im: loop.im },
      gyroFilter: { re: s.yf.re / s.yy, im: s.yf.im / s.yy },
      coherence: gRy * gRu,
      noise: ((s.yy > coherent ? s.yy - coherent : 0) * psdScale) / count,
      count,
    });
  }
  return out;
}

/** Модель объекта: G = K·(1 + jωτz)/(jω(1 + jωτ))·e^(−jωT), выход — °/с. */
export interface Plant {
  /** K, (°/с²) на единицу команды оси */
  gain: number;
  /** запаздывание мотора τ, с */
  tau: number;
  /** транспортная задержка T, с */
  delay: number;
  /** τz, с (рысканье: момент разгона ротора); 0 — нет */
  zero: number;
  /** скз остатка подгонки: ln модуля и фаза (рад) вместе */
  error: number;
  points: number;
}

export const plantValid = (p: Plant) => p.gain > 0 && p.tau > 0 && p.points >= 6;

export function plantAt(p: Plant, hz: number): Cx {
  const w = 2 * Math.PI * hz;
  // K·(1 + jωτz) / (jω·(1 + jωτ)) · e^(−jωT)
  const num = cx(p.gain, p.gain * w * p.zero);
  const den = cmul(cx(0, w), cx(1, w * p.tau));
  return cmul(cdiv(num, den), cpolar(1, -w * p.delay));
}

export const WEIGHT_CAP = 20;
export const MIN_COHERENCE = 0.5;
export const MAX_DELAY_S = 0.02;

export function wrapPi(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

interface Point {
  w: number;
  lnMag: number;
  phase: number;
  weight: number;
}

/** При заданных τ и τz: ln K и T — сразу; наружу — взвешенный средний квадрат остатка. */
function solveLinear(pts: Point[], tau: number, zero: number): { cost: number; lnK: number; delay: number } {
  let sw = 0,
    sm = 0;
  const shape = (p: Point) => -Math.log(p.w) - 0.5 * Math.log1p(p.w * p.w * tau * tau) + 0.5 * Math.log1p(p.w * p.w * zero * zero);
  for (const p of pts) {
    sw += p.weight;
    sm += p.weight * (p.lnMag - shape(p));
  }
  const lnK = sm / sw;
  const rho = pts.map((p) => p.phase + 0.5 * Math.PI + Math.atan(p.w * tau) - Math.atan(p.w * zero));
  let best = 1e300,
    bestT = 0;
  for (let T = 0; T <= MAX_DELAY_S; T += 0.0001) {
    let c = 0;
    for (let i = 0; i < pts.length; i++) {
      const e = wrapPi(rho[i] + pts[i].w * T);
      c += pts[i].weight * e * e;
    }
    if (c < best) {
      best = c;
      bestT = T;
    }
  }
  let num = 0,
    den = 0;
  for (let i = 0; i < pts.length; i++) {
    const e = wrapPi(rho[i] + pts[i].w * bestT);
    num += pts[i].weight * pts[i].w * e;
    den += pts[i].weight * pts[i].w * pts[i].w;
  }
  let delay = bestT - (den > 0 ? num / den : 0);
  if (delay < 0) delay = 0;
  let cost = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const em = p.lnMag - shape(p) - lnK;
    const ep = wrapPi(rho[i] + p.w * delay);
    cost += p.weight * (em * em + ep * ep);
  }
  return { cost: cost / sw, lnK, delay };
}

function golden(f: (x: number) => number, a: number, b: number, iterations = 40): number {
  const g = 0.6180339887498949;
  let c = b - g * (b - a),
    d = a + g * (b - a);
  let fc = f(c),
    fd = f(d);
  for (let i = 0; i < iterations; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return 0.5 * (a + b);
}

/** Подгонка модели к измеренной ЧХ (взвешенный МНК по логарифму). withZero — искать и τz (рысканье). */
export function fit(resp: Response, withZero: boolean, minHz = 0, maxHz = 0): Plant {
  const out: Plant = { gain: 0, tau: 0, delay: 0, zero: 0, error: 0, points: 0 };
  const pts: Point[] = [];
  for (const b of resp.bands) {
    if (b.coherence < MIN_COHERENCE || b.hz <= 0) continue;
    if (minHz > 0 && b.hz < minHz) continue;
    if (maxHz > 0 && b.hz > maxHz) continue;
    const mag = cabs(b.plant);
    if (!(mag > 0)) continue;
    pts.push({ w: 2 * Math.PI * b.hz, lnMag: Math.log(mag), phase: carg(b.plant), weight: Math.min(WEIGHT_CAP, b.coherence / (1 - b.coherence + 1e-6)) });
  }
  out.points = pts.length;
  if (pts.length < 6) return out;
  const tauLo = Math.log(0.002),
    tauHi = Math.log(0.4);
  let bestCost = 1e300,
    bestTau = 0.03,
    bestZero = 0;
  const GRID = 48;
  for (let i = 0; i <= GRID; i++) {
    const tau = Math.exp(tauLo + ((tauHi - tauLo) * i) / GRID);
    const zeros = withZero ? GRID : 0;
    for (let j = -1; j < zeros; j++) {
      const zero = j < 0 ? 0 : tau * Math.exp(Math.log(0.3) + ((Math.log(30) - Math.log(0.3)) * j) / (GRID - 1));
      const c = solveLinear(pts, tau, zero).cost;
      if (c < bestCost) {
        bestCost = c;
        bestTau = tau;
        bestZero = zero;
      }
    }
  }
  const step = (tauHi - tauLo) / GRID;
  for (let round = 0; round < (withZero ? 4 : 1); round++) {
    bestTau = Math.exp(golden((lt) => solveLinear(pts, Math.exp(lt), bestZero).cost, Math.log(bestTau) - step, Math.log(bestTau) + step));
    if (withZero && bestZero > 0) {
      bestZero = Math.exp(golden((lz) => solveLinear(pts, bestTau, Math.exp(lz)).cost, Math.log(bestZero) - 0.15, Math.log(bestZero) + 0.15));
    }
  }
  const last = solveLinear(pts, bestTau, bestZero);
  out.gain = Math.exp(last.lnK);
  out.tau = bestTau;
  out.zero = bestZero;
  out.delay = last.delay;
  out.error = Math.sqrt(last.cost);
  return out;
}
