// Вкладка «GPS»: что видит GPS сейчас, этап возврата домой и схема GPS
// Rescue — профиль полёта (набор высоты, полёт, снижение, посадка), который
// считается из настроек gps_rescue_* так же, как в прошивке (copter/GpsRescue.h).

import { useEffect, useRef, useState } from "react";

import { CopterLive } from "../../api";
import { CopterBoard, num, rescuePath, tabParams } from "../../core/copterParams";
import { geofenceOf } from "../../core/geofence";
import { BLIND_PHASE_TEXT } from "../../core/gpsSpoof";
import { homeMapScale, homeTrack, HomeTrack, zonesFromHome } from "../../core/homeMap";
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
  TRAIL: N_("идёт назад по своему следу"),
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
  GPS_SPOOF: N_("GPS подменяют"),
};

function GpsBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const all = tabParams(board, "gps");
  const isRescue = (n: string) => n.startsWith("gps_rescue") || n.startsWith("rth_");
  const rescue = all.filter((p) => isRescue(p.name));
  const rest = all.filter((p) => !isRescue(p.name));
  const procedure = String(board.params.failsafe_procedure?.value ?? "AUTO-LAND");
  return (
    <div className="copter-grid">
      <NowCard live={live} />
      <HomeMapCard board={board} live={live} />
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
        {live?.blind && (
          <>
            <span>{t("Вслепую")}</span>
            <span className="mono warn-text">
              {t("{phase}, до дома ≈ {d} м ± {err} м", {
                phase: t(BLIND_PHASE_TEXT[live.blind.phase] ?? live.blind.phase),
                d: Math.round(Math.hypot(live.blind.n, live.blind.e)),
                err: Math.round(live.blind.err),
              })}
            </span>
          </>
        )}
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
    : p.breadcrumbs
      ? [[d, a], [d, p.ret], [0, p.ret], [0, 0]]
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
        {!p.tooClose && !p.breadcrumbs && p.descent > 0 && label(p.descent, p.ret, t("снижение с {m} м", { m: Math.round(p.descent) }), 16, "end")}
        {!p.tooClose && !p.breadcrumbs && label(0, Math.min(p.landAlt, p.ret), t("медленно с {h} м", { h: Math.round(Math.min(p.landAlt, p.ret)) }), 4, "end")}
        {!p.tooClose && p.breadcrumbs && label(0, p.ret / 2, t("вниз над домом"), 4, "end")}
      </svg>
      <p className="hint">
        {p.tooClose
          ? t("Ближе gps_rescue_min_start_dist — не летит, а сразу садится на месте.")
          : t("Около {s} с до касания. Проверки в пути (GPS пропал, не приближается, улетает) — посадка на месте.", { s: Math.round(p.seconds) })}
      </p>
      {p.breadcrumbs && (
        <p className="hint">
          {t("След (rth_breadcrumbs): если коптер ниже, чем летал на последних {m} м пути (залетел под кроны, во двор), он сначала идёт назад тем же путём до места, где был высоко, и только там набирает высоту. Прямая домой через запретную зону геозабора — тоже по следу.", { m: num(board, "rth_path_m", 100) })}
        </p>
      )}
    </div>
  );
}

/** Путь от дома; копится, пока вкладка открыта (кадр — раз в 50 мс, зависимость — его метка). */
function useHomeTrack(live: CopterLive | null): HomeTrack | null {
  const ref = useRef<HomeTrack | null>(null);
  const [, bump] = useState(0);
  const stamp = live?.t;
  useEffect(() => {
    const next = homeTrack(ref.current, live);
    if (next !== ref.current) {
      ref.current = next;
      bump((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return ref.current;
}

/** Вид сверху: дом в центре, путь, коптер с носом, забор и зоны, линия возврата. */
function HomeMapCard({ board, live }: { board: CopterBoard; live: CopterLive | null }) {
  const track = useHomeTrack(live);
  const fence = geofenceOf(board);
  const fenceOn = !!fence?.on;
  const R = 108;
  const c = 130;
  const scale = homeMapScale(Math.max(track?.maxDist ?? 0, fenceOn ? fence!.radius * 1.02 : 0));
  const k = R / scale;
  const lim = R * 1.18;
  const at = (n: number, e: number) => ({ x: c + Math.max(-lim, Math.min(lim, e * k)), y: c - Math.max(-lim, Math.min(lim, n * k)) });
  const zones = track && fenceOn ? zonesFromHome(board.fence ?? [], track.home) : [];
  const path = (track?.points ?? []).map((p, i) => {
    const q = at(p.n, p.e);
    return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  });
  const now = track?.now;
  if (now && path.length) {
    const q = at(now.n, now.e);
    path.push(`L${q.x.toFixed(1)},${q.y.toFixed(1)}`);
  }
  const hdg = ((live?.hdg ?? 0) * Math.PI) / 180;
  const home = live?.gps?.home;
  const rescue = !!live?.rescue && live.rescue !== "ABORT";
  const blind = live?.blind;
  return (
    <div className="card wide drift-card" data-testid="home-map">
      <h3>{t("Карта: дом и путь")}</h3>
      <div className="drift-body">
        <svg viewBox="0 0 260 260" className="drift-svg" role="img" aria-label={t("Вид сверху: дом и путь коптера")}>
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
          {zones.map((z, i) => (
            <polygon
              key={i}
              points={z.pts.map(([n, e]) => `${(c + e * k).toFixed(1)},${(c - n * k).toFixed(1)}`).join(" ")}
              className={z.type === "NOFLY" ? "home-map-nofly" : "home-map-field"}
              data-testid="home-map-zone"
            />
          ))}
          {fenceOn && <circle cx={c} cy={c} r={fence!.radius * k} className="home-map-fence" data-testid="home-map-fence" />}
          {path.length > 1 && <path d={path.join(" ")} className="home-map-path" data-testid="home-map-path" />}
          {now && rescue && (() => {
            const q = at(now.n, now.e);
            return <line x1={q.x} y1={q.y} x2={c} y2={c} className="home-map-rescue" data-testid="home-map-rescue" />;
          })()}
          {blind && (() => {
            const q = at(blind.n, blind.e);
            return <circle cx={q.x} cy={q.y} r={Math.max(4, blind.err * k)} className="home-map-blind" data-testid="home-map-blind" />;
          })()}
          <circle cx={c} cy={c} r={6} className="rescue-home" />
          {now && (() => {
            const q = at(now.n, now.e);
            return (
              <g>
                <line x1={q.x} y1={q.y} x2={q.x + 13 * Math.sin(hdg)} y2={q.y - 13 * Math.cos(hdg)} className="drift-nose" />
                <circle cx={q.x} cy={q.y} r={5} className="rescue-copter" data-testid="home-map-copter" />
              </g>
            );
          })()}
          {!track && (
            <text x={c} y={c + 30} textAnchor="middle" className="rescue-label">
              {t("дома ещё нет")}
            </text>
          )}
        </svg>
        <div className="grow">
          <div className="kv">
            <span>{t("До дома")}</span>
            <span className="mono" data-testid="home-map-dist">{home !== undefined ? `${Math.round(home)} ${t("м")}` : "—"}</span>
            <span>{t("Пройдено")}</span>
            <span className="mono">{track ? `${Math.round(track.pathM)} ${t("м")}` : "—"}</span>
            <span>{t("Дальше всего")}</span>
            <span className="mono">{track ? `${Math.round(track.maxDist)} ${t("м")}` : "—"}</span>
            <span>{t("Выше всего")}</span>
            <span className="mono">{track ? `${Math.round(track.maxAlt)} ${t("м")}` : "—"}</span>
          </div>
          {!track && <p className="hint">{t("Дом ставится при ARM, когда спутников достаточно (gps_rescue_min_sats). С домом здесь рисуется путь коптера — пока открыта вкладка.")}</p>}
          {track && <p className="hint">{t("Путь — пока открыта вкладка, точка через каждые 3 м; новый ARM — новый дом и путь заново.")}</p>}
          {rescue && <p className="hint warn-text">{t("Идёт возврат: пунктир — прямая домой; со следом (rth_breadcrumbs) коптер может сначала пойти назад своим путём.")}</p>}
          {blind && <p className="hint warn-text">{t("Вслепую: кружок — где коптер по своим датчикам и насколько это неточно.")}</p>}
          {fenceOn && <p className="hint">{t("Пунктир по кругу — геозабор {r} м; красное — запретные зоны.", { r: fence!.radius })}</p>}
        </div>
      </div>
    </div>
  );
}
