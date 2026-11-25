// Вкладка коптера «Датчики» (P61): последние секунды живых кадров — графики
// гироскопа, акселерометра и барометра, как Sensors в Betaflight, и сводка
// «среднее ± шум» по каждой оси.

/** Сколько секунд держит график. */
export const TRACE_MS = 10_000;

/** Дорожка: моменты кадров (мс) и значения по осям (v[ось][кадр]). */
export interface Trace {
  t: number[];
  v: number[][];
}

export function emptyTrace(axes: number): Trace {
  return { t: [], v: Array.from({ length: axes }, () => []) };
}

/** Новый кадр в конец; старше keepMs — выкинуть. Возвращает новую дорожку (старая не меняется). */
export function pushTrace(tr: Trace, at: number, values: readonly number[], keepMs = TRACE_MS): Trace {
  let from = 0;
  while (from < tr.t.length && at - tr.t[from] > keepMs) from++;
  // время пошло назад (переподключение) — начать заново
  if (tr.t.length && at < tr.t[tr.t.length - 1]) from = tr.t.length;
  return {
    t: [...tr.t.slice(from), at],
    v: tr.v.map((axis, i) => [...axis.slice(from), values[i] ?? NaN]),
  };
}

/**
 * Пределы оси Y: все значения дорожки, но не уже minSpan (шум ±0.1 °/с не
 * растягивается на весь график) и с запасом 10 % сверху и снизу.
 */
export function traceRange(tr: Trace, minSpan: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const axis of tr.v)
    for (const x of axis) {
      if (!Number.isFinite(x)) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  if (!Number.isFinite(lo)) return [-minSpan / 2, minSpan / 2];
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.1;
  return [lo - pad, hi + pad];
}

/** Линия одной оси для <path d>: время справа налево (последний кадр — у правого края). */
export function tracePath(tr: Trace, axis: number, range: [number, number], w: number, h: number, now?: number): string {
  const end = now ?? (tr.t.length ? tr.t[tr.t.length - 1] : 0);
  const [lo, hi] = range;
  const span = hi - lo || 1;
  let d = "";
  let pen = false;
  tr.t.forEach((at, i) => {
    const x = tr.v[axis][i];
    if (!Number.isFinite(x)) {
      pen = false;
      return;
    }
    const px = w - ((end - at) / TRACE_MS) * w;
    const py = h - ((x - lo) / span) * h;
    d += `${pen ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`;
    pen = true;
  });
  return d;
}

/** Среднее и разброс (СКО) оси за окно; кадров нет — null. */
export function traceStats(tr: Trace, axis: number): { mean: number; sd: number } | null {
  const xs = tr.v[axis].filter(Number.isFinite);
  if (!xs.length) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd };
}

/** Модуль вектора — «полная перегрузка» акселерометра, на столе ≈ 1 g. */
export function magnitude(v: readonly number[]): number {
  return Math.sqrt(v.reduce((a, b) => a + b * b, 0));
}

/**
 * Что думать об акселерометре на столе: модуль вектора далёк от 1 g —
 * датчик врёт или коптер трясут. null — всё в порядке или данных мало.
 */
export function accVerdict(acc: readonly number[] | undefined, still: boolean): "ok" | "off" | null {
  if (!acc || !still) return null;
  const g = magnitude(acc);
  return Math.abs(g - 1) <= 0.08 ? "ok" : "off";
}
