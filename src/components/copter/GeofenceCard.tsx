// «Геозабор» (P44): граница, за которую коптер не вылетит ни в каком режиме.
// Галочка, наборы, числа строками настроек; картинка — круг сверху с точкой
// коптера и радар, каким он будет в очках (те же знаки, что рисует прошивка).

import { Fence } from "lucide-react";

import { ParamValue } from "../../core/copterParams";
import { fenceMap, GEOFENCE_PRESETS, geofenceCommands, geofenceNotes, geofenceNow, geofenceOf, geofenceOsdCommands, geofencePresetOf, GeofenceView } from "../../core/geofence";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { ParamInput, useCopterBoard, useCopterLink, useCopterLive } from "./common";

const PARAMS: [string, string][] = [
  ["geofence_radius", N_("Радиус от дома")],
  ["geofence_alt", N_("Потолок")],
  ["geofence_no_gps", N_("Пропал GPS")],
];

function send(cmds: [string, ParamValue][]) {
  const set = useApp.getState().copterSet;
  for (const [name, v] of cmds) void set(name, v);
}

export function GeofenceCard() {
  const board = useCopterBoard();
  const { armed } = useCopterLink();
  const live = useCopterLive();
  const v = geofenceOf(board);
  if (!v) return null;
  const preset = geofencePresetOf(v);
  const notes = geofenceNotes(v, board, live);
  const osdFix = geofenceOsdCommands(board);
  return (
    <div className="card wide geofence-card" data-testid="geofence-card">
      <div className="row" style={{ gap: 10 }}>
        <Fence size={18} />
        <h3 className="grow" style={{ margin: 0 }}>
          {t("Геозабор")}
        </h3>
        <label className="row" style={{ gap: 6 }} data-param="geofence">
          <input type="checkbox" checked={v.on} disabled={armed} onChange={(e) => send(geofenceCommands(e.target.checked))} />
          {v.on ? t("включён") : t("выключен")}
        </label>
      </div>
      <p className="sub">
        {t("Граница, за которую коптер не вылетит ни в каком режиме, и в ACRO: к краю тормозит, у края автомат сам ведёт назад и стики не слушаются. Без GPS не армится. В очках — радар с краем и расстояние до него.")}
      </p>
      {v.on && (
        <>
          <div className="seg training-presets">
            {GEOFENCE_PRESETS.map((p) => (
              <button key={p.id} className={preset === p.id ? "on" : ""} disabled={armed} title={t(p.desc)} onClick={() => send(geofenceCommands(true, p).slice(1))}>
                {t(p.title)}
              </button>
            ))}
          </div>
          <div className="training-body">
            <GeofencePicture v={v} />
            <div className="training-params">
              {PARAMS.map(([name, title]) => {
                const p = board.params[name];
                return (
                  p && (
                    <label key={name} className="training-param" data-param={name}>
                      <span className="grow">{t(title)}</span>
                      <ParamInput p={p} width={90} />
                      <span className="hint">{p.units}</span>
                    </label>
                  )
                );
              })}
              <p className="hint">{t("0 — этого предела нет. Пропал GPS: RETURN — домой (без GPS — по своим датчикам), LAND — сесть, WARN — только надпись.")}</p>
            </div>
          </div>
          {notes.map((n) => (
            <p key={n.text} className={`hint${n.warn ? " warn-text" : ""}`}>
              {t(n.text)}
            </p>
          ))}
          {osdFix.length > 0 && (
            <button className="btn small" disabled={armed} onClick={() => send(osdFix)}>
              {t("Показать радар в очках")}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Круг сверху (север вверх) с точкой коптера и радар, как в очках. */
function GeofencePicture({ v }: { v: GeofenceView }) {
  const now = geofenceNow(useCopterLive());
  const R = 54;
  const cx = 70;
  const cy = 70;
  const k = v.radius > 0 ? R / v.radius : 0;
  const flying = now?.dist != null && now.dir != null && v.radius > 0;
  const dot = flying
    ? (() => {
        const r = Math.min(R * 1.15, now!.dist! * k);
        const a = ((now!.dir! + 180) * Math.PI) / 180;
        return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
      })()
    : null;
  // радар: в полёте — как сейчас в очках; на земле — пример: коптер в 60 % радиуса, носом от дома
  const map = v.radius > 0 ? (flying ? fenceMap(v.radius, now!.dist!, now!.dir! - now!.hdg) : fenceMap(v.radius, 0.6 * v.radius, 180)) : null;
  return (
    <div className="geofence-pictures">
      <svg viewBox="0 0 140 140" className="geofence-svg" role="img" aria-label={t("Геозабор сверху")}>
        {v.radius > 0 ? (
          <>
            <circle cx={cx} cy={cy} r={R} className="training-fence" />
            <circle cx={cx} cy={cy} r={R * 0.8} className="training-release" />
            <circle cx={cx} cy={cy} r={4} className="rescue-home" />
            <text x={cx} y={cy - R - 4} className="rescue-label" textAnchor="middle">
              {t("{m} м", { m: v.radius })}
            </text>
          </>
        ) : (
          <text x={cx} y={cy} className="rescue-label" textAnchor="middle">
            {t("круга нет")}
          </text>
        )}
        {dot && <circle cx={dot.x} cy={dot.y} r={5} className="rescue-copter" />}
        {now?.flag && (
          <text x={cx} y={136} className="training-flag" textAnchor="middle">
            {now.flag}
          </text>
        )}
      </svg>
      {map && (
        <figure className="geofence-osd" aria-label={t("Радар в очках")}>
          <pre data-testid="geofence-osd">{map.join("\n")}</pre>
          <figcaption className="hint">
            {flying && now?.margin != null ? t("в очках сейчас, до края {m} м", { m: Math.round(now.margin) }) : t("так в очках: ^ — вы, H — дом, точки — край")}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
