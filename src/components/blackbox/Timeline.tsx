// Весь полёт одной полосой: режимы цветом, ARM и failsafe, события
// метками, гироскоп фоном; рамка — видимое окно графиков (тащить —
// сдвиг, края — масштаб, щелчок мимо — окно туда).

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { Flight, FlightEvent, lowerBound } from "../../core/blackbox";
import { modeSpans } from "../../core/bbanalysis";
import { t } from "../../i18n";
import { useBb } from "./bbstore";
import { fitCanvas, formatTime, Frame, THEME, ticks, tOf, xOf } from "./draw";
import { MODE_COLORS } from "./panels";
import { useWidth } from "./TimeChart";

const HEIGHT = 86;
const BAND_Y = 6;
const BAND_H = 16;
const TRACE_Y = 28;
const TRACE_H = 34;

export const EVENT_COLORS: Record<string, string> = {
  arm: "#3fb950",
  disarm: "#a3b3c4",
  mode: "#39d0ff",
  failsafe: "#e3b341",
  crash: "#f85149",
  link: "#e3b341",
  battery: "#ffa657",
  refused: "#f85149",
  gps: "#79c0ff",
  record: "#6f8296",
  warn: "#ff7b72",
  other: "#a3b3c4",
};

export function Timeline({ flight }: { flight: Flight }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<Frame | null>(null);
  const width = useWidth(wrap);
  const t0 = useBb((s) => s.t0);
  const t1 = useBb((s) => s.t1);
  const cursor = useBb((s) => s.cursor);
  const spans = useMemo(() => modeSpans(flight), [flight]);
  const [hover, setHover] = useState<{ x: number; e: FlightEvent } | null>(null);
  const drag = useRef<{ kind: "move" | "left" | "right"; x: number; t0: number; t1: number } | null>(null);

  // фон: огибающая гироскопа по всему полёту (один раз на размер)
  const envelope = useMemo(() => {
    const g = flight.series.QGYRO ?? flight.series.IMU;
    if (!g || width < 10) return null;
    const col = g.cols.gyrof_roll ?? g.cols.gx;
    const cols = Math.max(1, width);
    const lo = new Float32Array(cols).fill(Infinity);
    const hi = new Float32Array(cols).fill(-Infinity);
    const span = flight.stop - flight.start || 1;
    for (let i = 0; i < g.count; i++) {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(((g.t[i] - flight.start) / span) * cols)));
      const v = col[i];
      if (v < lo[c]) lo[c] = v;
      if (v > hi[c]) hi[c] = v;
    }
    let m = 1;
    for (let c = 0; c < cols; c++) if (Number.isFinite(hi[c])) m = Math.max(m, Math.abs(lo[c]), Math.abs(hi[c]));
    return { lo, hi, m };
  }, [flight, width]);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || width < 10) return;
    const ctx = fitCanvas(el, width, HEIGHT);
    if (!ctx) return;
    const f: Frame = { x0: 0, w: width, y0: 0, h: HEIGHT, t0: flight.start, t1: flight.stop, v0: 0, v1: 1 };
    frame.current = f;

    // режимы и ARM
    for (const s of spans) {
      const x = xOf(f, s.t0);
      const w = Math.max(1, xOf(f, s.t1) - x);
      ctx.fillStyle = s.armed ? MODE_COLORS[s.label] ?? "#79c0ff" : "#2b3f56";
      ctx.globalAlpha = s.armed ? 0.85 : 0.6;
      ctx.fillRect(x, BAND_Y, w, BAND_H);
      if (s.failsafe) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = "#e3b341";
        ctx.fillRect(x, BAND_Y + BAND_H - 4, w, 4);
      }
      ctx.globalAlpha = 1;
      if (w > 46 && s.armed) {
        ctx.fillStyle = "#04131d";
        ctx.font = "600 10.5px Inter Variable, Segoe UI, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(s.label, x + 6, BAND_Y + BAND_H / 2 + 0.5);
      }
    }

    // огибающая гироскопа
    if (envelope) {
      ctx.fillStyle = "rgba(57, 208, 255, 0.35)";
      const mid = TRACE_Y + TRACE_H / 2;
      const k = TRACE_H / 2 / envelope.m;
      for (let c = 0; c < width; c++) {
        if (!Number.isFinite(envelope.hi[c])) continue;
        const y1 = mid - envelope.hi[c] * k;
        const y2 = mid - envelope.lo[c] * k;
        ctx.fillRect(c, y1, 1, Math.max(1, y2 - y1));
      }
    }

    // время
    ctx.font = THEME.font;
    ctx.fillStyle = THEME.label;
    ctx.textBaseline = "top";
    ctx.textAlign = "center";
    const xt = ticks(flight.start, flight.stop, Math.max(2, Math.floor(width / 110)));
    const step = xt.length > 1 ? xt[1] - xt[0] : 1;
    for (const x of xt) {
      const px = xOf(f, x);
      if (px < 14 || px > width - 14) continue;
      ctx.fillText(formatTime(x, step), px, HEIGHT - 14);
    }

    // события
    for (const e of flight.events) {
      if (e.kind === "record" || e.kind === "other") continue;
      const x = xOf(f, e.t);
      ctx.fillStyle = EVENT_COLORS[e.kind];
      ctx.beginPath();
      ctx.moveTo(x, TRACE_Y + TRACE_H + 2);
      ctx.lineTo(x - 4, TRACE_Y + TRACE_H + 9);
      ctx.lineTo(x + 4, TRACE_Y + TRACE_H + 9);
      ctx.closePath();
      ctx.fill();
    }

    // окно графиков и курсор
    const wx0 = xOf(f, t0);
    const wx1 = xOf(f, t1);
    ctx.fillStyle = "rgba(10, 16, 23, 0.55)";
    ctx.fillRect(0, 0, wx0, HEIGHT - 16);
    ctx.fillRect(wx1, 0, width - wx1, HEIGHT - 16);
    ctx.strokeStyle = "#39d0ff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(wx0 + 0.75, 1.5, Math.max(2, wx1 - wx0 - 1.5), HEIGHT - 19);
    const cx = Math.round(xOf(f, cursor)) + 0.5;
    ctx.strokeStyle = THEME.cursor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, HEIGHT - 16);
    ctx.stroke();
  }, [flight, spans, envelope, width, t0, t1, cursor]);

  const local = (e: React.PointerEvent) => e.clientX - (wrap.current?.getBoundingClientRect().left ?? 0);

  const onDown = (e: React.PointerEvent) => {
    const f = frame.current;
    if (!f) return;
    const x = local(e);
    const wx0 = xOf(f, t0);
    const wx1 = xOf(f, t1);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (Math.abs(x - wx0) < 6) drag.current = { kind: "left", x, t0, t1 };
    else if (Math.abs(x - wx1) < 6) drag.current = { kind: "right", x, t0, t1 };
    else if (x > wx0 && x < wx1) drag.current = { kind: "move", x, t0, t1 };
    else {
      const c = tOf(f, x);
      const half = (t1 - t0) / 2;
      useBb.getState().setView(c - half, c + half);
      useBb.getState().setCursor(c);
      drag.current = { kind: "move", x, t0: c - half, t1: c + half };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const f = frame.current;
    if (!f) return;
    const x = local(e);
    const d = drag.current;
    if (d) {
      const dt = ((x - d.x) / f.w) * (f.t1 - f.t0);
      const bb = useBb.getState();
      if (d.kind === "move") bb.setView(d.t0 + dt, d.t1 + dt);
      else if (d.kind === "left") bb.setView(Math.min(d.t0 + dt, d.t1 - 0.05), d.t1);
      else bb.setView(d.t0, Math.max(d.t1 + dt, d.t0 + 0.05));
      return;
    }
    // подсказка у метки события
    let best: FlightEvent | null = null;
    let bestDx = 7;
    for (const ev of flight.events) {
      if (ev.kind === "record" || ev.kind === "other") continue;
      const dx = Math.abs(xOf(f, ev.t) - x);
      if (dx < bestDx) {
        bestDx = dx;
        best = ev;
      }
    }
    setHover(best ? { x: xOf(f, best.t), e: best } : null);
  };
  const onUp = () => {
    drag.current = null;
  };
  const onDbl = () => useBb.getState().fit();

  return (
    <div className="bb-timeline" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} onDoubleClick={onDbl}>
      <canvas ref={canvas} />
      {hover && (
        <div className="bb-tip" style={{ left: Math.min(Math.max(8, hover.x), width - 220) }}>
          <b>{formatTime(hover.e.t, 0.01)}</b> {hover.e.text}
        </div>
      )}
    </div>
  );
}

/** Первое событие не раньше t — для списка событий у курсора. */
export function eventIndexAt(events: FlightEvent[], t: number): number {
  const times = Float64Array.from(events.map((e) => e.t));
  return lowerBound(times, times.length, t);
}

export const timelineHint = () => t("Колесо — масштаб, перетащить — сдвиг, двойной щелчок — весь полёт");
