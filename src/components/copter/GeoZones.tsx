// Поле и запретные зоны геозабора (P44 б): многоугольники по точкам —
// «где сейчас дрон» (обойти поле с коптером в руках), вставка координат из
// Яндекс/Google Карт или KML, перетаскивание точек на схеме. Схема — север
// вверх, без подложки карты (Studio работает и без интернета). На плату —
// строками geozone, сохраняет общая кнопка «Сохранить».

import { useMemo, useRef, useState } from "react";

import { clearZoneCommand, e7ToDeg, fenceMapEdges, FENCE_POINTS, FenceZone, FenceZoneType, fmtDeg, freeZone, fromOffset, LatLon, offsetM, parseCoordList, radarEdges, zoneAreaM2, zoneCommands, zoneProblem, zonesMargin } from "../../core/geozones";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { useCopterBoard, useCopterLink, useCopterLive } from "./common";

type ZoneType = Exclude<FenceZoneType, "NONE">;
interface Draft {
  zone: number;
  type: ZoneType;
  pts: LatLon[];
}

const W = 300;
const H = 200;
const PAD = 16;

async function sendAll(cmds: string[]) {
  const run = useApp.getState().copterCommand;
  for (const c of cmds) await run(c);
}

export function GeoZonesEditor() {
  const board = useCopterBoard();
  const { armed } = useCopterLink();
  const live = useCopterLive();
  const zones = board.fence ?? [];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [pasteErr, setPasteErr] = useState<string | null>(null);
  const drone: LatLon | null = live?.gps?.fix ? [live.gps.lat, live.gps.lon] : null;

  const view = useMemo(() => {
    const all = zones.filter((z) => z.type !== "NONE").map((z) => ({ zone: z.zone, type: z.type as ZoneType, pts: z.pts.map(e7ToDeg), problem: z.problem }));
    if (draft) {
      const i = all.findIndex((z) => z.zone === draft.zone);
      const d = { ...draft, problem: zoneProblem(draft.pts) };
      if (i >= 0) all[i] = d;
      else all.push(d);
    }
    return all;
  }, [zones, draft]);

  const edit = (z: FenceZone | { zone: number; type: ZoneType; pts: [number, number][] }) => {
    setDraft({ zone: z.zone, type: z.type as ZoneType, pts: z.pts.map(e7ToDeg) });
    setPaste(null);
  };
  const add = (type: ZoneType) => {
    const zone = freeZone(zones);
    if (zone >= 0) setDraft({ zone, type, pts: [] });
  };
  const sel = draft ? view.find((z) => z.zone === draft.zone) : null;
  const problem = draft ? zoneProblem(draft.pts) : null;
  const margin = drone ? zonesMargin(view, drone) : null;
  const fieldCount = view.filter((z) => z.type === "FIELD" && !z.problem).length;

  return (
    <div className="geozones" data-testid="geozones">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <b className="grow">{t("Поле и запретные зоны")}</b>
        {view.map((z) => (
          <button key={z.zone} className={`btn small${draft?.zone === z.zone ? " primary" : ""}`} disabled={armed} onClick={() => edit(zones.find((x) => x.zone === z.zone) ?? { zone: z.zone, type: z.type, pts: [] })}>
            {z.type === "FIELD" ? t("Поле {n}", { n: z.zone + 1 }) : t("Запрет {n}", { n: z.zone + 1 })}
            {z.problem ? " ⚠" : ""}
          </button>
        ))}
        <button className="btn small" disabled={armed || freeZone(zones) < 0} onClick={() => add("FIELD")}>
          {t("+ поле")}
        </button>
        <button className="btn small" disabled={armed || freeZone(zones) < 0} onClick={() => add("NOFLY")}>
          {t("+ запретная зона")}
        </button>
      </div>
      <p className="hint">
        {t("Поле — многоугольник: летать только внутри, дом не обязательно в середине; запретные зоны — дом соседа, дорога, зрители. Круг и поле вместе — действует то, что ближе. Заармиться можно только внутри поля.")}
      </p>
      {view.length > 0 && <ZoneMap view={view} selected={draft?.zone ?? null} drone={drone} onMove={armed || !draft ? undefined : (i, p) => setDraft({ ...draft, pts: draft.pts.map((q, k) => (k === i ? p : q)) })} />}
      {drone && margin != null && (
        <p className={`hint${margin < 0 ? " warn-text" : ""}`} data-testid="geozones-margin">
          {margin < 0 ? t("Дрон вне поля (или в запретной зоне) на {m} м — здесь он не заармится.", { m: Math.round(-margin) }) : t("Дрон внутри, до ближнего края {m} м.", { m: Math.round(margin) })}
        </p>
      )}
      {drone && fieldCount > 0 && <ZoneRadar view={view} drone={drone} hdg={live?.hdg ?? 0} />}
      {draft && sel && (
        <div className="geozone-edit" data-testid="geozone-edit">
          <div className="seg">
            {(["FIELD", "NOFLY"] as ZoneType[]).map((ty) => (
              <button key={ty} className={draft.type === ty ? "on" : ""} disabled={armed} onClick={() => setDraft({ ...draft, type: ty })}>
                {ty === "FIELD" ? t("Поле — внутри") : t("Запрет — не залетать")}
              </button>
            ))}
          </div>
          <ol className="geozone-pts">
            {draft.pts.map((p, i) => (
              <li key={i}>
                <code>
                  {fmtDeg(p[0])}, {fmtDeg(p[1])}
                </code>
                <button className="btn small" disabled={armed} aria-label={t("Убрать точку")} onClick={() => setDraft({ ...draft, pts: draft.pts.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn small" disabled={armed || !drone || draft.pts.length >= FENCE_POINTS} title={drone ? "" : t("Нет GPS-фикса в живых кадрах")} onClick={() => drone && setDraft({ ...draft, pts: [...draft.pts, drone] })}>
              {t("+ точка: где сейчас дрон")}
            </button>
            <button className="btn small" disabled={armed} onClick={() => setPaste(paste == null ? draft.pts.map((p) => `${fmtDeg(p[0])}, ${fmtDeg(p[1])}`).join("\n") : null)}>
              {t("Вставить координаты")}
            </button>
          </div>
          {paste != null && (
            <div className="geozone-paste">
              <textarea rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="56.3268710, 44.0059870" aria-label={t("Координаты точек")} />
              <p className="hint">{t("По точке на строку: «широта, долгота» — так копируют Яндекс и Google Карты (правый клик по месту). KML из «Моих карт» тоже подойдёт.")}</p>
              {pasteErr && <p className="hint warn-text">{pasteErr}</p>}
              <button
                className="btn small"
                onClick={() => {
                  const r = parseCoordList(paste);
                  if (r.error) setPasteErr(r.line ? t("Строка {n}: {e}", { n: r.line, e: t(r.error) }) : t(r.error));
                  else {
                    setPasteErr(null);
                    setDraft({ ...draft, pts: r.pts });
                    setPaste(null);
                  }
                }}
              >
                {t("Взять точки")}
              </button>
            </div>
          )}
          {problem ? (
            <p className="hint warn-text">{t("Пока не действует: {p}.", { p: t(problem) })}</p>
          ) : (
            <p className="hint">{t("{n} точек, {ha} га.", { n: draft.pts.length, ha: (zoneAreaM2(draft.pts) / 10000).toFixed(2) })}</p>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small primary" disabled={armed || draft.pts.length === 0} onClick={() => void sendAll(zoneCommands(draft.zone, draft.type, draft.pts)).then(() => setDraft(null))}>
              {t("Записать на плату")}
            </button>
            <button className="btn small" disabled={armed} onClick={() => void sendAll([clearZoneCommand(draft.zone)]).then(() => setDraft(null))}>
              {t("Удалить зону")}
            </button>
            <button className="btn small" onClick={() => setDraft(null)}>
              {t("Отмена")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface ViewZone {
  zone: number;
  type: ZoneType;
  pts: LatLon[];
  problem: string | null;
}

/** Схема зон сверху, север вверх; точки выбранной зоны тянутся мышью. */
function ZoneMap({ view, selected, drone, onMove }: { view: ViewZone[]; selected: number | null; drone: LatLon | null; onMove?: (i: number, p: LatLon) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const ref = view.find((z) => z.pts.length)?.pts[0] ?? drone;
  if (!ref) return null;
  const all = view.flatMap((z) => z.pts.map((p) => offsetM(ref, p)));
  if (drone) all.push(offsetM(ref, drone));
  const ns = all.map((p) => p[0]);
  const es = all.map((p) => p[1]);
  const minN = Math.min(...ns, 0);
  const maxN = Math.max(...ns, 0);
  const minE = Math.min(...es, 0);
  const maxE = Math.max(...es, 0);
  const k = Math.min((W - 2 * PAD) / Math.max(10, maxE - minE), (H - 2 * PAD) / Math.max(10, maxN - minN));
  const cx = (W - k * (maxE - minE)) / 2;
  const cy = (H - k * (maxN - minN)) / 2;
  const toXY = (p: LatLon) => {
    const [n, e] = offsetM(ref, p);
    return [cx + (e - minE) * k, H - cy - (n - minN) * k] as const;
  };
  const fromXY = (x: number, y: number): LatLon => fromOffset(ref, (H - cy - y) / k + minN, (x - cx) / k + minE);
  const pointer = (e: React.PointerEvent) => {
    if (drag == null || !onMove || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    onMove(drag, fromXY(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H));
  };
  // масштабная линейка: круглое число метров ≈ четверть ширины
  const raw = (W / 4) / k;
  const step = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((s) => s >= raw) ?? 10000;
  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="geozone-svg" role="img" aria-label={t("Поле сверху, север вверх")} onPointerMove={pointer} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
      {view.map((z) => (
        <polygon key={z.zone} points={z.pts.map((p) => toXY(p).join(",")).join(" ")} className={`gz-${z.type.toLowerCase()}${z.zone === selected ? " gz-sel" : ""}${z.problem ? " gz-bad" : ""}`} />
      ))}
      {view
        .filter((z) => z.zone === selected)
        .flatMap((z) =>
          z.pts.map((p, i) => {
            const [x, y] = toXY(p);
            return (
              <g key={i} className="gz-pt" onPointerDown={(e) => { if (onMove) { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i); } }}>
                <circle cx={x} cy={y} r={6} />
                <text x={x} y={y + 3} textAnchor="middle">
                  {i + 1}
                </text>
              </g>
            );
          }),
        )}
      {drone && <circle cx={toXY(drone)[0]} cy={toXY(drone)[1]} r={5} className="rescue-copter" />}
      <text x={W - 8} y={14} textAnchor="end" className="rescue-label">
        N ↑
      </text>
      <line x1={8} y1={H - 8} x2={8 + step * k} y2={H - 8} className="gz-scale" />
      <text x={8} y={H - 12} className="rescue-label">
        {step >= 1000 ? t("{n} км", { n: step / 1000 }) : t("{m} м", { m: step })}
      </text>
    </svg>
  );
}

/** Радар в очках с полем — те же знаки, что рисует прошивка. */
function ZoneRadar({ view, drone, hdg }: { view: ViewZone[]; drone: LatLon; hdg: number }) {
  const ok = view.filter((z) => !z.problem);
  const { edges, scale } = radarEdges(ok, drone, hdg);
  return (
    <figure className="geofence-osd" aria-label={t("Радар в очках")}>
      <pre data-testid="geozones-osd">{fenceMapEdges(scale, edges).join("\n")}</pre>
      <figcaption className="hint">{t("так в очках сейчас: ^ — вы, точки — стороны поля")}</figcaption>
    </figure>
  );
}
