// Один график журнала во времени: ряды панели, сетка, курсор и значения
// под ним в легенде. Колесо — масштаб вокруг мыши, перетаскивание — сдвиг,
// двойной щелчок — весь полёт. Окно и курсор общие для всех графиков.

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Flight, valueAt } from "../../core/blackbox";
import { t } from "../../i18n";
import { useBb } from "./bbstore";
import { drawSeries, extent, fitCanvas, formatNumber, formatTime, Frame, THEME, ticks, tOf, xOf, yOf } from "./draw";
import { AXES, availableTraces, PanelDef } from "./panels";

const GUTTER = 50;
const PAD_TOP = 6;
const PAD_BOTTOM = 18;

/** Мышь и колесо над областью графика → окно и курсор (общие). */
export function useTimeInteraction(ref: React.RefObject<HTMLElement | null>, frame: React.RefObject<Frame | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dragX: number | null = null;
    let moved = false;
    const local = (e: MouseEvent) => e.clientX - el.getBoundingClientRect().left;
    const onWheel = (e: WheelEvent) => {
      const f = frame.current;
      if (!f) return;
      e.preventDefault();
      const bb = useBb.getState();
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        bb.pan(((e.deltaX || e.deltaY) / f.w) * (f.t1 - f.t0) * 0.6);
      } else {
        bb.zoomAt(tOf(f, local(e)), e.deltaY > 0 ? 1.22 : 1 / 1.22);
      }
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragX = e.clientX;
      moved = false;
      el.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const f = frame.current;
      if (!f) return;
      const bb = useBb.getState();
      if (dragX !== null) {
        const dx = e.clientX - dragX;
        if (Math.abs(dx) > 2) moved = true;
        if (moved) {
          bb.pan((-dx / f.w) * (f.t1 - f.t0));
          dragX = e.clientX;
          return;
        }
      }
      bb.setCursor(tOf(f, local(e)));
    };
    const onUp = (e: PointerEvent) => {
      const f = frame.current;
      if (dragX !== null && !moved && f) useBb.getState().setCursor(tOf(f, local(e)));
      dragX = null;
    };
    const onDbl = () => useBb.getState().fit();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("dblclick", onDbl);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("dblclick", onDbl);
    };
  }, [ref, frame]);
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export { useWidth };

export function TimeChart({ flight, panel, onRemove }: { flight: Flight; panel: PanelDef; onRemove?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const data = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const frame = useRef<Frame | null>(null);
  const t0 = useBb((s) => s.t0);
  const t1 = useBb((s) => s.t1);
  const cursor = useBb((s) => s.cursor);
  const axis = useBb((s) => s.axis);
  const setAxis = useBb((s) => s.setAxis);
  const width = useWidth(wrap);
  const height = panel.height ?? 132;
  const traces = availableTraces(panel, flight);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});

  useTimeInteraction(wrap, frame);

  // данные: при смене окна, размера, рядов
  useLayoutEffect(() => {
    const canvas = data.current;
    if (!canvas || width < 10) return;
    const ctx = fitCanvas(canvas, width, height);
    if (!ctx) return;
    const shown = traces.filter((tr) => !hidden[tr.label]);
    let lo = Infinity;
    let hi = -Infinity;
    for (const tr of shown) {
      const s = flight.series[tr.series];
      const [a, b] = extent(s, s.cols[tr.field], tr.scale ?? 1, t0, t1);
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    }
    if (panel.range) {
      lo = Math.min(lo, panel.range[0]);
      hi = Math.max(hi, panel.range[1]);
      if (Number.isFinite(lo)) {
        lo = Math.max(lo, panel.range[0] - (panel.range[1] - panel.range[0]) * 0.5);
        hi = Math.min(hi, panel.range[1] + (panel.range[1] - panel.range[0]) * 0.5);
      }
    }
    if (!Number.isFinite(lo)) {
      lo = -1;
      hi = 1;
    }
    if (panel.symmetric) {
      const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-3);
      lo = -m;
      hi = m;
    }
    if (hi - lo < 1e-6) {
      hi += 1;
      lo -= 1;
    }
    const pad = (hi - lo) * 0.06;
    const f: Frame = { x0: GUTTER, w: width - GUTTER - 8, y0: PAD_TOP, h: height - PAD_TOP - PAD_BOTTOM, t0, t1, v0: lo - pad, v1: hi + pad };
    frame.current = f;

    // сетка
    ctx.font = THEME.font;
    ctx.textBaseline = "middle";
    const yt = ticks(f.v0, f.v1, Math.max(2, Math.floor(f.h / 30)));
    const ystep = yt.length > 1 ? yt[1] - yt[0] : 1;
    for (const v of yt) {
      const y = Math.round(yOf(f, v)) + 0.5;
      ctx.strokeStyle = v === 0 ? THEME.gridStrong : THEME.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(f.x0, y);
      ctx.lineTo(f.x0 + f.w, y);
      ctx.stroke();
      ctx.fillStyle = THEME.label;
      ctx.textAlign = "right";
      ctx.fillText(formatNumber(v, ystep), f.x0 - 6, y);
    }
    const xt = ticks(t0, t1, Math.max(2, Math.floor(f.w / 90)));
    const xstep = xt.length > 1 ? xt[1] - xt[0] : 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const x of xt) {
      const px = Math.round(xOf(f, x)) + 0.5;
      ctx.strokeStyle = THEME.grid;
      ctx.beginPath();
      ctx.moveTo(px, f.y0);
      ctx.lineTo(px, f.y0 + f.h);
      ctx.stroke();
      ctx.fillStyle = THEME.label;
      ctx.fillText(formatTime(x, xstep), px, f.y0 + f.h + 4);
    }
    for (const tr of shown) {
      const s = flight.series[tr.series];
      drawSeries(ctx, f, s, s.cols[tr.field], tr.scale ?? 1, { color: tr.color, width: tr.width ?? 1.3, alpha: tr.alpha ?? 1, dash: tr.dash });
    }
  }, [flight, panel, width, height, t0, t1, hidden, traces.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // курсор: тонкая линия и точки на рядах
  useLayoutEffect(() => {
    const canvas = over.current;
    const f = frame.current;
    if (!canvas || !f || width < 10) return;
    const ctx = fitCanvas(canvas, width, height);
    if (!ctx || cursor < f.t0 || cursor > f.t1) return;
    const x = Math.round(xOf(f, cursor)) + 0.5;
    ctx.strokeStyle = THEME.cursor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, f.y0);
    ctx.lineTo(x, f.y0 + f.h);
    ctx.stroke();
    for (const tr of traces) {
      if (hidden[tr.label]) continue;
      const v = valueAt(flight.series[tr.series], tr.field, cursor);
      if (v === null) continue;
      const y = yOf(f, v * (tr.scale ?? 1));
      if (y < f.y0 || y > f.y0 + f.h) continue;
      ctx.fillStyle = tr.color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [cursor, width, height, t0, t1, flight, panel, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!traces.length) return null;
  return (
    <div className="bb-chart">
      <div className="bb-chart-head">
        <span className="bb-chart-title">{t(panel.title)}</span>
        {panel.axisTabs && (
          <span className="bb-tabs">
            {AXES.map((a, k) => (
              <button key={a} className={k === axis ? "on" : ""} onClick={() => setAxis(k)}>
                {t(a)}
              </button>
            ))}
          </span>
        )}
        <span className="bb-unit">{panel.unit ? t(panel.unit) : ""}</span>
        <span className="grow" />
        {traces.map((tr) => {
          const v = valueAt(flight.series[tr.series], tr.field, cursor);
          return (
            <button
              key={tr.label}
              className={`bb-legend ${hidden[tr.label] ? "off" : ""}`}
              onClick={() => setHidden((h) => ({ ...h, [tr.label]: !h[tr.label] }))}
              title={t("Показать или скрыть")}
            >
              <i style={{ background: tr.color }} />
              {t(tr.label)}
              <b>{v === null ? "—" : (v * (tr.scale ?? 1)).toFixed(Math.abs(v * (tr.scale ?? 1)) >= 100 ? 0 : 1)}</b>
            </button>
          );
        })}
        {onRemove && (
          <button className="bb-icon" title={t("Убрать график")} onClick={onRemove}>
            <X size={13} />
          </button>
        )}
      </div>
      <div className="bb-canvas" ref={wrap} style={{ height }}>
        <canvas ref={data} />
        <canvas ref={over} className="over" />
      </div>
    </div>
  );
}
