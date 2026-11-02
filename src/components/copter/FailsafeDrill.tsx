// Тренировка failsafe на земле (P12): шаги по живым кадрам, итог — отметка
// «проверено» в проекте коптера (её видит «Перед полётом»).

import { CircleCheck, CircleX, LifeBuoy } from "lucide-react";
import { useEffect, useState } from "react";

import { drillFeed, drillHint, drillReactionMs, drillStart, type DrillState } from "../../core/failsafeDrill";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { useCopterBoard, useCopterLive } from "./common";

const STEPS = [
  { id: "arm", title: "Заармить без винтов" },
  { id: "radioOff", title: "Выключить пульт" },
  { id: "radioOn", title: "Включить пульт" },
] as const;

export function FailsafeDrillCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const copter = useApp((s) => s.currentCopter());
  const updateCopter = useApp((s) => s.updateCopter);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const procedure = String(board.params.failsafe_procedure?.value ?? "AUTO-LAND");

  useEffect(() => {
    if (!drill || !live) return;
    const next = drillFeed(drill, live);
    if (next === drill) return;
    setDrill(next);
    if (next.step === "done" && copter) {
      updateCopter(copter.id, (c) => {
        c.failsafeCheckedAt = new Date().toISOString();
        c.failsafeCheckedProcedure = procedure;
      });
    }
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps

  const checked = copter?.failsafeCheckedAt;
  const order = STEPS.findIndex((x) => x.id === drill?.step);
  const finished = drill?.step === "done" || drill?.step === "failed";
  const reaction = drill ? drillReactionMs(drill) : undefined;
  return (
    <div className="card wide fs-drill">
      <h3>
        <LifeBuoy size={17} /> {t("Тренировка: выключи пульт")}
      </h3>
      <p className="sub">{t("Без винтов проверим, что прошивка выключает моторы, когда пропадает связь, и не армится сама, когда связь вернётся.")}</p>
      {checked && !drill && (
        <p className="hint ok-text">
          <CircleCheck size={15} /> {t("Проверено {date} (failsafe_procedure = {p})", { date: new Date(checked).toLocaleDateString(), p: copter?.failsafeCheckedProcedure ?? "?" })}
        </p>
      )}
      {drill && (
        <>
          <ol className="fs-drill-steps">
            {STEPS.map((x, i) => (
              <li key={x.id} className={drill.step === "done" || i < order ? "done" : i === order ? "now" : ""}>
                {t(x.title)}
              </li>
            ))}
          </ol>
          <p className={`hint${drill.step === "failed" ? " warn-text" : drill.step === "done" ? " ok-text" : ""}`}>
            {drill.step === "failed" ? <CircleX size={15} /> : drill.step === "done" ? <CircleCheck size={15} /> : null} {t(drillHint(drill))}
          </p>
          {reaction !== undefined && <p className="hint">{t("Моторы встали через {ms} мс после потери связи.", { ms: reaction })}</p>}
          {drill.step === "done" && procedure === "GPS-RESCUE" && !drill.homeAtArm && (
            <p className="hint warn-text">{t("Дом при ARM не записался (мало спутников) — в воздухе возврат домой не сработал бы. Перед полётом дождитесь GPS.")}</p>
          )}
        </>
      )}
      <button className="btn" disabled={!live || (!!drill && !finished)} onClick={() => setDrill(drillStart())}>
        {drill ? t("Пройти заново") : checked ? t("Проверить ещё раз") : t("Начать тренировку")}
      </button>
      {drill && !finished && (
        <button className="btn ghost" onClick={() => setDrill(null)}>
          {t("Отмена")}
        </button>
      )}
    </div>
  );
}
