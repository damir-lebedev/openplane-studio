// «Что пропускают фильтры» (054–059): АЧХ цепочек гироскопа и D из
// настроек платы, газ — ползунком (динамические ФНЧ едут за ним), метки
// режекторов и задержка на 100 Гц словами.

import { useState } from "react";

import { Chain, chainOf, curve, delayMs, dynOn, lpf1Hz, notchOn } from "../../core/filters";
import { t } from "../../i18n";
import { useCopterBoard } from "./common";

const F_MIN = 20;
const F_MAX = 1000;
const DB_MIN = -40;
const W = 560;
const H = 200;

const fx = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * W;
const dy = (db: number) => (Math.min(0, Math.max(DB_MIN, db)) / DB_MIN) * H;

function path(c: Chain, throttle: number): string {
  return curve(c, throttle, F_MIN, F_MAX)
    .map(([f, db], i) => `${i ? "L" : "M"}${fx(f).toFixed(1)},${dy(db).toFixed(1)}`)
    .join("");
}

export function FilterChart() {
  const board = useCopterBoard();
  const [throttle, setThrottle] = useState(30);
  const gyro = chainOf(board, "gyro");
  const dterm = chainOf(board, "dterm");
  if (!gyro || !dterm) return null;
  const thr = throttle / 100;
  const dynamic = dynOn(gyro.dyn) || dynOn(dterm.dyn);
  const notches = [...gyro.notches.filter(notchOn).map((n) => ({ ...n, d: false })), ...dterm.notches.filter(notchOn).map((n) => ({ ...n, d: true }))];
  const gridF = [50, 100, 200, 500];
  return (
    <div className="card wide filter-chart" data-testid="filter-chart">
      <h3>{t("Что пропускают фильтры")}</h3>
      <p className="sub">{t("Сверху — проходит как есть, ниже — гасится. Вибрации моторов — справа (сотни герц), полёт — слева. Каждая ступень добавляет задержку: коптер отвечает позже.")}</p>
      <svg viewBox={`-34 -8 ${W + 44} ${H + 30}`} className="filter-svg" role="img" aria-label={t("АЧХ фильтров")}>
        {[0, -10, -20, -30, -40].map((db) => (
          <g key={db}>
            <line x1={0} x2={W} y1={dy(db)} y2={dy(db)} className="filter-grid" />
            <text x={-6} y={dy(db) + 4} className="filter-label" textAnchor="end">
              {db}
            </text>
          </g>
        ))}
        {gridF.map((f) => (
          <g key={f}>
            <line x1={fx(f)} x2={fx(f)} y1={0} y2={H} className="filter-grid" />
            <text x={fx(f)} y={H + 16} className="filter-label" textAnchor="middle">
              {f} {t("Гц")}
            </text>
          </g>
        ))}
        {notches.map((n, i) => (
          <line key={i} x1={fx(n.hz)} x2={fx(n.hz)} y1={0} y2={H} className={`filter-notch${n.d ? " d" : ""}`} />
        ))}
        <path d={path(dterm, thr)} className="filter-curve d" />
        <path d={path(gyro, thr)} className="filter-curve gyro" />
      </svg>
      <div className="filter-legend">
        <span className="filter-key gyro">
          {t("Гироскоп: срез {hz} Гц, задержка {ms} мс", { hz: Math.round(lpf1Hz(gyro, thr)), ms: delayMs(gyro, 100, thr).toFixed(2) })}
        </span>
        <span className="filter-key d">
          {t("D: срез {hz} Гц, задержка {ms} мс", { hz: Math.round(lpf1Hz(dterm, thr)), ms: delayMs(dterm, 100, thr).toFixed(2) })}
        </span>
      </div>
      {dynamic && (
        <label className="row filter-throttle">
          <span>{t("Газ")}</span>
          <input type="range" min={0} max={100} value={throttle} onChange={(e) => setThrottle(Number(e.target.value))} />
          <span className="mono">{throttle} %</span>
          <span className="hint">{t("динамический срез растёт с газом")}</span>
        </label>
      )}
    </div>
  );
}
