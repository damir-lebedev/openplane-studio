// Живые данные платы на картинках: стики, тумблеры, крутилки, авиагоризонт.

import { useEffect, useState } from "react";

import { LiveFrame } from "../../api";
import { isFresh, switchPosition } from "../../core/live";
import { t } from "../../i18n";
import { useApp } from "../../store";

/** Живой кадр или null, если плата молчит дольше 1,5 с (перерисовка раз в 0,5 с). */
export function useLive(): LiveFrame | null {
  const live = useApp((s) => s.live);
  const liveAt = useApp((s) => s.liveAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return live && isFresh(liveAt) ? live : null;
}

const norm = (us: number) => Math.max(-1, Math.min(1, (us - 1500) / 500));

/** Стик: x, y — импульсы каналов (мкс), 2000 — вправо и вверх. */
export function LiveStick({ x, y, label, hint }: { x?: number; y?: number; label: string; hint?: string }) {
  const has = x !== undefined && y !== undefined;
  const px = has ? norm(x!) : 0;
  const py = has ? norm(y!) : 0;
  return (
    <div className="lstick">
      <div className="lstick-pad">
        <span className="lstick-h" />
        <span className="lstick-v" />
        <span className={`lstick-dot${has ? "" : " off"}`} style={{ left: `${50 + px * 40}%`, top: `${50 - py * 40}%` }} />
      </div>
      <div className="lstick-label">{label}</div>
      <div className="lstick-val mono">{has ? `${x} · ${y}` : hint ?? "—"}</div>
    </div>
  );
}

/** Тумблер: рычаг в положении по импульсу (вверх — 1000 мкс). */
export function LiveLever({
  name,
  ch,
  us,
  positions,
  flash,
}: {
  name: string;
  ch: number;
  us?: number;
  positions: 2 | 3;
  flash?: boolean;
}) {
  const pos = us === undefined ? null : switchPosition(us, positions);
  const stops = positions === 3 ? [0, 1, 2] : [0, 1];
  return (
    <div className={`llever${flash ? " flash" : ""}`}>
      <div className="llever-name">{name}</div>
      <div className="llever-track">
        {stops.map((s) => (
          <span key={s} className={`llever-stop${pos === s ? " on" : ""}`} />
        ))}
      </div>
      <div className="llever-ch mono">
        CH{ch + 1}
        {us !== undefined && <span> · {us}</span>}
      </div>
    </div>
  );
}

/** Крутилка: доля хода 0…100 %. */
export function LiveKnob({ name, ch, us, flash }: { name: string; ch: number; us?: number; flash?: boolean }) {
  const frac = us === undefined ? 0 : Math.max(0, Math.min(1, (us - 1000) / 1000));
  const angle = -135 + frac * 270;
  return (
    <div className={`lknob${flash ? " flash" : ""}`}>
      <div className="llever-name">{name}</div>
      <div className="lknob-dial">
        <span className="lknob-mark" style={{ transform: `rotate(${angle}deg)`, opacity: us === undefined ? 0.3 : 1 }} />
      </div>
      <div className="llever-ch mono">
        CH{ch + 1}
        {us !== undefined && <span> · {Math.round(frac * 100)} %</span>}
      </div>
    </div>
  );
}

/** Авиагоризонт: крен вправо — горизонт наклоняется влево, нос вверх — горизонт вниз. */
export function Horizon({ roll, pitch, size = 150 }: { roll?: number; pitch?: number; size?: number }) {
  const has = roll !== undefined && pitch !== undefined;
  const r = has ? roll! : 0;
  const p = has ? Math.max(-45, Math.min(45, pitch!)) : 0;
  const shift = p * 1.6; // px на градус при viewBox 200
  return (
    <svg className="horizon" width={size} height={size} viewBox="-100 -100 200 200" aria-label={t("Авиагоризонт")}>
      <defs>
        <clipPath id="hz-clip">
          <circle r="96" />
        </clipPath>
      </defs>
      <g clipPath="url(#hz-clip)">
        <g transform={`rotate(${-r}) translate(0 ${shift})`} opacity={has ? 1 : 0.35}>
          <rect x="-300" y="-300" width="600" height="300" fill="#1f5f8f" />
          <rect x="-300" y="0" width="600" height="300" fill="#6b4a2b" />
          <line x1="-300" y1="0" x2="300" y2="0" stroke="#e7eef6" strokeWidth="1.5" />
          {[-20, -10, 10, 20].map((d) => (
            <g key={d}>
              <line x1={-18} x2={18} y1={-d * 1.6} y2={-d * 1.6} stroke="#e7eef6" strokeWidth="1" opacity="0.7" />
              <text x={24} y={-d * 1.6 + 4} fontSize="9" fill="#e7eef6" opacity="0.7">
                {Math.abs(d)}
              </text>
            </g>
          ))}
        </g>
      </g>
      <circle r="96" fill="none" stroke="#2b3f56" strokeWidth="3" />
      <path d="M-46 0 H-14 L-6 8 L0 2 L6 8 L14 0 H46" fill="none" stroke="#ffcc33" strokeWidth="3.5" strokeLinejoin="round" />
      <circle r="2.5" fill="#ffcc33" />
    </svg>
  );
}

/** Значок состояния датчика из живого кадра. */
export function SensorChip({ name, state, value }: { name: string; state: string | undefined; value?: string }) {
  const cls = state === "ok" ? "ok" : state === "none" ? "" : state === "check" ? "warn" : state ? "err" : "";
  const text = state === "ok" ? value ?? t("ок") : state === "none" ? t("нет") : state === "check" ? t("проверка") : state === "noresp" ? t("молчит") : "—";
  return (
    <span className={`badge ${cls}`} title={state ?? ""}>
      {name}: {text}
    </span>
  );
}
