// 7. Рули: стик в сторону — «руль пошёл так?». «Нет» переворачивает ровно
// один флаг блока «Реверс» (Config.h) — без перепайки и микшеров в пульте.
// Плата показывает, что команда дошла до выхода: пилот смотрит только на руль.

import { ArrowRight, Check, CircleCheck, RotateCcw, TriangleAlert, X, Zap } from "lucide-react";
import { useState } from "react";

import { LiveFrame } from "../../../api";
import { channelIndex, toggleFlag } from "../../../core/channels";
import { bindingText, channelTitle, itemLabel } from "../../../core/labels";
import { Manifest } from "../../../core/manifest";
import { effectiveParam, PlaneProject } from "../../../core/project";
import { haveTokens } from "../../../core/rules";
import { runFlash } from "../../../flash";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { useLive } from "../../live/LiveWidgets";
import { usePassed, when } from "./common";

interface SurfaceTask {
  id: string;
  title: string;
  /** что сделать стиком или тумблером */
  doText: string;
  /** вопрос: так ли пошёл руль */
  ask: string;
  /** флаг реверса, который переворачивает «нет»; null — дело не в флаге */
  flag: string | null;
  /** выход платы, на котором видно команду (индекс в out) */
  out: number | null;
  /** команда дана? (стик отклонён, функция включена) */
  ready: (live: LiveFrame) => boolean;
  /** плата видит стик в обратную сторону — канал наоборот, а не руль */
  wrong?: (live: LiveFrame) => boolean;
  /** если «нет», а флага нет */
  noHelp?: string;
}

function switchFor(project: PlaneProject, feature: string): string | null {
  const b = project.bindings.find((x) => x.kind === "feature" && x.feature === feature);
  return b ? channelTitle(b.channel) : null;
}

function manualHow(manifest: Manifest, project: PlaneProject): string {
  const b = project.bindings.find(
    (x) => (x.kind === "modes" && x.modes.includes("MODE_MANUAL")) || (x.kind === "mode" && x.mode === "MODE_MANUAL"),
  );
  return b ? bindingText(manifest, b) : t("MANUAL — режим по умолчанию без тумблера режимов");
}

export function surfaceTasks(manifest: Manifest, project: PlaneProject): SurfaceTask[] {
  const idx = (name: string) => channelIndex(manifest, project, name);
  const have = haveTokens(manifest, project);
  const a = project.airframe;
  const tasks: SurfaceTask[] = [];
  const rollRight = (l: LiveFrame) => l.ch[idx("AILERON")] > 1800;
  const rollLeft = (l: LiveFrame) => l.ch[idx("AILERON")] < 1200;
  if (a.ailerons === "two") {
    tasks.push({
      id: "ail-l",
      title: t("Левый элерон"),
      doText: t("Правый стик ВПРАВО до упора и держите"),
      ask: t("Левый элерон пошёл ВНИЗ?"),
      flag: "AILERON_LEFT_REVERSED",
      out: 0,
      ready: rollRight,
      wrong: rollLeft,
    });
    tasks.push({
      id: "ail-r",
      title: t("Правый элерон"),
      doText: t("Правый стик ВПРАВО до упора и держите"),
      ask: t("Правый элерон пошёл ВВЕРХ?"),
      flag: "AILERON_RIGHT_REVERSED",
      out: 1,
      ready: rollRight,
      wrong: rollLeft,
    });
  } else {
    tasks.push({
      id: "ail",
      title: t("Элероны (одна серва)"),
      doText: t("Правый стик ВПРАВО до упора и держите"),
      ask: t("Правый элерон пошёл ВВЕРХ, левый ВНИЗ?"),
      flag: "AILERON_LEFT_REVERSED",
      out: 0,
      ready: rollRight,
      wrong: rollLeft,
    });
  }
  tasks.push({
    id: "elev",
    title: t("Руль высоты"),
    doText: t("Правый стик НА СЕБЯ (вниз) до упора и держите"),
    ask: t("Руль высоты пошёл ВВЕРХ?"),
    flag: "ELEVATOR_REVERSED",
    out: 2,
    ready: (l) => l.ch[idx("ELEVATOR")] < 1200,
    wrong: (l) => l.ch[idx("ELEVATOR")] > 1800,
  });
  if (have.rudder) {
    tasks.push({
      id: "rud",
      title: t("Руль направления"),
      doText: t("Левый стик ВПРАВО до упора и держите"),
      ask: a.gear !== "none" ? t("Руль направления пошёл ВПРАВО (смотрим сзади)? Колесо — тоже вправо?") : t("Руль направления пошёл ВПРАВО (смотрим сзади)?"),
      flag: "RUDDER_REVERSED",
      out: 3,
      ready: (l) => l.ch[idx("RUDDER")] > 1800,
      wrong: (l) => l.ch[idx("RUDDER")] < 1200,
    });
  }
  const flapsSw = have.flaperons ? switchFor(project, "FLAPS") : null;
  if (flapsSw) {
    tasks.push({
      id: "flaps",
      title: t("Закрылки"),
      doText: t("{sw} вниз — закрылки выпускаются за секунду", { sw: flapsSw }),
      ask: t("Оба элерона пошли ВНИЗ?"),
      flag: "FLAPS_REVERSED",
      out: null,
      ready: (l) => l.feat.includes("FLAPS"),
    });
  }
  const dropSw = have.aux1 ? switchFor(project, "PAYLOAD_DROP") : null;
  if (dropSw) {
    tasks.push({
      id: "drop",
      title: t("Сброс груза"),
      doText: t("{sw} вниз — сброс", { sw: dropSw }),
      ask: t("Замок груза открылся?"),
      flag: "AUX1_REVERSED",
      out: 5,
      ready: (l) => l.feat.includes("PAYLOAD_DROP"),
    });
  }
  const stab = project.bindings.some(
    (b) => (b.kind === "modes" && b.modes.includes("MODE_STABILIZE")) || (b.kind === "mode" && b.mode === "MODE_STABILIZE"),
  );
  if (stab) {
    tasks.push({
      id: "stab",
      title: t("Стабилизация"),
      doText: t("Включите STABILIZE, стики не трогайте, наклоните самолёт на ПРАВОЕ крыло"),
      ask: t("Правый элерон пошёл ВНИЗ — самолёт «хочет» выровняться?"),
      flag: null,
      out: 1,
      ready: (l) => l.mode === "STABILIZE" && (l.att?.[0] ?? 0) > 15,
      noHelp: t("Рули от стиков ходят верно, а стабилизация — нет: плата не знает, как стоит в самолёте. Повторите «Установку IMU» тремя позами."),
    });
  }
  return tasks;
}

export function SurfacesCheck() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const live = useLive();
  const { record, pass, reset } = usePassed("surfaces");
  const tasks = surfaceTasks(manifest, plane);
  const [at, setAt] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, "yes" | "fixed" | "no">>({});
  const task = at >= 0 ? tasks[at] : null;
  const fixed = tasks.filter((x) => answers[x.id] === "fixed");
  const finished = at >= tasks.length;

  const answer = (yes: boolean) => {
    if (!task) return;
    if (!yes && task.flag) {
      updatePlane((p) => toggleFlag(manifest, p, task.flag!));
    }
    const next = { ...answers, [task.id]: yes ? ("yes" as const) : task.flag ? ("fixed" as const) : ("no" as const) };
    setAnswers(next);
    if (!yes && !task.flag) return; // подсказка остаётся на экране
    const n = at + 1;
    setAt(n);
    if (n >= tasks.length && !Object.values(next).some((v) => v !== "yes")) pass();
  };

  const ready = !!(live && task && task.ready(live));
  const manual = live?.mode === "MANUAL";

  return (
    <>
      <p className="check-lead">
        {t("Винт снят, батарея подключена. Режим — MANUAL ({how}). Стиком в сторону — смотрите на руль и отвечайте «так» или «нет». «Нет» переворачивает только этот руль.", {
          how: manualHow(manifest, plane),
        })}
      </p>

      {at < 0 && (
        <div className="row">
          <button className="btn primary" disabled={!live || live.rx !== "ok"} onClick={() => { setAnswers({}); setAt(0); }}>
            {record ? <RotateCcw size={15} /> : <ArrowRight size={15} />}
            {record ? t("Проверить снова") : t("Начать")}
          </button>
          {!live && <span className="hint">{t("нужна связь с платой")}</span>}
          {record && <span className="hint">{t("пройдена {when}", { when: when(record.at) })}</span>}
        </div>
      )}

      {task && (
        <div className="task">
          <div className="task-step">
            {t("{n} из {m}", { n: at + 1, m: tasks.length })} · {task.title}
          </div>
          {task.id !== "stab" && live && !manual && (
            <div className="issue warning">
              <TriangleAlert size={16} color="var(--warn)" />
              <div className="grow">{t("Сейчас {m} — рули двигает ещё и стабилизация. Переключите в MANUAL: {how}.", { m: live.mode, how: manualHow(manifest, plane) })}</div>
            </div>
          )}
          <div className="task-text">{task.doText}</div>
          <div className="row" style={{ gap: 10, margin: "6px 0 10px" }}>
            <span className={`badge ${ready ? "ok" : ""}`}>{ready ? t("команда дана") : t("жду команду…")}</span>
            {live && task.out !== null && <span className="hint mono">{t("выход платы: {v} мкс", { v: live.out[task.out] })}</span>}
          </div>
          {live && task.wrong?.(live) && (
            <div className="issue warning">
              <TriangleAlert size={16} color="var(--warn)" />
              <div className="grow">{t("Плата видит стик в обратную сторону: канал пульта наоборот. Сначала проверка «Пульт» — там это чинится, а не реверсом руля.")}</div>
            </div>
          )}
          <div className="task-ask">{task.ask}</div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" disabled={!ready} onClick={() => answer(true)}>
              <Check size={15} />
              {t("Да, так")}
            </button>
            <button className="btn" disabled={!ready} onClick={() => answer(false)}>
              <X size={15} />
              {task.flag ? t("Нет, наоборот") : t("Нет")}
            </button>
            <button className="btn small ghost" onClick={() => setAt(at + 1)}>
              {t("Пропустить")}
            </button>
          </div>
          {answers[task.id] === "no" && task.noHelp && (
            <div className="issue warning" style={{ marginTop: 10 }}>
              <TriangleAlert size={16} color="var(--warn)" />
              <div className="grow">{task.noHelp}</div>
            </div>
          )}
        </div>
      )}

      {finished && (
        <div className="task">
          {fixed.length ? (
            <>
              <div className="issue warning">
                <TriangleAlert size={16} color="var(--warn)" />
                <div className="grow">
                  {t("Перевёрнуто в проекте: {list}. Заработает после прошивки — потом пройдите проверку ещё раз.", {
                    list: fixed.map((x) => x.title.toLowerCase()).join(", "),
                  })}
                </div>
              </div>
              <button className="btn primary" onClick={() => void runFlash(plane.id)}>
                <Zap size={15} />
                {t("Прошить с исправлениями")}
              </button>
            </>
          ) : (
            <div className="issue">
              <CircleCheck size={16} color="var(--ok)" />
              <div className="grow">{t("Все рули ходят в нужную сторону — и от стиков, и от автопилота.")}</div>
            </div>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small ghost" onClick={() => { setAt(-1); reset(); }}>
              {t("Пройти заново")}
            </button>
          </div>
        </div>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        {t("Сейчас в проекте перевёрнуты: {list}", {
          list:
            ["AILERON_LEFT_REVERSED", "AILERON_RIGHT_REVERSED", "ELEVATOR_REVERSED", "RUDDER_REVERSED", "FLAPS_REVERSED", "AUX1_REVERSED"]
              .filter((f) => effectiveParam(manifest, plane, f) === true)
              .map((f) => itemLabelForFlag(f))
              .join(", ") || t("ничего"),
        })}
      </div>
    </>
  );
}

function itemLabelForFlag(flag: string): string {
  const map: Record<string, string> = {
    AILERON_LEFT_REVERSED: t("левый элерон"),
    AILERON_RIGHT_REVERSED: t("правый элерон"),
    ELEVATOR_REVERSED: t("руль высоты"),
    RUDDER_REVERSED: t("руль направления"),
    FLAPS_REVERSED: t("закрылки"),
    AUX1_REVERSED: itemLabel("feature", "PAYLOAD_DROP").toLowerCase(),
  };
  return map[flag] ?? flag;
}
