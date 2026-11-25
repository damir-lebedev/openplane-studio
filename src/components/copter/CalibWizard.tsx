// Окно калибровки (P62): шаги с картинкой позы и ответ платы прямо в окне —
// раньше подсказки и ответ были под карточкой, и их не сразу находили.
// Разбор ответа — core/calibWizard.ts.

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorText } from "../../api";
import { CALIB_STEPS, CALIB_TITLES, CalibKey, CalibPose, calibProgress, linesSince } from "../../core/calibWizard";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Modal } from "../ui";

export function CalibWizard({ calib, onClose }: { calib: CalibKey; onClose: () => void }) {
  const lines = useApp((s) => s.consoleLines);
  const seq = useApp((s) => s.consoleSeq);
  const [start, setStart] = useState<{ seq: number; at: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [sendErr, setSendErr] = useState("");
  const sent = useRef(false);

  const begin = async () => {
    setSendErr("");
    setStart({ seq: useApp.getState().consoleSeq, at: Date.now() });
    try {
      await api.linkSend(calib);
    } catch (e) {
      setSendErr(errorText(e));
    }
  };
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const fresh = start ? linesSince(lines, seq, start.seq) : [];
  const p = sendErr
    ? { step: 0, passed: 0, state: "failed" as const, message: sendErr, tone: "err" as const }
    : calibProgress(calib, fresh, start ? now - start.at : 0);
  const steps = CALIB_STEPS[calib];
  const step = steps[Math.min(p.step, steps.length - 1)];
  const finished = p.state === "done" || p.state === "failed";

  return (
    <Modal onClose={onClose} width={640}>
      <h2>{t(CALIB_TITLES[calib])}</h2>
      {steps.length > 1 && (
        <ol className="calib-steps">
          {steps.map((s, i) => (
            <li key={s.pose} className={i < p.passed ? "done" : i === p.step && !finished ? "active" : ""}>
              <span className="num">{i < p.passed ? <CircleCheck size={14} /> : i + 1}</span>
              {t(s.title)}
            </li>
          ))}
        </ol>
      )}
      <div className="calib-wizard">
        <PosePicture pose={p.state === "done" ? "level" : step.pose} />
        <div className="grow">
          <h3 style={{ marginTop: 0 }}>{p.state === "done" ? t("Готово") : t(step.title)}</h3>
          {p.state !== "done" && <p>{t(step.text)}</p>}
          <p className={`calib-state ${p.tone ?? ""}`}>
            {p.state === "wait" && (
              <>
                <Loader2 size={16} className="spin" /> {t("Жду ответа платы…")}
              </>
            )}
            {p.state === "running" && (
              <>
                <Loader2 size={16} className="spin" /> {p.tone === "warn" ? p.message : t("Плата меряет…")}
              </>
            )}
            {p.state === "done" && (
              <>
                <CircleCheck size={16} /> {p.message}
              </>
            )}
            {p.state === "failed" && (
              <>
                <CircleAlert size={16} /> {t(p.message ?? "")}
              </>
            )}
          </p>
          {calib === "o" && !finished && <p className="hint">{t("Каждую позу плата ждёт до 30 с; не дождалась — калибровка отменяется, прежняя остаётся.")}</p>}
        </div>
      </div>
      <div className="cli console-tail">
        {fresh.slice(-8).map((l, i) => (
          <div key={i} className="mono">
            {l}
          </div>
        ))}
        {!fresh.length && <div className="hint">{t("Ответы платы появятся здесь.")}</div>}
      </div>
      <div className="modal-actions">
        {p.state === "failed" && (
          <button className="btn" onClick={() => void begin()}>
            {t("Ещё раз")}
          </button>
        )}
        <button className={finished ? "btn primary" : "btn ghost"} onClick={onClose}>
          {finished ? t("Готово") : t("Закрыть")}
        </button>
      </div>
    </Modal>
  );
}

/** Коптер в позе шага: сбоку (ровно, нос вверх) или сзади (правый борт вниз). */
export function PosePicture({ pose }: { pose: CalibPose }) {
  const rear = pose === "rightDown";
  const angle = pose === "noseUp" ? -40 : rear ? 40 : 0;
  const label = rear ? t("вид сзади") : t("вид сбоку");
  return (
    <svg className="pose-pic" width={200} height={150} viewBox="-100 -80 200 150" role="img" aria-label={label} data-pose={pose}>
      <line x1={-90} y1={50} x2={90} y2={50} stroke="currentColor" strokeOpacity={0.25} strokeWidth={2} />
      {angle !== 0 && <Quad rear={rear} ghost />}
      <g transform={`rotate(${angle})`} style={{ transition: "transform .4s" }}>
        <Quad rear={rear} />
      </g>
      {angle !== 0 && (
        <path
          d={rear ? "M70 -14 A72 72 0 0 1 58 30" : "M70 14 A72 72 0 0 0 58 -30"}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          markerEnd="url(#pose-arrow)"
        />
      )}
      <defs>
        <marker id="pose-arrow" viewBox="0 0 10 10" refX={5} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
        </marker>
      </defs>
      <text x={-90} y={66} fontSize={10} fill="currentColor" opacity={0.6}>
        {label}
      </text>
      {!rear && (
        <text x={90} y={66} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.6}>
          {t("нос")} →
        </text>
      )}
      {rear && (
        <text x={90} y={66} fontSize={10} textAnchor="end" fill="currentColor" opacity={0.6}>
          {t("правый борт")} →
        </text>
      )}
      {pose === "still" && (
        <text x={0} y={-58} fontSize={11} textAnchor="middle" fill="var(--accent)">
          {t("не трогать")}
        </text>
      )}
    </svg>
  );
}

/** Рама: лучи, моторы с винтами, корпус с батареей сверху; сбоку — камера на носу (справа). */
function Quad({ rear, ghost }: { rear: boolean; ghost?: boolean }) {
  const c = ghost ? "currentColor" : "var(--accent)";
  return (
    <g opacity={ghost ? 0.18 : 1} stroke={c} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1={-60} y1={2} x2={60} y2={2} strokeWidth={5} />
      <rect x={-20} y={-6} width={40} height={14} rx={3} fill={c} fillOpacity={0.15} />
      <rect x={-16} y={-20} width={32} height={12} rx={3} fill={c} fillOpacity={0.3} />
      {[-58, 58].map((x) => (
        <g key={x}>
          <rect x={x - 7} y={-9} width={14} height={9} rx={2} fill={c} fillOpacity={0.4} />
          <line x1={x} y1={-9} x2={x} y2={-14} />
          <ellipse cx={x} cy={-15} rx={30} ry={2.5} fill={c} fillOpacity={0.25} strokeWidth={1.5} />
        </g>
      ))}
      {!rear && <path d="M20 -2 h9 l3 6 h-12 z" fill={c} fillOpacity={0.6} />}
      {rear && <circle cx={0} cy={1} r={4} fill={c} fillOpacity={0.6} />}
    </g>
  );
}
