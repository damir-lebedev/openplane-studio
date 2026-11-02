// «По шагам» (режим «Новичок»): от рамы до «можно лететь» — рама и винты →
// пульт и режимы → моторы без винтов → потеря связи и возврат → батарея →
// OSD и видео → можно лететь. Каждый шаг — понятными словами и с тем же
// железом, что вкладки «Профи» (каналы, схема моторов, калибровки); шаг
// отмечается пройденным галочкой пилота (в проекте — copter.wizardDone),
// последний собирает всё, что ещё мешает взлететь.

import { ArrowLeft, ArrowRight, CircleCheck, CircleDashed, PartyPopper, TriangleAlert } from "lucide-react";
import { ReactNode, useState } from "react";

import { CopterProject } from "../../core/copter";
import { ARM_BENCH_OK, ARM_TEXT } from "../../core/copterParams";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { Seg } from "../ui";
import { NeedBoard, ParamInput, useCopterBoard, useCopterLink, useCopterLive } from "./common";
import { FrameDiagram, MotorsBody } from "./MotorsTab";
import { SwitchesCard, VtxCard, WriteSetup } from "./OverviewTab";
import { ChannelBars } from "./ReceiverTab";
import { Calibrations } from "./SetupTab";

export const WIZARD_STEPS = [
  { id: "frame", title: N_("Рама и винты") },
  { id: "radio", title: N_("Пульт и режимы") },
  { id: "motors", title: N_("Моторы без винтов") },
  { id: "failsafe", title: N_("Потеря связи и возврат") },
  { id: "battery", title: N_("Батарея") },
  { id: "video", title: N_("OSD и видео") },
  { id: "ready", title: N_("Можно лететь") },
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number]["id"];

/** Шаги, которые пилот отмечает сам (рама — сама, когда плата на связи). */
const CONFIRM: Partial<Record<WizardStep, string>> = {
  radio: N_("Стики двигают нужные полосы в нужную сторону, тумблеры назначены и записаны в плату"),
  motors: N_("Каждый мотор на своём месте схемы и крутится по стрелке"),
  failsafe: N_("Проверил без винтов: выключил пульт — моторы встали"),
  battery: N_("Банки, химия и ёмкость — как у моей батареи"),
  video: N_("Картинка в очках есть, канал видео — мой"),
};

export function Wizard({ copter }: { copter: CopterProject }) {
  const done = new Set(copter.wizardDone ?? []);
  const first = WIZARD_STEPS.find((s) => s.id !== "frame" && s.id !== "ready" && !done.has(s.id))?.id ?? "ready";
  const [step, setStep] = useState<WizardStep>(done.size ? first : "frame");
  const i = WIZARD_STEPS.findIndex((s) => s.id === step);
  return (
    <div className="wizard">
      <div className="wizard-steps">
        {WIZARD_STEPS.map((s, k) => (
          <button key={s.id} className={`wizard-step${s.id === step ? " on" : ""}${done.has(s.id) ? " done" : ""}`} onClick={() => setStep(s.id)}>
            <span className="num">{done.has(s.id) ? <CircleCheck size={14} /> : k + 1}</span>
            {t(s.title)}
          </button>
        ))}
      </div>
      <div className="wizard-body" key={step}>
        <StepBody step={step} copter={copter} go={setStep} />
        {CONFIRM[step] && <Confirm copter={copter} step={step} />}
      </div>
      <div className="wizard-nav">
        <button className="btn ghost" disabled={i === 0} onClick={() => setStep(WIZARD_STEPS[i - 1].id)}>
          <ArrowLeft size={15} />
          {t("Назад")}
        </button>
        <span className="grow" />
        {i < WIZARD_STEPS.length - 1 && (
          <button className="btn primary" onClick={() => setStep(WIZARD_STEPS[i + 1].id)}>
            {t("Дальше")}
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function Confirm({ copter, step }: { copter: CopterProject; step: WizardStep }) {
  const updateCopter = useApp((s) => s.updateCopter);
  const on = (copter.wizardDone ?? []).includes(step);
  const toggle = (v: boolean) =>
    updateCopter(copter.id, (c) => {
      const rest = (c.wizardDone ?? []).filter((x) => x !== step);
      c.wizardDone = v ? [...rest, step] : rest;
    });
  return (
    <label className={`wizard-confirm${on ? " on" : ""}`}>
      <input type="checkbox" checked={on} onChange={(e) => toggle(e.target.checked)} />
      <span>{t(CONFIRM[step]!)}</span>
    </label>
  );
}

function Lead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wizard-lead">
      <h2>{title}</h2>
      <p className="sub">{children}</p>
    </div>
  );
}

function StepBody({ step, copter, go }: { step: WizardStep; copter: CopterProject; go: (s: WizardStep) => void }) {
  switch (step) {
    case "frame":
      return <FrameStep />;
    case "radio":
      return <RadioStep copter={copter} />;
    case "motors":
      return (
        <>
          <Lead title={t("Моторы без винтов")}>
            {t("Снимите все четыре винта и подключите батарею. Крутаните каждый мотор ползунком: номер на схеме и направление должны совпасть. Не туда крутится — направление меняется кнопкой «Обратное» (регуляторы DShot) или в BLHeli/Bluejay; провода не перепаивайте.")}
          </Lead>
          <NeedBoard>
            <MotorsBody simple />
          </NeedBoard>
        </>
      );
    case "failsafe":
      return <FailsafeStep />;
    case "battery":
      return <BatteryStep />;
    case "video":
      return (
        <>
          <Lead title={t("OSD и видео")}>
            {t("Канал видео и предел мощности — как у ваших очков и по закону. Самое нужное на экране очков (батарея, связь, режим, таймер) уже включено; передвинуть элементы — «Профи» → OSD.")}
          </Lead>
          <div className="copter-grid">
            <VtxCard copter={copter} />
            <WriteSetup copter={copter} />
          </div>
        </>
      );
    case "ready":
      return <ReadyStep copter={copter} go={go} />;
  }
}

function FrameStep() {
  const { copter: ready } = useCopterLink();
  const board = useCopterBoard();
  const motors = board.header?.frame?.motors ?? [];
  const field = (name: string, label: string) =>
    board.params[name] ? (
      <div className="field">
        <label>{label}</label>
        <div className="row" style={{ gap: 6 }}>
          <ParamInput p={board.params[name]} width={90} />
          {board.params[name].units && <span className="hint">{t(board.params[name].units)}</span>}
        </div>
      </div>
    ) : null;
  return (
    <>
      <Lead title={t("Рама и винты")}>
        {t("Из этого описания прошивка сама считает всю настройку полёта — как отзывается мотор, какие нужны фильтры и насколько сильно держать. Проверьте, что всё как у вашего коптера, и сохраните.")}
      </Lead>
      {!ready ? (
        <div className="card need-board">
          <TriangleAlert size={22} color="var(--warn)" />
          <div>
            <h3>{t("Подключите коптер по USB")}</h3>
            <p className="sub">{t("Плата ещё с Betaflight или пустая — нажмите «Прошить» вверху: приложение снимет распиновку, сохранит родную прошивку и зальёт нашу.")}</p>
          </div>
        </div>
      ) : (
        <NeedBoard>
          <div className="copter-grid">
            <div className="card">
              <h3>{t("Рама")}</h3>
              <FrameDiagram motors={motors} size={220} />
            </div>
            <div className="card">
              <h3>{t("Коптер")}</h3>
              <div className="wizard-fields">
                {field("prop_diameter_in", t("Винт, дюймы"))}
                {field("prop_pitch_in", t("Шаг винта"))}
                {field("prop_blades", t("Лопастей"))}
                {field("motor_kv", t("KV мотора"))}
                {field("motor_stator_mm", t("Статор, ширина"))}
                {field("motor_height_mm", t("Статор, высота"))}
                {field("copter_mass_g", t("Масса с батареей"))}
                {field("props_out", t("Винты наружу"))}
              </div>
            </div>
            <Calibrations />
          </div>
        </NeedBoard>
      )}
    </>
  );
}

function RadioStep({ copter }: { copter: CopterProject }) {
  return (
    <>
      <Lead title={t("Пульт и режимы")}>
        {t("Включите пульт: полосы ниже должны двигаться за стиками. Тумблеры: ARM — моторы, ANGLE — коптер сам держит горизонт (для начала — всегда он), пищалка — найти коптер в траве.")}
      </Lead>
      <div className="copter-grid">
        <div className="card">
          <h3>{t("Стики")}</h3>
          <NeedBoard>
            <ChannelBars />
          </NeedBoard>
        </div>
        <SwitchesCard copter={copter} />
        <WriteSetup copter={copter} />
      </div>
    </>
  );
}

const FAILSAFE_CHOICES = [
  { value: "AUTO-LAND", title: N_("Сесть на месте"), hint: N_("Ровно и плавно снижается там, где пропала связь. Лучше всего рядом с собой.") },
  { value: "GPS-RESCUE", title: N_("Вернуться домой по GPS"), hint: N_("Набирает высоту, летит к точке взлёта и садится. Нужен модуль GPS и спутники при взлёте.") },
  { value: "DROP", title: N_("Выключить моторы"), hint: N_("Коптер падает сразу. Только над сеткой или в зале.") },
];

function FailsafeStep() {
  return (
    <>
      <Lead title={t("Потеря связи и возврат")}>
        {t("Первые секунды без связи коптер висит ровно и держит высоту — связь вернётся, управление сразу ваше. Не вернулась — делает то, что выберете здесь.")}
      </Lead>
      <NeedBoard>
        <FailsafeChoice />
      </NeedBoard>
    </>
  );
}

function FailsafeChoice() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const p = board.params.failsafe_procedure;
  const current = String(board.pending.failsafe_procedure ?? p?.value ?? "AUTO-LAND");
  const noGps = !live?.gps;
  return (
    <div className="choice-grid">
      {FAILSAFE_CHOICES.filter((c) => p?.options?.includes(c.value) ?? true).map((c) => (
        <button key={c.value} className={`choice${current === c.value ? " on" : ""}`} disabled={armed || !p} onClick={() => void set("failsafe_procedure", c.value)}>
          <b>{t(c.title)}</b>
          <span className="hint">{t(c.hint)}</span>
          {c.value === "GPS-RESCUE" && noGps && <span className="hint warn-text">{t("GPS на плате сейчас не виден")}</span>}
        </button>
      ))}
    </div>
  );
}

const CHEMISTRY_LABELS: Record<string, string> = { LIPO: "LiPo", LIHV: "LiHV", LIION: "Li-ion" };

function BatteryStep() {
  return (
    <>
      <Lead title={t("Батарея")}>
        {t("По банкам и химии прошивка знает, когда батарея садится: пищит и пишет в очках «пора домой». Li-ion не отдаёт долгий полный газ — садитесь по LOW BATTERY.")}
      </Lead>
      <NeedBoard>
        <BatteryBody />
      </NeedBoard>
    </>
  );
}

function BatteryBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const chem = board.params.battery_chemistry;
  const cells = board.params.battery_cells;
  const mah = board.params.battery_mah;
  const warn = Number(board.params.vbat_warning_cell_voltage?.value ?? 0) / 100;
  const cellCount = Number(board.pending.battery_cells ?? cells?.value ?? 0);
  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Моя батарея")}</h3>
        {chem && (
          <div className="field">
            <label>{t("Химия")}</label>
            <Seg value={String(board.pending.battery_chemistry ?? chem.value)} options={(chem.options ?? []).map((o) => ({ value: o, label: CHEMISTRY_LABELS[o] ?? o, disabled: armed }))} onChange={(v) => void set("battery_chemistry", v)} />
          </div>
        )}
        {cells && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>{t("Банок (S)")}</label>
            <Seg value={String(cellCount)} options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: `${n}S`, disabled: armed }))} onChange={(v) => void set("battery_cells", Number(v))} />
          </div>
        )}
        {mah && (
          <div className="field" style={{ marginTop: 10 }}>
            <label>{t("Ёмкость")}</label>
            <div className="row" style={{ gap: 6 }}>
              <ParamInput p={mah} width={90} />
              <span className="hint">{t("мА·ч")}</span>
            </div>
          </div>
        )}
      </div>
      <div className="card">
        <h3>{t("Сейчас")}</h3>
        <div className="kv">
          <span>{t("Напряжение")}</span>
          <span className="mono">{live && live.v > 0.5 ? `${live.v.toFixed(2)} ${t("В")}` : t("нет батареи (питание от USB)")}</span>
          <span>{t("На банку")}</span>
          <span className="mono">{live?.cell ? `${live.cell.toFixed(2)} ${t("В")}` : "—"}</span>
          {warn > 0 && (
            <>
              <span>{t("«Пора домой»")}</span>
              <span className="mono">
                {t("{v} В на банку", { v: warn.toFixed(2) })}
                {cellCount > 0 ? ` · ${(warn * cellCount).toFixed(1)} ${t("В")}` : ""}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Что ещё мешает взлететь: готово ли, что, на каком шаге поправить. */
function readiness(copter: CopterProject, ctx: { linked: boolean; unsaved: boolean; live: ReturnType<typeof useCopterLive> }): { ok: boolean; text: string; step?: WizardStep }[] {
  const done = new Set(copter.wizardDone ?? []);
  const blocks = ctx.live?.block ?? [];
  const serious = blocks.filter((b) => !ARM_BENCH_OK.includes(b));
  const items: { ok: boolean; text: string; step?: WizardStep }[] = [
    { ok: ctx.linked, text: t("Коптер на связи по USB"), step: "frame" },
    { ok: ctx.linked && !ctx.unsaved, text: t("Изменения сохранены в плату («Сохранить» вверху)") },
    { ok: ctx.live?.rx === "ok", text: t("Пульт на связи"), step: "radio" },
    { ok: !!ctx.live && !blocks.includes("NO_ACC_CAL"), text: t("Установка платы откалибрована"), step: "frame" },
  ];
  for (const s of WIZARD_STEPS) if (CONFIRM[s.id]) items.push({ ok: done.has(s.id), text: t("Шаг «{s}» пройден", { s: t(s.title) }), step: s.id });
  for (const b of serious) if (b !== "NO_ACC_CAL" && b !== "RXLOSS") items.push({ ok: false, text: ARM_TEXT[b] ? t(ARM_TEXT[b]) : b });
  return items;
}

function ReadyStep({ copter, go }: { copter: CopterProject; go: (s: WizardStep) => void }) {
  const { copter: linked } = useCopterLink();
  const unsaved = useApp((s) => s.copterBoard.unsaved);
  const live = useCopterLive();
  const items = readiness(copter, { linked, unsaved, live });
  const left = items.filter((x) => !x.ok);
  return (
    <>
      {left.length === 0 ? (
        <div className="ready-banner">
          <PartyPopper size={28} />
          <div>
            <h2>{t("Всё готово — можно лететь!")}</h2>
            <p>{t("Наденьте винты (номера и направление — по схеме), отойдите в открытое поле. Первый взлёт — в ANGLE, низко, плавным газом; связь пропадёт — коптер сделает то, что вы выбрали.")}</p>
          </div>
        </div>
      ) : (
        <Lead title={t("Осталось {n}", { n: left.length })}>{t("Что ещё мешает безопасно взлететь. Каждый пункт — на своём шаге.")}</Lead>
      )}
      <ul className="ready-list">
        {items.map((x) => (
          <li key={x.text} className={x.ok ? "ok" : ""}>
            {x.ok ? <CircleCheck size={16} color="var(--ok)" /> : <CircleDashed size={16} color="var(--warn)" />}
            <span className="grow">{x.text}</span>
            {!x.ok && x.step && (
              <button className="btn ghost small" onClick={() => go(x.step!)}>
                {t("К шагу")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
