// 8. Мотор: винт снят → ARM → чуть газа → крутится ли в нужную сторону.
// Не туда: двунаправленный регулятор — флаг MOTOR_REVERSED, обычный —
// настройка самого регулятора (провода не перепаиваем).

import { Check, CircleCheck, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

import { toggleFlag } from "../../../core/channels";
import { setParamValue } from "../../../core/params";
import { effectiveParam } from "../../../core/project";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { useLive } from "../../live/LiveWidgets";
import { Seg, Toggle } from "../../ui";
import { usePassed, when } from "./common";

export function MotorCheck() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const live = useLive();
  const { record, pass } = usePassed("motor");
  const [propOff, setPropOff] = useState(false);
  const [prop, setProp] = useState<"normal" | "pusher">("normal");
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const bidirectional = plane.airframe.esc === "bidirectional";
  const armed = !!live?.arm;
  const spinning = !!live && live.arm && live.out[4] > 1080;
  const ccwFromNose = prop === "normal";

  useEffect(() => {
    if (!propOff) setAnswer(null);
  }, [propOff]);

  const say = (yes: boolean) => {
    setAnswer(yes ? "yes" : "no");
    if (yes) pass(prop === "pusher" ? t("винт P") : t("обычный винт"));
    else if (bidirectional) updatePlane((p) => toggleFlag(manifest, p, "MOTOR_REVERSED"));
  };

  return (
    <>
      <p className="check-lead">
        {t("Только без винта: мотор закрутится по-настоящему. Наклейте на колокол мотора кусочек скотча — так видно, куда он крутится.")}
      </p>
      <div className="card row" style={{ padding: "12px 14px", marginBottom: 10 }}>
        <div className="grow">
          <b>{t("Винт снят")}</b>
          <div className="hint">{t("Без этой галочки дальше нельзя.")}</div>
        </div>
        <Toggle on={propOff} onChange={setPropOff} />
      </div>

      {propOff && (
        <div className="task">
          <div className={`task-line${armed ? " done" : ""}`}>
            {armed ? <CircleCheck size={16} color="var(--ok)" /> : <span className="task-dot">1</span>}
            {t("Заармьте: газ вниз, SwA вниз")}
            {!armed && live?.block && <span className="hint"> — {t("не выйдет: {r}", { r: live.block })}</span>}
          </div>
          <div className={`task-line${spinning ? " done" : ""}`}>
            {spinning ? <CircleCheck size={16} color="var(--ok)" /> : <span className="task-dot">2</span>}
            {t("Чуть-чуть газа — 10–15 %")}
            {live?.arm && <span className="hint mono"> {t("газ на выходе: {v} мкс", { v: live.out[4] })}</span>}
          </div>
          <div className="task-line">
            <span className="task-dot">3</span>
            <span>{t("Какой винт будет стоять?")}</span>
            <Seg
              value={prop}
              onChange={setProp}
              options={[
                { value: "normal", label: t("Обычный") },
                { value: "pusher", label: t("С буквой P") },
              ]}
            />
          </div>
          <div className="task-ask" style={{ marginTop: 10 }}>
            {ccwFromNose
              ? t("Смотрите на мотор спереди, с носа самолёта: крутится ПРОТИВ часовой стрелки? (сзади — по часовой)")
              : t("Смотрите на мотор спереди, с носа самолёта: крутится ПО часовой стрелке? (сзади — против)")}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={!spinning} onClick={() => say(true)}>
              <Check size={15} />
              {t("Да, так")}
            </button>
            <button className="btn" disabled={!spinning} onClick={() => say(false)}>
              <X size={15} />
              {t("Нет, наоборот")}
            </button>
          </div>
          {answer === "no" &&
            (bidirectional ? (
              <div className="issue warning" style={{ marginTop: 10 }}>
                <TriangleAlert size={16} color="var(--warn)" />
                <div className="grow">{t("Направление мотора перевёрнуто в проекте (MOTOR_REVERSED) — заработает после прошивки.")}</div>
              </div>
            ) : (
              <div className="issue warning" style={{ marginTop: 10 }}>
                <TriangleAlert size={16} color="var(--warn)" />
                <div className="grow">
                  {t("У обычного регулятора направление меняется в нём самом: esc-configurator.com (BLHeli_S, Bluejay, AM32) или BLHeliSuite32 → Motor Direction → Reversed. Или карта программирования регулятора.")}
                </div>
              </div>
            ))}
          {answer === "yes" && (
            <div className="issue" style={{ marginTop: 10 }}>
              <CircleCheck size={16} color="var(--ok)" />
              <div className="grow">{t("Мотор крутится правильно. Снимите ARM: SwA вверх.")}</div>
            </div>
          )}
        </div>
      )}
      {record && !propOff && (
        <p className="hint">
          <RotateCcw size={12} /> {t("пройдена {when} ({note})", { when: when(record.at), note: record.note ?? "" })}
        </p>
      )}
    </>
  );
}

const BENCH_PCT = 30;

/** Режим стенда: газ ограничен, пока не снимут; плашка — в шапке платы. */
export function BenchCard() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const limit = Number(effectiveParam(manifest, plane, "THROTTLE_LIMIT_PCT") ?? 100);
  const on = limit < 100;
  const set = (v: boolean) => updatePlane((p) => setParamValue(manifest, p, "THROTTLE_LIMIT_PCT", v ? BENCH_PCT : 100));
  return (
    <div className="card row bench-card">
      <div className="grow">
        <b>{t("Режим стенда")}</b>
        <div className="hint">
          {on
            ? t("Газ не больше {p} %. Перед полётом снимите и перепрошейте — пока не снят, наверху висит плашка.", { p: limit })
            : t("Для первых включений на столе: полный газ стиком даст только {p} %.", { p: BENCH_PCT })}
        </div>
      </div>
      <Toggle on={on} onChange={set} />
    </div>
  );
}
