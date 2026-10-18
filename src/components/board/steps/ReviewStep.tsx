import { CircleAlert, CircleCheck, Info, TriangleAlert, Zap } from "lucide-react";

import { bindingText } from "../../../core/labels";
import { findBoard, SENSOR_CATEGORIES } from "../../../core/manifest";
import { sensorLabel } from "../../../core/project";
import { Issue, validate } from "../../../core/rules";
import { runFlash } from "../../../flash";
import { plural, t } from "../../../i18n";
import { useApp } from "../../../store";
import { Section, StepHead } from "../../ui";
import { safetyStory } from "./SafetyStep";

const STEP_NAMES: Record<string, string> = {
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

export function IssueRow({ issue, onGo }: { issue: Issue; onGo?: () => void }) {
  const icon =
    issue.level === "error" ? <CircleAlert size={17} color="var(--err)" /> :
    issue.level === "warning" ? <TriangleAlert size={17} color="var(--warn)" /> :
    <Info size={17} color="var(--info)" />;
  return (
    <div className={`issue ${issue.level}`}>
      {icon}
      <div className="grow">{issue.text}</div>
      {onGo && (
        <button className="btn small ghost" onClick={onGo}>
          {t(STEP_NAMES[issue.step] ?? issue.step)} →
        </button>
      )}
    </div>
  );
}

export function flashBlocker(): string | null {
  const s = useApp.getState();
  const plane = s.current();
  if (!s.manifest || !plane) return t("Нет описания прошивки");
  if (!s.info?.pio) return t("Не найден PlatformIO — поставьте его в «Настройках» одной кнопкой");
  const errors = validate(s.manifest, plane).filter((i) => i.level === "error").length;
  if (errors) return t("Исправьте {n} {w}", { n: errors, w: plural(errors, "ошибку", "ошибки", "ошибок") });
  return null;
}

export function ReviewStep() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const setStep = useApp((s) => s.setStep);
  useApp((s) => s.info);
  const issues = validate(manifest, plane);
  const errors = issues.filter((i) => i.level === "error");
  const board = findBoard(manifest, plane.board);
  const blocker = flashBlocker();

  return (
    <>
      <StepHead title={t("Проверка")}>
        {t("Что получится, простыми словами. Если всё зелёное — подключите плату по USB и нажмите «Прошить».")}
      </StepHead>

      {issues.length > 0 ? (
        <Section title={t("Замечания")} sub={errors.length ? t("ошибки не дают прошить") : t("прошить можно")}>
          {issues.map((i, n) => (
            <IssueRow key={n} issue={i} onGo={i.step !== "review" ? () => setStep(i.step) : undefined} />
          ))}
        </Section>
      ) : (
        <div className="issue" style={{ marginBottom: 22, borderColor: "rgba(63,185,80,.4)" }}>
          <CircleCheck size={17} color="var(--ok)" />
          <div className="grow">{t("Замечаний нет.")}</div>
        </div>
      )}

      <Section title={t("Самолёт")}>
        <div className="card kv">
          <span>{t("Плата")}</span>
          <span>{board?.title ?? plane.board}</span>
          <span>{t("Мотор")}</span>
          <span>
            {plane.airframe.motorPosition === "tractor" ? t("тянущий") : t("толкающий")},{" "}
            {plane.airframe.esc === "bidirectional" ? t("регулятор двунаправленный") : t("регулятор обычный")}
          </span>
          <span>{t("Шасси")}</span>
          <span>{plane.airframe.gear === "tail" ? t("хвостовое колесо") : plane.airframe.gear === "nose" ? t("носовое колесо") : t("нет, запуск с руки")}</span>
          <span>{t("Датчики")}</span>
          <span>
            {SENSOR_CATEGORIES.map((c) => `${c === "airspeed" ? "Пито" : c.toUpperCase()}: ${sensorLabel(manifest, c, plane.sensors[c])}`).join(" · ")}
          </span>
        </div>
      </Section>

      <Section title={t("Тумблеры")}>
        <div className="card">
          {plane.bindings.map((b, i) => (
            <div key={i} style={{ padding: "3px 0" }}>
              {bindingText(manifest, b)}
            </div>
          ))}
          <div className="hint" style={{ marginTop: 6 }}>
            {t("SwA — ARM (вниз — заармлен, только при газе внизу).")}
          </div>
        </div>
      </Section>

      <Section title={t("Если что-то пойдёт не так")}>
        <div className="card">
          {safetyStory(manifest, plane).map((l, i) => (
            <div key={i} style={{ padding: "3px 0" }}>
              {l}
            </div>
          ))}
        </div>
      </Section>

      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn primary big" disabled={!!blocker} title={blocker ?? undefined} onClick={() => void runFlash(plane.id)}>
          <Zap size={18} />
          {t("Прошить «{name}»", { name: plane.name })}
        </button>
        {blocker && <span className="hint">{blocker}</span>}
      </div>
    </>
  );
}
