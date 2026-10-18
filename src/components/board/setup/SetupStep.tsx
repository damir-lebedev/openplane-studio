// Шаг «Наладка»: проверки по порядку на настоящей плате — датчики, пульт,
// потеря связи, калибровки, рули, мотор. Сверху — почему ARM сейчас не
// включится и та ли прошивка на плате.

import { Cable, CircleCheck, ShieldAlert, Terminal, TriangleAlert, Wrench, Zap } from "lucide-react";
import { ReactElement, useEffect, useState } from "react";

import { armBlockHint, SetupCheckId } from "../../../core/live";
import { isNone } from "../../../core/manifest";
import { runFlash } from "../../../flash";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { useLive } from "../../live/LiveWidgets";
import { StepHead } from "../../ui";
import { CompassCheck, GroundCheck, MountCheck } from "./CalibrationChecks";
import { CheckCard, CheckState, useBoardIdentity, useFirmwareMatch, when } from "./common";
import { FailsafeCheck } from "./FailsafeCheck";
import { BenchCard, MotorCheck } from "./MotorCheck";
import { SensorsCheck, useSensorsState } from "./SensorsCheck";
import { SurfacesCheck } from "./SurfacesCheck";
import { TxCheck } from "./TxCheck";

function ConnectionBanner() {
  const plane = useApp((s) => s.current())!;
  const link = useApp((s) => s.link);
  const devices = useApp((s) => s.devices);
  const connect = useApp((s) => s.connect);
  const setBoardPanel = useApp((s) => s.setBoardPanel);
  const flash = useApp((s) => s.flash);
  const live = useLive();
  const identity = useBoardIdentity();
  const match = useFirmwareMatch(plane);
  const flashBtn = (
    <button className="btn small primary" disabled={!!flash?.running} onClick={() => void runFlash(plane.id)}>
      <Zap size={14} />
      {t("Прошить «{name}»", { name: plane.name })}
    </button>
  );

  if (link.state !== "open") {
    const esp = devices.find((d) => d.port && (d.kind === "usb-serial" || d.kind === "esp32-usb"));
    return (
      <div className="banner">
        <Cable size={18} />
        <div className="grow">
          {link.state === "connecting"
            ? t("Подключаюсь к плате…")
            : link.state === "error"
              ? t("Плата есть, но порт не открылся: {e}", { e: link.error ?? "" })
              : t("Подключите плату по USB — наладка идёт по живым данным с неё.")}
        </div>
        {esp && link.state !== "connecting" && (
          <button className="btn small" onClick={() => void connect(esp.port!, false)}>
            {t("Подключить {port}", { port: esp.port! })}
          </button>
        )}
        {link.state === "error" && (
          <button className="btn small" onClick={() => setBoardPanel(true)}>
            {t("Подробнее")}
          </button>
        )}
      </div>
    );
  }
  if (!live) {
    return (
      <div className="banner warn">
        <TriangleAlert size={18} />
        <div className="grow">
          {link.noLive
            ? t("Прошивка на плате старше приложения — живых данных она не шлёт, а наладка идёт по ним. Прошейте этот самолёт.")
            : identity
              ? t("Плата на связи, но живых данных пока нет: она занята калибровкой или только что подключилась.")
              : t("Плата на связи, но не ответила, что на ней. Это прошивка OpenPlane? Прошейте этот проект.")}
        </div>
        {flashBtn}
      </div>
    );
  }
  if (match === "other") {
    return (
      <div className="banner warn">
        <TriangleAlert size={18} />
        <div className="grow">
          {t("На плате другая конфигурация{plane} — проверки покажут то, что прошито сейчас, а не этот проект.", {
            plane: identity?.plane ? ` («${identity.plane}»)` : "",
          })}
        </div>
        {flashBtn}
      </div>
    );
  }
  if (match === "edited") {
    return (
      <div className="banner warn">
        <Wrench size={18} />
        <div className="grow">{t("Проект изменён после прошивки — исправления заработают после «Прошить».")}</div>
        {flashBtn}
      </div>
    );
  }
  return null;
}

function ArmStatus({ onOpen }: { onOpen: (id: SetupCheckId) => void }) {
  const live = useLive();
  const startProc = useApp((s) => s.startProc);
  if (!live) return null;
  if (live.arm) {
    return (
      <div className="arm-status armed">
        <ShieldAlert size={18} />
        <div className="grow">
          <b>{t("Заармлено.")}</b> {t("Газ стиком закрутит мотор. Снимите ARM, если винт стоит.")}
        </div>
      </div>
    );
  }
  if (!live.block) {
    return (
      <div className="arm-status ok">
        <CircleCheck size={18} />
        <div className="grow">{t("ARM включится: газ внизу, связь с пультом есть, режиму {m} всего хватает.", { m: live.mode })}</div>
      </div>
    );
  }
  const hint = armBlockHint(live.block);
  return (
    <div className="arm-status blocked">
      <TriangleAlert size={18} />
      <div className="grow">
        <b>{t("ARM не включится:")}</b> <span title={live.block}>{hint.what ?? live.block}</span>
        {hint.text && <div className="hint">{hint.text}</div>}
      </div>
      {hint.fix && (
        <button className="btn small" onClick={() => void startProc(hint.fix!)}>
          {t("Исправить")}
        </button>
      )}
      {hint.check && !hint.fix && (
        <button className="btn small" onClick={() => onOpen(hint.check!)}>
          {t("К проверке")}
        </button>
      )}
    </div>
  );
}

export function SetupStep() {
  const plane = useApp((s) => s.current())!;
  const proc = useApp((s) => s.proc);
  const setBoardPanel = useApp((s) => s.setBoardPanel);
  const live = useLive();
  const sensors = useSensorsState();
  const [open, setOpen] = useState<SetupCheckId | null>(null);
  const hasMag = !isNone(plane.sensors.mag);
  const rec = (id: SetupCheckId) => plane.setup?.[id];

  // Калибровку запустили (из приложения или с пульта) — показать её карточку.
  useEffect(() => {
    if (proc?.state === "run") {
      const id: SetupCheckId | null = proc.kind === "mount" ? "mount" : proc.kind === "ground" ? "ground" : proc.kind === "compass" ? "compass" : null;
      if (id) setOpen(id);
    }
  }, [proc?.state, proc?.kind]);

  const running = (k: string) => proc?.state === "run" && proc.kind === k;
  const fromBoard = (ok: boolean | undefined, kind: string): CheckState => (running(kind) ? "run" : !live ? "off" : ok ? "ok" : "todo");
  const fromRecord = (id: SetupCheckId): CheckState => (rec(id) ? "ok" : "todo");
  const done = (id: SetupCheckId) => (rec(id) ? t("пройдена {when}", { when: when(rec(id)!.at) }) : undefined);

  const checks: { id: SetupCheckId; title: string; state: CheckState; summary?: string; body: ReactElement }[] = [
    {
      id: "sensors",
      title: t("Датчики на месте"),
      state: sensors.state,
      summary: sensors.rows
        .filter((r) => r.state !== "off")
        .map((r) => `${r.title} ${r.state === "ok" ? "✓" : r.state === "bad" ? "✗" : "…"}`)
        .join(" · "),
      body: <SensorsCheck />,
    },
    { id: "tx", title: t("Пульт"), state: fromRecord("tx"), summary: done("tx") ?? t("стики, тумблеры, триммеры"), body: <TxCheck /> },
    { id: "failsafe", title: t("Потеря связи"), state: fromRecord("failsafe"), summary: done("failsafe") ?? t("выключить пульт на земле"), body: <FailsafeCheck /> },
    {
      id: "mount",
      title: t("Установка IMU"),
      state: fromBoard(live?.mount, "mount"),
      summary: !live ? t("нет связи") : live.mount ? t("измерена, плата помнит") : t("три позы, один раз"),
      body: <MountCheck />,
    },
    {
      id: "ground",
      title: t("Калибровка на земле"),
      state: fromBoard(live?.park, "ground"),
      summary: !live ? t("нет связи") : live.park ? t("горизонт и стоянка сохранены") : t("горизонт и стоянка"),
      body: <GroundCheck />,
    },
    ...(hasMag
      ? [
          {
            id: "compass" as const,
            title: t("Компас"),
            state: fromBoard(live?.magcal, "compass"),
            summary: !live ? t("нет связи") : live.magcal ? t("откалиброван") : t("15 секунд вращать"),
            body: <CompassCheck />,
          },
        ]
      : []),
    { id: "surfaces", title: t("Рули"), state: fromRecord("surfaces"), summary: done("surfaces") ?? t("каждый руль в свою сторону"), body: <SurfacesCheck /> },
    { id: "motor", title: t("Мотор"), state: fromRecord("motor"), summary: done("motor") ?? t("винт снят!"), body: <MotorCheck /> },
  ];
  const okCount = checks.filter((c) => c.state === "ok").length;

  return (
    <>
      <StepHead title={t("Наладка на земле")}>
        {t("По порядку, на настоящей плате: каждая проверка смотрит, что плата видит сейчас. Не туда — одна кнопка, и прошивка подстроится под самолёт.")}
      </StepHead>
      <ConnectionBanner />
      <ArmStatus onOpen={setOpen} />
      <div className="checks-head">
        <span>{t("Готово {a} из {b}", { a: okCount, b: checks.length })}</span>
        <div className="grow" />
        <button className="btn small ghost" onClick={() => setBoardPanel(true)}>
          <Terminal size={14} />
          {t("Консоль платы")}
        </button>
      </div>
      <div className="checks">
        {checks.map((c, i) => (
          <CheckCard
            key={c.id}
            num={i + 1}
            title={c.title}
            summary={c.summary}
            state={c.state}
            open={open === c.id}
            onToggle={() => setOpen(open === c.id ? null : c.id)}
          >
            {c.body}
          </CheckCard>
        ))}
      </div>
      <BenchCard />
    </>
  );
}
