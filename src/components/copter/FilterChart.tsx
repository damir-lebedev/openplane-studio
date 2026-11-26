// «Что пропускают фильтры» (054–059, 071): АЧХ и ФЧХ цепочек гироскопа и D
// из настроек платы, газ — ползунком (динамические ФНЧ едут за ним), метки
// режекторов, задержка на 100 Гц словами и запас контура по осям на модели
// коптера с платы (core/pidStep.ts filterMargins) — до записи на плату.

import { useState } from "react";

import { AXIS_LABELS } from "../../core/copterParams";
import { Chain, chainOf, curve, delayMs, dynOn, lpf1Hz, notchOn } from "../../core/filters";
import { filterMargins, marginVerdict } from "../../core/pidStep";
import { N_, t } from "../../i18n";
import { useCopterBoard } from "./common";

const F_MIN = 20;
const F_MAX = 1000;
const DB_MIN = -40;
const W = 560;
const H = 200;

const LAG_MAX = 180;

type View = "gain" | "lag";

const fx = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * W;
const dy = (db: number) => (Math.min(0, Math.max(DB_MIN, db)) / DB_MIN) * H;
const ly = (lag: number) => (Math.min(LAG_MAX, Math.max(0, lag)) / LAG_MAX) * H;

function path(c: Chain, throttle: number, view: View): string {
  const y = view === "gain" ? dy : ly;
  return curve(c, throttle, F_MIN, F_MAX, 120, view)
    .map(([f, v], i) => `${i ? "L" : "M"}${fx(f).toFixed(1)},${y(v).toFixed(1)}`)
    .join("");
}

const VERDICT_TEXT = {
  ok: N_("с запасом"),
  warn: N_("на грани"),
  bad: N_("мало — раскачается"),
};

/** Запас контура скорости по осям при фильтрах из окна; нет модели с платы — ничего. */
function LoopMargins({ throttle }: { throttle: number }) {
  const board = useCopterBoard();
  const axes = filterMargins(board, throttle);
  if (!axes) return null;
  return (
    <div className="loop-margins" data-testid="loop-margins">
      <div className="row" style={{ gap: 8 }}>
        <b>{t("Запас контура")}</b>
        <span className="hint">{t("на модели коптера с платы, при этих фильтрах и газе — ещё до записи")}</span>
      </div>
      <div className="loop-margin-row">
        {axes.map(({ axis, m }) => {
          const v = marginVerdict(m);
          return (
            <div key={axis} className={`loop-margin ${v}`} data-testid={`loop-margin-${axis}`} title={t("срез контура {hz} Гц", { hz: m.crossoverHz.toFixed(1) })}>
              <span className="loop-margin-axis">{t(AXIS_LABELS[axis])}</span>
              <span className="mono">{t("{pm}° · {gm} дБ", { pm: Math.round(m.phaseMarginDeg), gm: m.gainMarginDb.toFixed(1) })}</span>
              <span className="loop-margin-verdict">{t(VERDICT_TEXT[v])}</span>
            </div>
          );
        })}
      </div>
      <div className="hint">{t("Запас по фазе — сколько ещё задержки выдержит контур, по усилению — во сколько раз можно поднять PID. Ниже срез фильтра — тише моторы, но меньше запас.")}</div>
    </div>
  );
}

export function FilterChart() {
  const board = useCopterBoard();
  const [throttle, setThrottle] = useState(30);
  const [view, setView] = useState<View>("gain");
  const gyro = chainOf(board, "gyro");
  const dterm = chainOf(board, "dterm");
  if (!gyro || !dterm) return null;
  const thr = throttle / 100;
  const dynamic = dynOn(gyro.dyn) || dynOn(dterm.dyn);
  const notches = [...gyro.notches.filter(notchOn).map((n) => ({ ...n, d: false })), ...dterm.notches.filter(notchOn).map((n) => ({ ...n, d: true }))];
  const gridF = [50, 100, 200, 500];
  return (
    <div className="card wide filter-chart" data-testid="filter-chart">
      <div className="row" style={{ gap: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          {t("Что пропускают фильтры")}
        </h3>
        <div className="seg" role="group" aria-label={t("Что показать")}>
          <button className={view === "gain" ? "on" : ""} onClick={() => setView("gain")}>
            {t("Гасит")}
          </button>
          <button className={view === "lag" ? "on" : ""} onClick={() => setView("lag")}>
            {t("Запаздывает")}
          </button>
        </div>
      </div>
      <p className="sub">
        {view === "gain"
          ? t("Сверху — проходит как есть, ниже — гасится. Вибрации моторов — справа (сотни герц), полёт — слева. Каждая ступень добавляет задержку: коптер отвечает позже.")
          : t("Насколько сигнал опаздывает после фильтров, в градусах периода: 0 — вовремя, 90 — на четверть качания позже. Слева, где летает коптер (10–50 Гц), опоздание съедает запас контура.")}
      </p>
      <svg viewBox={`-34 -8 ${W + 44} ${H + 30}`} className="filter-svg" role="img" aria-label={view === "gain" ? t("АЧХ фильтров") : t("ФЧХ фильтров")}>
        {view === "gain"
          ? [0, -10, -20, -30, -40].map((db) => (
              <g key={db}>
                <line x1={0} x2={W} y1={dy(db)} y2={dy(db)} className="filter-grid" />
                <text x={-6} y={dy(db) + 4} className="filter-label" textAnchor="end">
                  {db}
                </text>
              </g>
            ))
          : [0, 45, 90, 135, 180].map((deg) => (
              <g key={deg}>
                <line x1={0} x2={W} y1={ly(deg)} y2={ly(deg)} className="filter-grid" />
                <text x={-6} y={ly(deg) + 4} className="filter-label" textAnchor="end">
                  {deg}°
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
        <path d={path(dterm, thr, view)} className="filter-curve d" />
        <path d={path(gyro, thr, view)} className="filter-curve gyro" />
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
      <LoopMargins throttle={thr} />
    </div>
  );
}
