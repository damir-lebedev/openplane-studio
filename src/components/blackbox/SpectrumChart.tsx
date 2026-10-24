// Спектр гироскопа в видимом окне: до фильтров (серый) и после (голубой),
// отметки — обороты мотора и кратные: пики шума на них — от винтов и
// моторов, между ними — рама. Пересчёт — через 150 мс после остановки окна.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Flight, lowerBound } from "../../core/blackbox";
import { meanRotation, sampleRate, spectrum, Spectrum } from "../../core/bbanalysis";
import { t } from "../../i18n";
import { useBb } from "./bbstore";
import { fitCanvas, formatNumber, THEME, ticks } from "./draw";
import { AXES, COLORS } from "./panels";
import { useWidth } from "./TimeChart";

const AX = ["roll", "pitch", "yaw"];
const HEIGHT = 190;

interface Result {
  raw: Spectrum | null;
  filtered: Spectrum | null;
  rot: number | null;
  nyquist: number;
}

export function SpectrumChart({ flight }: { flight: Flight }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = useWidth(wrap);
  const t0 = useBb((s) => s.t0);
  const t1 = useBb((s) => s.t1);
  const axis = useBb((s) => s.axis);
  const setAxis = useBb((s) => s.setAxis);
  const [res, setRes] = useState<Result | null>(null);
  const [hover, setHover] = useState<{ x: number; f: number; raw: number; flt: number } | null>(null);

  useEffect(() => {
    const g = flight.series.QGYRO;
    if (!g) return;
    const id = setTimeout(() => {
      const hz = sampleRate(g) ?? 1000;
      const a = lowerBound(g.t, g.count, t0);
      const b = lowerBound(g.t, g.count, t1);
      setRes({
        raw: spectrum(g.cols[`gyro_${AX[axis]}`], a, b, hz),
        filtered: spectrum(g.cols[`gyrof_${AX[axis]}`], a, b, hz),
        rot: meanRotation(flight, t0, t1),
        nyquist: hz / 2,
      });
    }, 150);
    return () => clearTimeout(id);
  }, [flight, t0, t1, axis]);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el || width < 10) return;
    const ctx = fitCanvas(el, width, HEIGHT);
    if (!ctx || !res?.raw) return;
    const x0 = 38;
    const w = width - x0 - 8;
    const y0 = 6;
    const h = HEIGHT - 26;
    const fmax = res.nyquist;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of [res.raw, res.filtered]) {
      if (!s) continue;
      for (let k = 1; k < s.db.length; k++) {
        lo = Math.min(lo, s.db[k]);
        hi = Math.max(hi, s.db[k]);
      }
    }
    lo = Math.max(lo, hi - 70);
    const X = (f: number) => x0 + (f / fmax) * w;
    const Y = (d: number) => y0 + h - ((d - lo) / (hi - lo || 1)) * h;
    ctx.font = THEME.font;
    // сетка
    const yt = ticks(lo, hi, 4);
    const ys = yt.length > 1 ? yt[1] - yt[0] : 10;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const d of yt) {
      ctx.strokeStyle = THEME.grid;
      ctx.beginPath();
      ctx.moveTo(x0, Math.round(Y(d)) + 0.5);
      ctx.lineTo(x0 + w, Math.round(Y(d)) + 0.5);
      ctx.stroke();
      ctx.fillStyle = THEME.label;
      ctx.fillText(formatNumber(d, ys), x0 - 5, Y(d));
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const f of ticks(0, fmax, Math.max(2, Math.floor(w / 70)))) {
      ctx.strokeStyle = THEME.grid;
      ctx.beginPath();
      ctx.moveTo(Math.round(X(f)) + 0.5, y0);
      ctx.lineTo(Math.round(X(f)) + 0.5, y0 + h);
      ctx.stroke();
      ctx.fillStyle = THEME.label;
      ctx.fillText(`${f.toFixed(0)}`, X(f), y0 + h + 5);
    }
    // обороты мотора и кратные
    if (res.rot) {
      for (let k = 1; k <= 4; k++) {
        const f = res.rot * k;
        if (f > fmax) break;
        ctx.strokeStyle = k === 1 ? "rgba(255, 166, 87, 0.8)" : "rgba(255, 166, 87, 0.35)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(X(f)) + 0.5, y0);
        ctx.lineTo(Math.round(X(f)) + 0.5, y0 + h);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffa657";
        ctx.textAlign = "left";
        ctx.fillText(k === 1 ? t("мотор") : `×${k}`, X(f) + 3, y0 + 2);
      }
    }
    const line = (s: Spectrum | null, color: string, width: number, fill: boolean) => {
      if (!s) return;
      ctx.beginPath();
      for (let k = 1; k < s.db.length; k++) {
        const x = X(s.freq[k]);
        const y = Y(Math.max(lo, s.db[k]));
        if (k === 1) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (fill) {
        ctx.lineTo(X(s.freq[s.db.length - 1]), y0 + h);
        ctx.lineTo(X(s.freq[1]), y0 + h);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, y0, 0, y0 + h);
        grad.addColorStop(0, "rgba(57, 208, 255, 0.35)");
        grad.addColorStop(1, "rgba(57, 208, 255, 0.02)");
        ctx.fillStyle = grad;
        ctx.fill();
        return;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    line(res.filtered, COLORS.gyro, 0, true);
    line(res.raw, COLORS.raw, 1.2, false);
    line(res.filtered, COLORS.gyro, 1.6, false);
    if (hover) {
      ctx.strokeStyle = THEME.cursor;
      ctx.beginPath();
      ctx.moveTo(Math.round(hover.x) + 0.5, y0);
      ctx.lineTo(Math.round(hover.x) + 0.5, y0 + h);
      ctx.stroke();
    }
  }, [res, width, hover]);

  const onMove = (e: React.PointerEvent) => {
    if (!res?.raw || !wrap.current) return;
    const x = e.clientX - wrap.current.getBoundingClientRect().left;
    const x0 = 38;
    const w = width - x0 - 8;
    const f = Math.max(0, Math.min(res.nyquist, ((x - x0) / w) * res.nyquist));
    const k = Math.min(res.raw.freq.length - 1, Math.round((f / res.nyquist) * (res.raw.freq.length - 1)));
    setHover({ x: x0 + (res.raw.freq[k] / res.nyquist) * w, f: res.raw.freq[k], raw: res.raw.db[k], flt: res.filtered?.db[k] ?? NaN });
  };

  if (!flight.series.QGYRO) return null;
  return (
    <div className="bb-card">
      <div className="bb-card-head">
        <span>{t("Спектр шума")}</span>
        <span className="bb-tabs">
          {AXES.map((a, k) => (
            <button key={a} className={k === axis ? "on" : ""} onClick={() => setAxis(k)}>
              {t(a)}
            </button>
          ))}
        </span>
      </div>
      <div className="bb-canvas" ref={wrap} style={{ height: HEIGHT }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <canvas ref={canvas} />
      </div>
      <div className="bb-spec-foot">
        <span>
          <i style={{ background: COLORS.raw }} />
          {t("до фильтров")}
        </span>
        <span>
          <i style={{ background: COLORS.gyro }} />
          {t("после")}
        </span>
        <span className="grow" />
        {hover ? (
          <span className="mono">
            {hover.f.toFixed(0)} {t("Гц")} · {hover.raw.toFixed(0)} / {Number.isFinite(hover.flt) ? hover.flt.toFixed(0) : "—"} {t("дБ")}
          </span>
        ) : (
          <span className="hint">{res?.rot ? t("мотор ~{hz} Гц", { hz: res.rot.toFixed(0) }) : t("видимое окно графиков")}</span>
        )}
      </div>
    </div>
  );
}
