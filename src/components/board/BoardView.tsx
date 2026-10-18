import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Cpu, Gauge, History, Lock, Redo2, TriangleAlert, Undo2, Zap } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { itemLabel } from "../../core/labels";
import { findBoard, Manifest } from "../../core/manifest";
import { setParamValue } from "../../core/params";
import { effectiveParam, isReached, PlaneProject, StepId } from "../../core/project";
import { availability, countIssues, haveTokens, Issue, tokenNames, validate } from "../../core/rules";
import { runFlash } from "../../flash";
import { plural, t } from "../../i18n";
import { stepsFor, useApp } from "../../store";
import { PlaneView } from "../PlaneView";
import { Modal, Seg } from "../ui";
import { FlashDialog } from "./FlashDialog";
import { HistoryDialog } from "./HistoryDialog";
import { ParamsTable } from "./ParamsTable";
import { AirframeStep } from "./steps/AirframeStep";
import { BoardBadges, BoardStep } from "./steps/BoardStep";
import { SetupStep } from "./setup/SetupStep";
import { flashBlocker, IssueRow, ReviewStep } from "./steps/ReviewStep";
import { SafetyStep, safetyStory, SystemStep } from "./steps/SafetyStep";
import { SensorsStep } from "./steps/SensorsStep";
import { RcStep, SwitchesStep } from "./steps/SwitchesStep";

const STEP_TITLES: Record<StepId, string> = {
  board: "Плата",
  airframe: "Самолёт",
  sensors: "Датчики",
  rc: "Пульт",
  switches: "Тумблеры",
  safety: "Безопасность",
  system: "Система",
  review: "Проверка",
  setup: "Наладка",
};

const DEFAULT_FOCUS: Partial<Record<StepId, string[]>> = {
  board: ["board"],
  safety: ["gps"],
};

function Stepper({ issues }: { issues: Issue[] }) {
  const plane = useApp((s) => s.current())!;
  const step = useApp((s) => s.step);
  const mode = useApp((s) => s.mode);
  const boardTab = useApp((s) => s.boardTab);
  const setStep = useApp((s) => s.setStep);
  const steps = stepsFor(mode);
  return (
    <div className="stepper">
      {steps.map((s, i) => {
        const reached = isReached(plane, s);
        const active = boardTab === "wizard" && s === step;
        const hasErr = issues.some((x) => x.level === "error" && x.step === s);
        const prevStep = steps[i - 1];
        return (
          <Fragment key={s}>
            {i > 0 && <span className="step-sep" />}
            <button
              className={`step${active ? " active" : ""}${reached && !active ? " done" : ""}${!reached ? " locked" : ""}`}
              disabled={!reached}
              title={!reached ? t("Сначала — шаг «{s}»", { s: t(STEP_TITLES[prevStep]) }) : undefined}
              onClick={() => setStep(s)}
            >
              <span className="num">{!reached ? <Lock size={11} /> : i + 1}</span>
              {t(STEP_TITLES[s])}
              {hasErr && reached && <span className="dot-err" />}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

function SidePanel() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const step = useApp((s) => s.step);
  const focus = useApp((s) => s.focus);
  const board = findBoard(manifest, plane.board);
  const have = haveTokens(manifest, plane);
  const parts = focus.length ? focus : DEFAULT_FOCUS[step] ?? [];
  const modes = manifest.modes.map((m) => ({ m, av: availability(m, have) }));
  const okCount = modes.filter((x) => x.av.state !== "unavailable").length;

  return (
    <aside className="side">
      <div className="preview">
        <PlaneView plane={plane} focus={parts} />
      </div>
      {step === "board" && board && (
        <div className="side-block">
          <h4>{t("Плата")}</h4>
          <div className="row" style={{ gap: 8 }}>
            <Cpu size={16} color="var(--accent)" />
            <b>{board.title}</b>
          </div>
          <BoardBadges b={board} />
        </div>
      )}
      {(step === "sensors" || step === "switches" || step === "airframe" || step === "rc") && (
        <div className="side-block">
          <h4>{t("Режимы: доступно {a} из {b}", { a: okCount, b: modes.length })}</h4>
          {modes.map(({ m, av }) => (
            <div key={m.id} className="row" style={{ padding: "4px 0", alignItems: "flex-start" }}>
              {av.state === "ok" ? (
                <CircleCheck size={15} color="var(--ok)" />
              ) : av.state === "degraded" ? (
                <TriangleAlert size={15} color="var(--warn)" />
              ) : (
                <CircleAlert size={15} color="var(--text-3)" />
              )}
              <div className="grow" style={{ lineHeight: 1.3 }}>
                <span style={{ color: av.state === "unavailable" ? "var(--text-3)" : undefined }}>{itemLabel("mode", m.id)}</span>
                {av.state === "unavailable" && <div className="hint">{t("нужно: {l}", { l: tokenNames(manifest, av.missing) })}</div>}
                {av.state === "degraded" && <div className="hint">{t("лучше с: {l}", { l: tokenNames(manifest, av.better) })}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {(step === "safety" || step === "system") && (
        <div className="side-block">
          <h4>{t("Если что-то пойдёт не так")}</h4>
          {safetyStory(manifest, plane).map((l, i) => (
            <p key={i} className="muted" style={{ margin: "0 0 8px" }}>
              {l}
            </p>
          ))}
        </div>
      )}
    </aside>
  );
}

function StepBody() {
  const step = useApp((s) => s.step);
  switch (step) {
    case "board":
      return <BoardStep />;
    case "airframe":
      return <AirframeStep />;
    case "sensors":
      return <SensorsStep />;
    case "rc":
      return <RcStep />;
    case "switches":
      return <SwitchesStep />;
    case "safety":
      return <SafetyStep />;
    case "system":
      return <SystemStep />;
    case "review":
      return <ReviewStep />;
    case "setup":
      return <SetupStep />;
  }
}

function benchLimit(manifest: Manifest, plane: PlaneProject): number {
  const v = Number(effectiveParam(manifest, plane, "THROTTLE_LIMIT_PCT"));
  return Number.isFinite(v) ? v : 100;
}

export function BoardView() {
  const manifest = useApp((s) => s.manifest);
  const manifestError = useApp((s) => s.manifestError);
  const plane = useApp((s) => s.current());
  const step = useApp((s) => s.step);
  const mode = useApp((s) => s.mode);
  const boardTab = useApp((s) => s.boardTab);
  const flash = useApp((s) => s.flash);
  const setMode = useApp((s) => s.setMode);
  const setBoardTab = useApp((s) => s.setBoardTab);
  const setSection = useApp((s) => s.setSection);
  const setStep = useApp((s) => s.setStep);
  const nextStep = useApp((s) => s.nextStep);
  const prevStep = useApp((s) => s.prevStep);
  useApp((s) => s.info);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const updatePlane = useApp((s) => s.updatePlane);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);

  const issues = useMemo(() => (manifest && plane ? validate(manifest, plane) : []), [manifest, plane]);
  const counts = countIssues(issues);

  if (!manifest) {
    return (
      <div className="empty">
        <div>
          <Cpu size={44} color="var(--text-3)" />
          <h2>{t("Нет описания прошивки")}</h2>
          <p>{manifestError}</p>
          <button className="btn primary" onClick={() => setSection("settings")}>
            {t("Открыть настройки")}
          </button>
        </div>
      </div>
    );
  }
  if (!plane) {
    return (
      <div className="empty">
        <div>
          <Cpu size={44} color="var(--text-3)" />
          <h2>{t("Самолёт не выбран")}</h2>
          <p>{t("Выберите самолёт в ангаре или создайте новый.")}</p>
          <button className="btn primary" onClick={() => setSection("hangar")}>
            {t("В ангар")}
          </button>
        </div>
      </div>
    );
  }

  const steps = stepsFor(mode);
  const first = steps.indexOf(step) === 0;
  const last = steps.indexOf(step) === steps.length - 1;
  const blocker = flashBlocker();
  const showSide = boardTab === "wizard" && step !== "review" && step !== "setup";

  return (
    <div className="board">
      <div className="board-top">
        <h1>
          {t("Плата")} <span className="plane-name">· {plane.name}</span>
        </h1>
        <div className="grow" />
        <div className="row" style={{ gap: 2 }}>
          <button className="btn ghost small" disabled={!canUndo()} onClick={undo} title={t("Отменить (Ctrl+Z)")} aria-label={t("Отменить")}>
            <Undo2 size={16} />
          </button>
          <button className="btn ghost small" disabled={!canRedo()} onClick={redo} title={t("Повторить (Ctrl+Y)")} aria-label={t("Повторить")}>
            <Redo2 size={16} />
          </button>
          <button className="btn ghost small" onClick={() => setHistoryOpen(true)} title={t("История прошивок: что изменилось, вернуть как было")}>
            <History size={16} />
            {t("История")}
          </button>
        </div>
        {mode === "full" && (
          <Seg
            value={boardTab}
            onChange={setBoardTab}
            options={[
              { value: "wizard", label: t("По шагам") },
              { value: "params", label: t("Все параметры") },
            ]}
          />
        )}
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: "simple", label: t("Простой"), title: t("Только главное — остальное по умолчанию") },
            { value: "full", label: t("Полный"), title: t("Каждый параметр прошивки") },
          ]}
        />
        <button className="btn primary" disabled={!!blocker || !!flash?.running} title={blocker ?? undefined} onClick={() => void runFlash(plane.id)}>
          <Zap size={16} />
          {t("Прошить")}
        </button>
      </div>

      <Stepper issues={issues} />

      {benchLimit(manifest, plane) < 100 && (
        <div className="bench-banner">
          <Gauge size={16} />
          <span className="grow">
            {t("Режим стенда: газ не больше {p} %. Перед полётом снимите и перепрошейте.", { p: benchLimit(manifest, plane) })}
          </span>
          <button className="btn small" onClick={() => updatePlane((p) => setParamValue(manifest, p, "THROTTLE_LIMIT_PCT", 100))}>
            {t("Снять")}
          </button>
        </div>
      )}

      <div className={`board-body${showSide ? "" : " single"}`}>
        {boardTab === "params" ? (
          <ParamsTable />
        ) : (
          <div className="step-content" key={step}>
            <StepBody />
          </div>
        )}
        {showSide && <SidePanel />}
      </div>

      <div className="board-foot">
        <button className="issues-btn" onClick={() => setIssuesOpen(true)}>
          {counts.errors > 0 && (
            <span className="e">
              <CircleAlert size={14} /> {counts.errors} {plural(counts.errors, "ошибка", "ошибки", "ошибок")}
            </span>
          )}
          {counts.warnings > 0 && (
            <span className="w">
              <TriangleAlert size={14} /> {counts.warnings}
            </span>
          )}
          {counts.errors === 0 && counts.warnings === 0 && (
            <span className="okk">
              <CircleCheck size={14} /> {t("всё в порядке")}
            </span>
          )}
        </button>
        <div className="grow" />
        {boardTab === "wizard" && (
          <>
            <button className="btn" disabled={first} onClick={prevStep}>
              <ChevronLeft size={16} />
              {t("Назад")}
            </button>
            {!last && (
              <button className="btn primary" onClick={nextStep}>
                {t("Далее")}
                <ChevronRight size={16} />
              </button>
            )}
          </>
        )}
      </div>

      {issuesOpen && (
        <Modal onClose={() => setIssuesOpen(false)} width={640}>
          <h2>{t("Замечания")}</h2>
          {issues.length === 0 && <p className="muted">{t("Замечаний нет.")}</p>}
          {issues.map((i, n) => (
            <IssueRow
              key={n}
              issue={i}
              onGo={() => {
                setIssuesOpen(false);
                setStep(i.step === "review" ? "review" : i.step);
              }}
            />
          ))}
        </Modal>
      )}
      {flash && <FlashDialog />}
      {historyOpen && <HistoryDialog onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
