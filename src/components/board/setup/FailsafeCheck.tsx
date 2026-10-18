// 3. Потеря связи: выключить пульт — плата должна это увидеть. FS-iA6B при
// потере связи не замолкает, а повторяет последние стики: без настройки
// failsafe в пульте самолёт улетит с последним газом.

import { CircleCheck, Power, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { channelIndex } from "../../../core/channels";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { useLive } from "../../live/LiveWidgets";
import { safetyStory } from "../steps/SafetyStep";
import { usePassed, when } from "./common";

const WAIT_MS = 8000;

export function FailsafeCheck() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const live = useLive();
  const { record, pass } = usePassed("failsafe");
  const [phase, setPhase] = useState<"idle" | "off" | "seen" | "missed" | "done">("idle");
  const [offAt, setOffAt] = useState(0);
  const [how, setHow] = useState<{ rx: string; thr: number } | null>(null);
  const [, tick] = useState(0);
  const thrIdx = channelIndex(manifest, plane, "THROTTLE");

  useEffect(() => {
    if (phase !== "off") return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!live) return;
    if (phase === "off") {
      if (live.rx !== "ok") {
        setHow({ rx: live.rx, thr: live.ch[thrIdx] });
        setPhase("seen");
      } else if (Date.now() - offAt > WAIT_MS) {
        setPhase("missed");
      }
    } else if (phase === "seen" && live.rx === "ok") {
      pass(how?.rx === "fs" ? t("приёмник шлёт газ {v} мкс", { v: how.thr }) : t("кадры пропадают"));
      setPhase("done");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, phase]);

  return (
    <>
      <p className="check-lead">
        {t("Винт снят. Выключите пульт — плата должна понять, что связи нет. Если не поймёт, в полёте самолёт продолжит лететь с последним газом.")}
      </p>
      <div className="card fs-story">
        <div className="drawer-sub">{t("Что сделает самолёт без связи")}</div>
        {safetyStory(manifest, plane).map((l, i) => (
          <div key={i} className="hint" style={{ padding: "2px 0" }}>
            {l}
          </div>
        ))}
      </div>

      {(phase === "idle" || phase === "done") && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="btn primary"
            disabled={!live || live.rx !== "ok"}
            onClick={() => {
              setOffAt(Date.now());
              setHow(null);
              setPhase("off");
            }}
          >
            {record ? <RotateCcw size={15} /> : <Power size={15} />}
            {t("Выключаю пульт")}
          </button>
          {!live && <span className="hint">{t("нужна связь с платой")}</span>}
          {live && live.rx !== "ok" && <span className="hint">{t("сначала включите пульт — сейчас связи нет")}</span>}
          {record && <span className="hint">{t("пройдена {when}: {note}", { when: when(record.at), note: record.note ?? "" })}</span>}
        </div>
      )}

      {phase === "off" && (
        <div className="task">
          <div className="task-text">{t("Выключите пульт")}</div>
          <p className="hint">{t("Жду, когда плата увидит потерю связи… {s} с", { s: Math.max(0, Math.ceil((WAIT_MS - (Date.now() - offAt)) / 1000)) })}</p>
        </div>
      )}

      {phase === "seen" && (
        <div className="task">
          <div className="issue">
            <CircleCheck size={16} color="var(--ok)" />
            <div className="grow">
              {how?.rx === "fs"
                ? t("Плата видит потерю связи: приёмник прислал газ {v} мкс — это и есть настроенный failsafe.", { v: how.thr })
                : t("Плата видит потерю связи: кадры от приёмника пропали.")}
            </div>
          </div>
          <div className="task-text">{t("Теперь включите пульт обратно")}</div>
        </div>
      )}

      {phase === "missed" && (
        <div className="task">
          <div className="issue error">
            <TriangleAlert size={16} color="var(--err)" />
            <div className="grow">
              {t("Пульт выключен, а плата всё ещё видит связь: приёмник повторяет последние стики. Настройте failsafe в пульте — один раз:")}
              <ol className="steps-list">
                <li>{t("Menu → Functions setup → End points → канал 3: нижнюю точку — 120 %. Сохранить долгим нажатием Cancel.")}</li>
                <li>{t("Газ — в самый низ.")}</li>
                <li>{t("Menu → Functions setup → Failsafe → Channel 3 → On (газ всё ещё внизу) → сохранить долгим Cancel. Приёмник запомнит ~900 мкс.")}</li>
                <li>{t("End points → канал 3: нижнюю точку обратно 100 %. Сохранить.")}</li>
              </ol>
            </div>
          </div>
          <button className="btn" onClick={() => setPhase("idle")}>
            <RotateCcw size={15} />
            {t("Проверить снова")}
          </button>
        </div>
      )}

      {phase === "done" && (
        <div className="issue" style={{ marginTop: 10 }}>
          <CircleCheck size={16} color="var(--ok)" />
          <div className="grow">{t("Failsafe работает: потеря связи ловится, связь вернулась — управление снова у стиков.")}</div>
        </div>
      )}
    </>
  );
}
