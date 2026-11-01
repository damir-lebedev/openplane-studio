// Вкладка «GPS»: что видит GPS сейчас, этап возврата домой и схема GPS
// Rescue — профиль полёта (набор высоты, полёт, снижение, посадка), который
// считается из настроек gps_rescue_* так же, как в прошивке (copter/GpsRescue.h).

import { useState } from "react";

import { CopterLive } from "../../api";
import { CopterBoard, num, rescuePath, tabParams } from "../../core/copterParams";
import { N_, t } from "../../i18n";
import { NeedBoard, ParamList, useCopterBoard, useCopterLive } from "./common";

export function GpsTab() {
  return (
    <NeedBoard>
      <GpsBody />
    </NeedBoard>
  );
}

const PHASES: Record<string, string> = {
  CLIMB: N_("набирает высоту"),
  FLY_HOME: N_("летит домой"),
  DESCEND: N_("снижается к дому"),
  LAND: N_("садится"),
  ABORT: N_("возврат невозможен — садится на месте"),
};

const FAILS: Record<string, string> = {
  NO_HOME: N_("дом не поставлен"),
  NO_FIX: N_("нет фикса GPS"),
  LOW_SATS: N_("мало спутников"),
  GPS_LOST: N_("GPS пропал"),
  NO_PROGRESS: N_("не приближается к дому"),
  FLYAWAY: N_("улетает от дома"),
};

function GpsBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const all = tabParams(board, "gps");
  const rescue = all.filter((p) => p.name.startsWith("gps_rescue"));
  const rest = all.filter((p) => !p.name.startsWith("gps_rescue"));
  const procedure = String(board.params.failsafe_procedure?.value ?? "AUTO-LAND");
  return (
    <div className="copter-grid">
      <NowCard live={live} />
      <div className="card">
        <h3>{t("Возврат по потере связи")}</h3>
        {procedure === "GPS-RESCUE" ? (
          <p className="sub">{t("Включён: связь пропала дольше failsafe_delay — коптер летит домой сам. Без фикса GPS не армится.")}</p>
        ) : (
          <p className="sub warn-text">
            {t("Сейчас failsafe_procedure = {p}: по потере связи коптер не вернётся. Для дальних полётов (7\") выберите GPS-RESCUE на вкладке «Безопасность».", { p: procedure })}
          </p>
        )}
        <p className="hint">{t("Ещё — режим GPS RESCUE на тумблер (вкладка «Режимы»): проверить возврат, не выключая пульт.")}</p>
      </div>
      <RescueProfile board={board} live={live} />
      <ParamList title={t("GPS Rescue")} params={rescue} />
      {rest.length > 0 && <ParamList title={t("GPS")} sub={t("Дом ставится при ARM, если спутников достаточно; стрелка домой и расстояние — на OSD.")} params={rest} />}
    </div>
  );
}

function NowCard({ live }: { live: CopterLive | null }) {
  const g = live?.gps;
  return (
    <div className="card">
      <h3>{t("Сейчас")}</h3>
      <div className="kv">
        <span>{t("Фикс")}</span>
        <span className="mono">{!live ? "—" : !g ? t("нет GPS") : g.fix ? t("есть, {n} спутн.", { n: g.sats }) : t("ищет, {n} спутн.", { n: g.sats })}</span>
        <span>{t("Дом")}</span>
        <span className="mono">{g?.home !== undefined ? t("{d} м, направление {a}°", { d: Math.round(g.home), a: Math.round(g.dir ?? 0) }) : t("не поставлен")}</span>
        <span>{t("Возврат")}</span>
        <span className={`mono${live?.rescue === "ABORT" ? " warn-text" : ""}`}>
          {live?.rescue ? t(PHASES[live.rescue] ?? live.rescue) : t("не идёт")}
          {live?.rescueFail ? ` — ${t(FAILS[live.rescueFail] ?? live.rescueFail)}` : ""}
        </span>
      </div>
    </div>
  );
}

function RescueProfile({ board, live }: { board: CopterBoard; live: CopterLive | null }) {
  const liveDist = live?.gps?.home;
  const [dist, setDist] = useState(300);
  const [alt, setAlt] = useState(20);
  const d = liveDist !== undefined && liveDist > 1 ? liveDist : dist;
  const a = liveDist !== undefined && liveDist > 1 && live ? Math.max(0, live.alt) : alt;
  const p = rescuePath(board, d, a, a);

  // схема: дом справа, коптер слева; масштаб по большему
  const W = 640, H = 220, L = 40, R = 30, T = 20, B = 30;
  const maxAlt = Math.max(p.ret, a, 10) * 1.15;
  const x = (m: number) => L + (W - L - R) * (1 - m / Math.max(d, 1));   // m — до дома
  const y = (h: number) => H - B - (H - T - B) * (h / maxAlt);
  const pts = p.tooClose
    ? [[d, a], [d, 0]]
    : [[d, a], [d, p.ret], [p.descent, p.ret], [0, Math.min(p.landAlt, p.ret)], [0, 0]];
  const path = pts.map(([m, h], i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(h).toFixed(1)}`).join(" ");
  const label = (m: number, h: number, s: string, dy = -8, anchor: "middle" | "end" = "middle") => (
    <text x={x(m) + (anchor === "end" ? -10 : 0)} y={y(h) + dy} textAnchor={anchor} className="rescue-label">
      {s}
    </text>
  );
  return (
    <div className="card wide">
      <h3>{t("Как он полетит домой")}</h3>
      <p className="sub">
        {liveDist !== undefined && liveDist > 1
          ? t("По живым данным: {d} м до дома, высота {h} м.", { d: Math.round(d), h: Math.round(a) })
          : t("Пример — подвиньте: где коптер, когда пропала связь.")}
      </p>
      {!(liveDist !== undefined && liveDist > 1) && (
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <label className="row" style={{ gap: 8 }}>
            {t("До дома")}
            <input type="range" min={20} max={2000} step={10} value={dist} onChange={(e) => setDist(Number(e.target.value))} />
            <span className="mono">{dist} {t("м")}</span>
          </label>
          <label className="row" style={{ gap: 8 }}>
            {t("Высота")}
            <input type="range" min={2} max={120} step={1} value={alt} onChange={(e) => setAlt(Number(e.target.value))} />
            <span className="mono">{alt} {t("м")}</span>
          </label>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="rescue-svg" role="img" aria-label={t("Профиль возврата")}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="rescue-ground" />
        <path d={path} className="rescue-path" />
        <circle cx={x(d)} cy={y(a)} r={5} className="rescue-copter" />
        <circle cx={x(0)} cy={y(0)} r={5} className="rescue-home" />
        {label(0, 0, t("дом"), 18)}
        {label(d, a, t("связь пропала"), 18)}
        {!p.tooClose && label((d + p.descent) / 2, p.ret, t("высота {h} м, {v} м/с", { h: Math.round(p.ret), v: (num(board, "gps_rescue_ground_speed", 750) / 100).toFixed(1) }))}
        {!p.tooClose && p.descent > 0 && label(p.descent, p.ret, t("снижение с {m} м", { m: Math.round(p.descent) }), 16, "end")}
        {!p.tooClose && label(0, Math.min(p.landAlt, p.ret), t("медленно с {h} м", { h: Math.round(Math.min(p.landAlt, p.ret)) }), 4, "end")}
      </svg>
      <p className="hint">
        {p.tooClose
          ? t("Ближе gps_rescue_min_start_dist — не летит, а сразу садится на месте.")
          : t("Около {s} с до касания. Проверки в пути (GPS пропал, не приближается, улетает) — посадка на месте.", { s: Math.round(p.seconds) })}
      </p>
    </div>
  );
}
