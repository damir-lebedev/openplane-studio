// Рисование рядов журнала на canvas. Точек в окне бывает в сотни раз
// больше, чем пикселей (гироскоп 1 кГц × минуты): на каждый столбец
// пикселей берутся минимум и максимум — шум остаётся виден полосой, как в
// Blackbox Explorer, а рисуется не больше 2×ширина отрезков.

import { lowerBound, Series } from "../../core/blackbox";

export function niceStep(span: number, ticks: number): number {
  const raw = span / Math.max(1, ticks);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function ticks(a: number, b: number, count: number): number[] {
  if (!(b > a)) return [a];
  const step = niceStep(b - a, count);
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function formatNumber(v: number, step: number): string {
  const digits = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return v.toFixed(digits);
}

export function formatTime(t: number, step = 1): string {
  const sign = t < 0 ? "−" : "";
  const a = Math.abs(t);
  const m = Math.floor(a / 60);
  const s = a - m * 60;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  const sec = s.toFixed(digits).padStart(digits ? digits + 3 : 2, "0");
  return m ? `${sign}${m}:${sec}` : `${sign}${s.toFixed(digits)}`;
}

export interface Frame {
  x0: number;
  w: number;
  y0: number;
  h: number;
  t0: number;
  t1: number;
  v0: number;
  v1: number;
}

export const xOf = (f: Frame, t: number) => f.x0 + ((t - f.t0) / (f.t1 - f.t0)) * f.w;
export const yOf = (f: Frame, v: number) => f.y0 + f.h - ((v - f.v0) / (f.v1 - f.v0)) * f.h;
export const tOf = (f: Frame, x: number) => f.t0 + ((x - f.x0) / f.w) * (f.t1 - f.t0);

/** Индексы точек, видимых в окне [t0, t1], с одной соседней по краям. */
export function visible(s: Series, t0: number, t1: number): [number, number] {
  const a = Math.max(0, lowerBound(s.t, s.count, t0) - 1);
  const b = Math.min(s.count, lowerBound(s.t, s.count, t1) + 1);
  return [a, b];
}

/** Минимум и максимум поля в окне. */
export function extent(s: Series, col: Float32Array, scale: number, t0: number, t1: number): [number, number] {
  const [a, b] = visible(s, t0, t1);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i < b; i++) {
    const v = col[i] * scale;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

export function drawSeries(
  ctx: CanvasRenderingContext2D,
  f: Frame,
  s: Series,
  col: Float32Array,
  scale: number,
  style: { color: string; width: number; alpha: number; dash?: number[] },
) {
  const [a, b] = visible(s, f.t0, f.t1);
  if (b - a < 1) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(f.x0, f.y0 - 1, f.w, f.h + 2);
  ctx.clip();
  ctx.strokeStyle = style.color;
  ctx.globalAlpha = style.alpha;
  ctx.lineWidth = style.width;
  ctx.lineJoin = "round";
  ctx.setLineDash(style.dash ?? []);
  ctx.beginPath();
  const n = b - a;
  if (n <= f.w * 2) {
    for (let i = a; i < b; i++) {
      const x = xOf(f, s.t[i]);
      const y = yOf(f, col[i] * scale);
      if (i === a) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else {
    // по столбцу пикселей: первая, минимум, максимум, последняя — линия не рвётся
    let column = -1;
    let lo = 0;
    let hi = 0;
    let first = true;
    const flush = (cx: number) => {
      const ylo = yOf(f, lo);
      const yhi = yOf(f, hi);
      if (first) {
        ctx.moveTo(cx, ylo);
        first = false;
      } else ctx.lineTo(cx, ylo);
      ctx.lineTo(cx, yhi);
    };
    for (let i = a; i < b; i++) {
      const cx = Math.floor(xOf(f, s.t[i]));
      const v = col[i] * scale;
      if (cx !== column) {
        if (column >= 0) flush(column + 0.5);
        column = cx;
        lo = hi = v;
      } else {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    if (column >= 0) flush(column + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

/** Холст под размер элемента с учётом плотности пикселей; 2D-контекст в CSS-пикселях. */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export const THEME = {
  grid: "rgba(120, 150, 180, 0.10)",
  gridStrong: "rgba(120, 150, 180, 0.22)",
  label: "#6f8296",
  cursor: "rgba(231, 238, 246, 0.75)",
  font: "11px Inter Variable, Segoe UI, sans-serif",
  mono: "11px ui-monospace, Cascadia Mono, Consolas, monospace",
};
