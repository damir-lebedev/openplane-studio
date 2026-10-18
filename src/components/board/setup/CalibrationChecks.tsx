// 4–6. Калибровки, которые плата хранит сама: установка IMU (три позы),
// калибровка на земле (горизонт и стоянка), компас. Сделано ли — говорит
// плата (поля mount/park/magcal живого кадра), а не память приложения.

import { CircleAlert, CircleCheck, LoaderCircle, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { channelTitle } from "../../../core/labels";
import { ProcKind } from "../../../core/live";
import { effectiveParam } from "../../../core/project";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { Horizon, useLive } from "../../live/LiveWidgets";
import { PlaneView } from "../../PlaneView";
import { PoseArt } from "./common";

function ProcResult({ kind }: { kind: ProcKind }) {
  const proc = useApp((s) => s.proc);
  if (!proc || proc.kind !== kind || proc.state === "run") return null;
  return proc.state === "ok" ? (
    <div className="issue">
      <CircleCheck size={16} color="var(--ok)" />
      <div className="grow">
        {t("Готово.")} {proc.text && <span className="hint">{proc.text}</span>}
      </div>
    </div>
  ) : (
    <div className="issue error">
      <CircleAlert size={16} color="var(--err)" />
      <div className="grow">{t("Не получилось: {why}", { why: proc.text ?? t("плата не ответила") })}</div>
    </div>
  );
}

function useStart(kind: ProcKind) {
  const startProc = useApp((s) => s.startProc);
  const proc = useApp((s) => s.proc);
  const link = useApp((s) => s.link);
  const live = useLive();
  const running = proc?.state === "run";
  const mine = proc?.kind === kind;
  const disabled = link.state !== "open" || (running && !mine) || !!live?.arm;
  const why = link.state !== "open" ? t("нет связи с платой") : live?.arm ? t("только без ARM") : running && !mine ? t("идёт другая калибровка") : null;
  return { start: () => void startProc(kind), running: running && mine, disabled: disabled || (running && mine), why };
}

export function MountCheck() {
  const plane = useApp((s) => s.current())!;
  const proc = useApp((s) => s.proc);
  const live = useLive();
  const { start, running, disabled, why } = useStart("mount");
  const step = proc?.kind === "mount" ? proc.step : 0;
  const poses = [
    { pose: "level" as const, text: t("Ровно, как в горизонтальном полёте") },
    { pose: "nose-up" as const, text: t("Нос вверх на 30–60°, крылья ровно") },
    { pose: "right-down" as const, text: t("Нос обратно, правое крыло вниз на 30–60°") },
  ];
  return (
    <>
      <p className="check-lead">
        {t("Один раз после установки платы: плата сама поймёт, как она стоит в самолёте — хоть боком, хоть вверх ногами. В каждой позе держите самолёт неподвижно ~1 с — шаг засчитается сам.")}
      </p>
      <div className="poses">
        {poses.map((p, i) => (
          <div key={p.pose} className={`pose-card${running && step === i + 1 ? " active" : ""}${running && step > i + 1 ? " done" : ""}`}>
            <PoseArt pose={p.pose} active={running && step === i + 1} done={running && step > i + 1} />
            <div className="pose-num">{i + 1}</div>
            <div className="hint">{p.text}</div>
          </div>
        ))}
      </div>
      {running && <p className="hint">{t("Пока идёт калибровка, плата занята ею — живые данные на паузе.")}</p>}
      <ProcResult kind="mount" />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={disabled} onClick={start}>
          {running ? <LoaderCircle size={15} className="spin" /> : live?.mount ? <RotateCcw size={15} /> : <Play size={15} />}
          {running ? t("Шаг {n} из 3…", { n: Math.max(1, step) }) : live?.mount ? t("Измерить заново") : t("Начать")}
        </button>
        {why && !running && <span className="hint">{why}</span>}
      </div>
      {live?.mount && !running && (
        <div className="row horizon-check">
          <div className="mount-3d">
            <PlaneView plane={plane} focus={[]} />
          </div>
          <Horizon roll={live.att?.[0]} pitch={live.att?.[1]} size={130} />
          <div className="hint">
            {t("Проверка: нос вверх — горизонт уходит вниз, правое крыло вниз — горизонт наклоняется влево.")}
            <div className="mono" style={{ marginTop: 6 }}>
              {t("крен {r}°, тангаж {p}°", { r: live.att?.[0].toFixed(1) ?? "—", p: live.att?.[1].toFixed(1) ?? "—" })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function GroundCheck() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const proc = useApp((s) => s.proc);
  const command = useApp((s) => s.command);
  const live = useLive();
  const { start, running, disabled, why } = useStart("ground");
  const gear = plane.airframe.gear;
  const stage = live?.cal === "LEVEL" ? 1 : live?.cal === "PARK" ? 2 : proc?.kind === "ground" ? proc.step : 0;
  const calSwitch = String(effectiveParam(manifest, plane, "CAL_SWITCH") ?? "").split("::").pop();
  const steps =
    gear === "tail"
      ? [
          { pose: "tail-up" as const, text: t("Поднимите хвост, пока фюзеляж не станет горизонтально, как в полёте (основные колёса на земле), держите ~2 с") },
          { pose: "park" as const, text: t("Поставьте на колёса на ровное место и уберите руки") },
        ]
      : gear === "nose"
        ? [
            { pose: "level" as const, text: t("Самолёт ровно, как в горизонтальном полёте, держите ~2 с") },
            { pose: "level" as const, text: t("Поставьте на колёса на ровное место и уберите руки") },
          ]
        : [
            { pose: "level" as const, text: t("Самолёт ровно, как в горизонтальном полёте, держите ~2 с") },
            { pose: "level" as const, text: t("Положите на ровное место и уберите руки — шаг засчитается сам") },
          ];

  return (
    <>
      <p className="check-lead">
        {t("Горизонт для всех режимов со стабилизацией и стоянка — от неё автовзлёт считает, насколько поднять хвост. Делается на поле перед первым полётом и после перестановки платы.")}
      </p>
      <div className="poses">
        {steps.map((s, i) => (
          <div key={i} className={`pose-card${running && stage === i + 1 ? " active" : ""}${running && stage > i + 1 ? " done" : ""}`}>
            <PoseArt pose={s.pose} active={running && stage === i + 1} done={running && stage > i + 1} />
            <div className="pose-num">{i + 1}</div>
            <div className="hint">{s.text}</div>
          </div>
        ))}
      </div>
      {calSwitch && calSwitch !== "NONE" && (
        <p className="hint">
          {t("То же с пульта: {sw} вниз-вверх 3 раза без ARM — рули кивнут, и пойдут шаги.", { sw: channelTitle(calSwitch) })}
        </p>
      )}
      <ProcResult kind="ground" />
      <div className="row" style={{ marginTop: 10 }}>
        {running ? (
          <button className="btn" onClick={() => void command("act c")} title={t("Повторное нажатие отменяет калибровку")}>
            <Square size={14} />
            {t("Отменить")}
          </button>
        ) : (
          <button className="btn primary" disabled={disabled} onClick={start}>
            {live?.park ? <RotateCcw size={15} /> : <Play size={15} />}
            {live?.park ? t("Откалибровать заново") : t("Начать")}
          </button>
        )}
        {running && <span className="hint">{t("Шаг {n} из 2", { n: Math.max(1, stage) })}</span>}
        {why && !running && <span className="hint">{why}</span>}
      </div>
    </>
  );
}

export function CompassCheck() {
  const proc = useApp((s) => s.proc);
  const live = useLive();
  const { start, running, disabled, why } = useStart("compass");
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [running]);
  const left = running && proc ? Math.max(0, 15 - Math.floor((Date.now() - proc.startedAt) / 1000)) : 0;

  return (
    <>
      <p className="check-lead">
        {t("15 секунд вращайте самолёт во все стороны: нос вверх и вниз, на одно крыло и на другое, кругом. Подальше от железа и магнитов. Плата запомнит помехи от своих проводов и мотора.")}
      </p>
      <ProcResult kind="compass" />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={disabled} onClick={start}>
          {running ? <LoaderCircle size={15} className="spin" /> : live?.magcal ? <RotateCcw size={15} /> : <Play size={15} />}
          {running ? t("Вращайте… {s} с", { s: left }) : live?.magcal ? t("Откалибровать заново") : t("Начать (15 с)")}
        </button>
        {why && !running && <span className="hint">{why}</span>}
      </div>
      {live?.magcal && live.hdg !== undefined && !running && (
        <p className="hint" style={{ marginTop: 10 }}>
          {t("Курс сейчас: {h}°. Поверните нос на север — должно быть около 0°, на восток — около 90°.", { h: live.hdg })}
        </p>
      )}
    </>
  );
}
