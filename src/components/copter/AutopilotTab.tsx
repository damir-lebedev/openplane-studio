// Вкладка «Автопилот»: удержание позиции (POS HOLD) и высоты (ALT HOLD) —
// прошивка copter/PositionHold.h, AltitudeHold.h. Сверху — живая картинка
// дрейфа: точки положения коптера вокруг точки удержания (оценка по GPS и
// акселерометру); ниже — ползунки и стик газа по настройкам alt_hold_*.

import { useEffect, useRef, useState } from "react";
import { Crosshair, MoveVertical } from "lucide-react";

import { CopterLive } from "../../api";
import { CopterBoard, tabParams } from "../../core/copterParams";
import { climbAt, driftScale, driftStats, driftTrail, DriftTrail, HEADING_SOURCES, HOLD_PHASES, POS_FAILS, posHoldMissing, throttleZones } from "../../core/posHold";
import { N_, t } from "../../i18n";
import { NeedBoard, ParamList, ParamRow, ParamSlider, useCopterBoard, useCopterLive } from "./common";

export function AutopilotTab() {
  return (
    <NeedBoard>
      <AutopilotBody />
    </NeedBoard>
  );
}

// ползунки: настройка, как её зовут словами, шаг
const POS_SLIDERS: [string, string, number][] = [
  ["pos_hold_adjust_rate", N_("Скорость по стику"), 5],
  ["pos_hold_deadband", N_("Мёртвая зона стика"), 1],
  ["autopilot_max_angle", N_("Наибольший наклон"), 1],
  ["autopilot_position_p", N_("P — как резко возвращается к точке"), 1],
  ["autopilot_position_i", N_("I — как быстро привыкает к ветру"), 1],
  ["autopilot_position_d", N_("D — как сильно гасит скорость"), 1],
  ["autopilot_position_a", N_("A — как сильно гасит порыв сразу"), 1],
  ["autopilot_position_cutoff", N_("Сглаживание (меньше — плавнее)"), 5],
];

const ALT_SLIDERS: [string, string, number][] = [
  ["alt_hold_adjust_rate", N_("Набор при газе до упора"), 5],
  ["alt_hold_deadband", N_("Зона удержания у центра стика"), 1],
  ["autopilot_altitude_p", N_("P — как резко возвращается на высоту"), 1],
  ["autopilot_altitude_i", N_("I — как быстро уточняет газ висения"), 1],
  ["autopilot_altitude_d", N_("D — как сильно гасит вертикальную скорость"), 1],
  ["autopilot_altitude_f", N_("F — отклик на движение стика газа"), 1],
];

function AutopilotBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const all = tabParams(board, "autopilot");
  if (!all.length) {
    return (
      <div className="card wide">
        <h3>{t("Автопилот")}</h3>
        <p className="sub">{t("На плате прошивка без удержания позиции. Обновите прошивку коптера — появятся режим POS HOLD и настройки удержания высоты как в Betaflight 2025.")}</p>
      </div>
    );
  }
  const sliders = new Set([...POS_SLIDERS, ...ALT_SLIDERS].map(([n]) => n));
  const rest = all.filter((p) => !sliders.has(p.name) && p.name !== "pos_hold_without_mag");
  const withoutMag = board.params.pos_hold_without_mag;
  return (
    <div className="copter-grid">
      <DriftCard board={board} live={live} />
      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <Crosshair size={18} />
          <h3 style={{ margin: 0 }}>{t("Удержание позиции")}</h3>
        </div>
        <p className="sub">{t("Режим POS HOLD: стики в центре — коптер стоит над точкой и сам борется с ветром; стик — летит в его сторону, отпустили — тормозит и держит новое место. Высоту держит сам.")}</p>
        <Sliders board={board} list={POS_SLIDERS} />
        {withoutMag && <ParamRow p={withoutMag} title={t("Держать позицию без компаса")} />}
        <p className="hint">{t("30 у P, I, D, A — расчётные значения. Коптер качается вокруг точки — убавьте P и D; его сносит порывами — прибавьте A и I.")}</p>
      </div>
      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <MoveVertical size={18} />
          <h3 style={{ margin: 0 }}>{t("Удержание высоты")}</h3>
        </div>
        <p className="sub">{t("Режимы ALT HOLD и POS HOLD: газ у центра — коптер висит, выше и ниже — набор и снижение. Отпустили стик на скорости — сначала остановится, потом запомнит высоту.")}</p>
        <ThrottleStick board={board} live={live} />
        <Sliders board={board} list={ALT_SLIDERS} />
      </div>
      <ParamList title={t("Газ в удержании высоты")} sub={t("Газ висения прошивка берёт из описания коптера и уточняет в полёте; пределы — чтобы автомат не дал полный газ и не заглушил моторы.")} params={rest} />
    </div>
  );
}

function Sliders({ board, list }: { board: CopterBoard; list: [string, string, number][] }) {
  return (
    <>
      {list.map(([name, title, step]) => {
        const p = board.params[name];
        return p && <ParamSlider key={name} p={p} title={t(title)} step={step} />;
      })}
    </>
  );
}

/** След положения за последние 30 с; копится, пока вкладка открыта. */
function useDriftTrail(live: CopterLive | null): DriftTrail | null {
  const ref = useRef<DriftTrail | null>(null);
  const [, bump] = useState(0);
  const stamp = live?.t;
  useEffect(() => {
    ref.current = driftTrail(ref.current, live);
    bump((n) => n + 1);
    // кадр — раз в 50 мс; зависимость — его метка времени
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return ref.current;
}

const ANCHOR_TEXT: Record<DriftTrail["anchor"], string> = {
  hold: N_("от точки удержания"),
  est: N_("от места, где открыли вкладку (оценка положения)"),
  gps: N_("от первого фикса (сырой GPS: до ARM дома ещё нет)"),
};

/** Живая картинка: точка удержания в центре, кольца в метрах, след коптера, вектор скорости. */
function DriftCard({ board, live }: { board: CopterBoard; live: CopterLive | null }) {
  const trail = useDriftTrail(live);
  const stats = driftStats(trail);
  const R = 96;
  const c = 120;
  const scale = driftScale(stats?.max ?? 0);
  const k = R / scale;
  const at = (n: number, e: number) => ({ x: c + Math.max(-R * 1.15, Math.min(R * 1.15, e * k)), y: c - Math.max(-R * 1.15, Math.min(R * 1.15, n * k)) });
  const points = trail?.points ?? [];
  const last = points[points.length - 1];
  const now = live?.t ?? 0;
  const pos = live?.pos;
  const holding = !!pos?.hold;
  const missing = posHoldMissing(board, live);
  const fail = live?.posfail;
  const speed = pos ? Math.hypot(pos.vn, pos.ve) : 0;
  // нос коптера — стрелкой: курс от севера
  const hdg = ((live?.hdg ?? 0) * Math.PI) / 180;
  return (
    <div className="card wide drift-card" data-testid="drift-card">
      <h3>{t("Сейчас: где коптер относительно точки")}</h3>
      <div className="drift-body">
        <svg viewBox="0 0 240 240" className="drift-svg" role="img" aria-label={t("Дрейф вокруг точки удержания")}>
          {[1, 0.5].map((f) => (
            <circle key={f} cx={c} cy={c} r={R * f} className="drift-ring" />
          ))}
          <line x1={c - R} x2={c + R} y1={c} y2={c} className="drift-axis" />
          <line x1={c} x2={c} y1={c - R} y2={c + R} className="drift-axis" />
          <text x={c} y={c - R - 6} textAnchor="middle" className="rescue-label">
            {t("С")}
          </text>
          <text x={c + R + 3} y={c - 3} className="rescue-label">
            {t("{m} м", { m: scale })}
          </text>
          <text x={c + R / 2 + 3} y={c - 3} className="rescue-label">
            {t("{m} м", { m: scale / 2 })}
          </text>
          <circle cx={c} cy={c} r={4} className={holding ? "drift-target on" : "drift-target"} />
          {points.map((p, i) => {
            const q = at(p.n, p.e);
            const age = Math.min(1, Math.max(0, (now - p.t) / 30000));
            return <circle key={i} cx={q.x} cy={q.y} r={1.8} className="drift-point" opacity={0.9 - 0.75 * age} />;
          })}
          {last &&
            (() => {
              const q = at(last.n, last.e);
              const v = pos ? at(last.n + pos.vn, last.e + pos.ve) : q;
              return (
                <g>
                  {speed > 0.15 && <line x1={q.x} y1={q.y} x2={v.x} y2={v.y} className="drift-speed" />}
                  <line x1={q.x} y1={q.y} x2={q.x + 13 * Math.sin(hdg)} y2={q.y - 13 * Math.cos(hdg)} className="drift-nose" />
                  <circle cx={q.x} cy={q.y} r={5} className="rescue-copter" data-testid="drift-copter" />
                </g>
              );
            })()}
          {!last && (
            <text x={c} y={c + 30} textAnchor="middle" className="rescue-label">
              {t("жду фикс GPS")}
            </text>
          )}
        </svg>
        <div className="grow">
          <div className="kv">
            <span>{t("Удержание")}</span>
            <span className={`mono${fail ? " warn-text" : ""}`} data-testid="drift-phase">
              {fail ? t("не держит") : holding ? t(HOLD_PHASES[pos!.hold!] ?? pos!.hold!) : t("выключено")}
            </span>
            <span>{t("Уход от точки")}</span>
            <span className="mono" data-testid="drift-now">
              {stats ? t("{now} м, наибольший {max} м", { now: stats.now.toFixed(2), max: stats.max.toFixed(2) }) : "—"}
            </span>
            <span>{t("Скорость")}</span>
            <span className="mono">{pos ? `${speed.toFixed(1)} ${t("м/с")}` : "—"}</span>
            <span>{t("Курс")}</span>
            <span className="mono">{live ? `${Math.round(live.hdg)}° · ${t(HEADING_SOURCES[live.hsrc ?? "NONE"])}` : "—"}</span>
            <span>GPS</span>
            <span className="mono">{!live ? "—" : !live.gps ? t("нет GPS") : live.gps.fix ? t("есть, {n} спутн.", { n: live.gps.sats }) : t("ищет, {n} спутн.", { n: live.gps.sats })}</span>
          </div>
          {fail && <p className="hint warn-text">{t(POS_FAILS[fail] ?? fail)}</p>}
          {!fail && missing.length > 0 && (
            <p className="hint warn-text" data-testid="drift-missing">
              {t("POS HOLD сейчас не возьмётся:")} {missing.map((m) => t(m)).join("; ")}.
            </p>
          )}
          {trail && <p className="hint">{t("Точки — последние 30 секунд,")} {t(ANCHOR_TEXT[trail.anchor])}.</p>}
          <p className="hint">{t("Включается режимом POS HOLD на тумблере (вкладка «Режимы»). В полёте хорошо — когда точки лежат кучно, в пределах метра; на столе по ним видно, как «гуляет» сам GPS.")}</p>
        </div>
      </div>
    </div>
  );
}

/** Стик газа: зона удержания у центра, набор и снижение по краям; в полёте — где стик сейчас. */
function ThrottleStick({ board, live }: { board: CopterBoard; live: CopterLive | null }) {
  const z = throttleZones(board);
  const top = 12;
  const h = 96;
  const y = (stick: number) => top + (1 - stick) * h;
  // газ — где стоит T в карте каналов (map AETR1234); в кадре — мкс
  const us = live?.ch?.[Math.max(0, (board.rc?.map ?? "AETR1234").indexOf("T"))];
  const stick = us ? Math.max(0, Math.min(1, (us - 1000) / 1000)) : null;
  const inAlt = live?.mode === "ALT_HOLD" || live?.mode === "POS_HOLD";
  return (
    <svg viewBox="0 0 260 120" className="throttle-svg" role="img" aria-label={t("Стик газа в удержании высоты")}>
      <rect x={20} y={top} width={22} height={h} rx={4} className="thr-track" />
      <rect x={20} y={y(z.high)} width={22} height={y(z.low) - y(z.high)} className="thr-hold" />
      {stick !== null && <circle cx={31} cy={y(stick)} r={6} className={inAlt ? "rescue-copter" : "thr-stick"} />}
      <text x={52} y={y(1) + 8} className="rescue-label">
        {t("до упора вверх — набор {v} м/с", { v: z.climb.toFixed(1) })}
      </text>
      <text x={52} y={y(0.5) + 3} className="rescue-label" data-testid="thr-hold-text">
        {t("центр ±{p} % — держит высоту", { p: Math.round((z.high - 0.5) * 100) })}
      </text>
      <text x={52} y={y(0) - 2} className="rescue-label">
        {t("до упора вниз — снижение {v} м/с", { v: z.descent.toFixed(1) })}
      </text>
      {stick !== null && inAlt && (
        <text x={52} y={y(0.5) + 18} className="training-flag">
          {t("сейчас: {v} м/с", { v: climbAt(z, stick).toFixed(1) })}
        </text>
      )}
    </svg>
  );
}
