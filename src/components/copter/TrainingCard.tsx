// «Учебные ограничения» (P09): включить галочкой, набор пределов одной
// кнопкой, числа — строками настроек; картинка — круг сверху и потолок
// сбоку, в полёте на ней точка коптера и что сейчас держит прошивка.

import { GraduationCap } from "lucide-react";

import { ParamValue } from "../../core/copterParams";
import { profileOf } from "../../core/pilot";
import { TRAINING_PRESETS, trainingCommands, trainingNotes, trainingNow, trainingOf, trainingPresetOf, trainingRecommended, TrainingView } from "../../core/training";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { ParamInput, useCopterBoard, useCopterLink, useCopterLive } from "./common";

// пределы: настройка и как её зовут словами (имя BF — во всплывающей подсказке поля)
const LIMITS: [string, string][] = [
  ["training_max_alt", N_("Потолок")],
  ["training_max_dist", N_("Круг от дома")],
  ["training_max_angle", N_("Наклон в ANGLE")],
  ["training_max_speed", N_("Скорость")],
];

function send(cmds: [string, ParamValue][]) {
  const set = useApp.getState().copterSet;
  for (const [name, v] of cmds) void set(name, v);
}

export function TrainingCard() {
  const board = useCopterBoard();
  const { armed } = useCopterLink();
  const live = useCopterLive();
  const settings = useApp((s) => s.settings);
  const v = trainingOf(board);
  if (!v) return null;
  const recommended = trainingRecommended(profileOf(settings));
  const preset = trainingPresetOf(v);
  const notes = trainingNotes(v, board, live);
  return (
    <div className="card wide training-card" data-testid="training-card">
      <div className="row" style={{ gap: 10 }}>
        <GraduationCap size={18} />
        <h3 className="grow" style={{ margin: 0 }}>
          {t("Учебные ограничения")}
        </h3>
        <label className="row" style={{ gap: 6 }} data-param="training_limits">
          <input type="checkbox" checked={v.on} disabled={armed} onChange={(e) => send(trainingCommands(e.target.checked))} />
          {v.on ? t("включены") : t("выключены")}
        </label>
      </div>
      <p className="sub">{t("Коптер не пустит выше потолка и дальше круга от дома, не даст сильно наклониться и разогнаться в ANGLE. За пределом — мягко назад и надпись в очках.")}</p>
      {!v.on && recommended && (
        <div className="training-offer">
          <span className="grow">{t("Вы учитесь — рекомендуем включить: первые полёты без улёта и потери коптера.")}</span>
          <button className="btn primary small" disabled={armed} onClick={() => send(trainingCommands(true))}>
            {t("Включить")}
          </button>
        </div>
      )}
      {v.on && (
        <>
          <div className="seg training-presets">
            {TRAINING_PRESETS.map((p) => (
              <button key={p.id} className={preset === p.id ? "on" : ""} disabled={armed} title={t(p.desc)} onClick={() => send(trainingCommands(true, p.values).slice(1))}>
                {t(p.title)}
              </button>
            ))}
          </div>
          <div className="training-body">
            <TrainingPicture v={v} />
            <div className="training-params">
              {LIMITS.map(([name, title]) => {
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
              <p className="hint">{t("0 — этого предела нет.")}</p>
            </div>
          </div>
          {notes.map((n) => (
            <p key={n.text} className={`hint${n.warn ? " warn-text" : ""}`}>
              {t(n.text)}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

/** Круг сверху и потолок сбоку; в полёте — где коптер и что держит. */
function TrainingPicture({ v }: { v: TrainingView }) {
  const now = trainingNow(useCopterLive());
  const R = 54;
  const cx = 70;
  const cy = 70;
  const dist = v.dist > 0 ? v.dist : 0;
  const k = dist > 0 ? R / dist : 0;
  // коптер сверху: dir — направление на дом, коптер — с обратной стороны
  const dot =
    now?.dist != null && now.dir != null && dist > 0
      ? (() => {
          const r = Math.min(R * 1.15, now.dist * k);
          const a = ((now.dir + 180) * Math.PI) / 180;
          return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) };
        })()
      : null;
  // сбоку: высота до потолка (+20 %)
  const top = v.alt > 0 ? v.alt * 1.2 : 0;
  const hy = (h: number) => 130 - (Math.max(0, Math.min(top, h)) / (top || 1)) * 110;
  return (
    <svg viewBox="0 0 260 140" className="training-svg" role="img" aria-label={t("Учебные пределы")}>
      {dist > 0 ? (
        <>
          <circle cx={cx} cy={cy} r={R} className="training-fence" />
          <circle cx={cx} cy={cy} r={R * 0.9} className="training-warn" />
          <circle cx={cx} cy={cy} r={R * 0.8} className="training-release" />
          <circle cx={cx} cy={cy} r={4} className="rescue-home" />
          <text x={cx} y={cy - R - 4} className="rescue-label" textAnchor="middle">
            {t("{m} м", { m: dist })}
          </text>
        </>
      ) : (
        <text x={cx} y={cy} className="rescue-label" textAnchor="middle">
          {t("круга нет")}
        </text>
      )}
      {dot && <circle cx={dot.x} cy={dot.y} r={5} className="rescue-copter" />}
      <line x1={160} x2={250} y1={130} y2={130} className="rescue-ground" />
      {v.alt > 0 ? (
        <>
          <line x1={160} x2={250} y1={hy(v.alt)} y2={hy(v.alt)} className="training-ceiling" />
          <text x={205} y={hy(v.alt) - 5} className="rescue-label" textAnchor="middle">
            {t("потолок {m} м", { m: v.alt })}
          </text>
          {now && <circle cx={205} cy={hy(now.alt)} r={5} className="rescue-copter" />}
        </>
      ) : (
        <text x={205} y={80} className="rescue-label" textAnchor="middle">
          {t("потолка нет")}
        </text>
      )}
      {now?.flag && (
        <text x={130} y={14} className="training-flag" textAnchor="middle">
          {now.flag}
        </text>
      )}
    </svg>
  );
}
