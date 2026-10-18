// Пульт FS-i6 на экране: на какое положение какого тумблера какое действие.
// Недоступное (нет датчика) видно серым с надписью «Для работы режима …
// нужны датчики: …» — и кнопкой к шагу, где это добавляется.

import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { channelIndex } from "../../core/channels";
import { channelTitle, itemLabel, itemTitle } from "../../core/labels";
import { switchPosition, SWITCH_ON_US } from "../../core/live";
import { Binding, Manifest, ManifestChannel } from "../../core/manifest";
import { PlaneProject, StepId } from "../../core/project";
import { availability, haveTokens, ItemKind, needText, tokenNames } from "../../core/rules";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { LiveStick, useLive } from "../live/LiveWidgets";
import { itemParams } from "../../core/itemParams";
import { Modal } from "../ui";
import { ParamField } from "./ParamField";

type Role = "none" | "modes" | "mode" | "feature" | "knob";

const SENSOR_TOKENS = new Set(["imu", "baro", "mag", "gps", "pitot"]);

function stepForTokens(tokens: string[]): StepId {
  return tokens.every((t) => SENSOR_TOKENS.has(t)) ? "sensors" : "airframe";
}

function listFor(manifest: Manifest, kind: ItemKind) {
  return kind === "mode" ? manifest.modes : kind === "feature" ? manifest.features : manifest.knobs;
}

function firstAvailable(manifest: Manifest, plane: PlaneProject, kind: ItemKind, prefer: string[]): string {
  const have = haveTokens(manifest, plane);
  const items = listFor(manifest, kind);
  const ok = (id: string) => {
    const item = items.find((i) => i.id === id);
    return item && availability(item, have).state !== "unavailable";
  };
  return prefer.find(ok) ?? items.find((i) => ok(i.id))?.id ?? items[0].id;
}

function defaultBinding(manifest: Manifest, plane: PlaneProject, ch: ManifestChannel, role: Role): Binding | null {
  switch (role) {
    case "modes": {
      const pick = (prefer: string[], skip: string[]) =>
        firstAvailable(manifest, plane, "mode", prefer.filter((m) => !skip.includes(m)));
      const a = "MODE_MANUAL";
      const b = pick(["MODE_STABILIZE", "MODE_ACRO"], [a]);
      if (ch.positions === 2) return { kind: "modes", channel: ch.name, modes: [a, b] };
      const c = pick(["MODE_ALT_HOLD", "MODE_CRUISE", "MODE_RESCUE", "MODE_ACRO"], [a, b]);
      return { kind: "modes", channel: ch.name, modes: [a, b, c] };
    }
    case "mode":
      return { kind: "mode", channel: ch.name, mode: firstAvailable(manifest, plane, "mode", ["MODE_RTH", "MODE_RESCUE", "MODE_LOITER"]) };
    case "feature":
      return { kind: "feature", channel: ch.name, feature: firstAvailable(manifest, plane, "feature", ["FLAPS", "MOTOR_KILL"]) };
    case "knob":
      return { kind: "knob", channel: ch.name, knob: firstAvailable(manifest, plane, "knob", ["STAB_GAIN", "CRUISE_SPEED", "RATES"]) };
    default:
      return null;
  }
}

/** true на секунду после того, как канал резко сменился (щёлкнули тумблером). */
function useFlip(us: number | undefined): boolean {
  const prev = useRef<number | undefined>(undefined);
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (us !== undefined && prev.current !== undefined && Math.abs(us - prev.current) > 250) setAt(Date.now());
    prev.current = us;
  }, [us]);
  useEffect(() => {
    if (!at) return;
    const id = setTimeout(() => setAt(0), 1000);
    return () => clearTimeout(id);
  }, [at]);
  return at > 0;
}

interface PickTarget {
  channel: string;
  kind: ItemKind;
  index: number;
}

function Picker({ target, onClose }: { target: PickTarget; onClose: () => void }) {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const setStep = useApp((s) => s.setStep);
  const have = haveTokens(manifest, plane);
  const items = listFor(manifest, target.kind);
  const [numbersOf, setNumbersOf] = useState<string | null>(null);
  const title =
    target.kind === "mode" ? t("Режим для {ch}", { ch: channelTitle(target.channel) }) :
    target.kind === "feature" ? t("Функция для {ch}", { ch: channelTitle(target.channel) }) :
    t("Крутилка {ch}", { ch: channelTitle(target.channel) });

  const choose = (id: string) => {
    updatePlane((p) => {
      p.bindings = p.bindings.map((b) => {
        if (b.channel !== target.channel) return b;
        if (b.kind === "modes") {
          const modes = b.modes.slice();
          modes[target.index] = id;
          return { ...b, modes };
        }
        if (b.kind === "mode") return { ...b, mode: id };
        if (b.kind === "feature") return { ...b, feature: id };
        return { ...b, knob: id };
      });
    });
    onClose();
  };

  return (
    <Modal onClose={onClose} width={620}>
      <h2>{title}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("Серое без нужного датчика или выхода не работает — сначала добавьте его.")}
      </p>
      <div className="picker">
        {items.map((item) => {
          const av = availability(item, have);
          const disabled = av.state === "unavailable";
          return (
            <div
              key={item.id}
              className={`pick${disabled ? " disabled" : ""}`}
              onClick={() => !disabled && choose(item.id)}
            >
              <div className="grow">
                <div className="pick-name">{itemTitle(manifest, target.kind, item.id)}</div>
                <div className="hint">{item.doc}</div>
                {disabled && (
                  <div className="locked-note">
                    <span>
                      {needText(manifest, target.kind, item.name, av.missing)}.{" "}
                      <button
                        className="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onClose();
                          setStep(stepForTokens(av.missing));
                        }}
                      >
                        {t("Добавить")}
                      </button>
                    </span>
                  </div>
                )}
                {av.state === "degraded" && (
                  <div className="hint" style={{ color: "#9fd4ff" }}>
                    {t("Работает, но лучше с: {list}", { list: tokenNames(manifest, av.better) })}
                  </div>
                )}
                {!disabled && itemParams(manifest, target.kind, item.id).length > 0 && (
                  <button
                    className="link"
                    style={{ marginTop: 4 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setNumbersOf(numbersOf === item.id ? null : item.id);
                    }}
                  >
                    {numbersOf === item.id ? t("Скрыть числа") : t("Числа ({n})", { n: itemParams(manifest, target.kind, item.id).length })}
                  </button>
                )}
                {numbersOf === item.id && (
                  <div className="pick-numbers" onClick={(e) => e.stopPropagation()}>
                    {itemParams(manifest, target.kind, item.id).map((name) => (
                      <ParamField key={name} name={name} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function Slot({
  pos,
  lever,
  label,
  bad,
  disabled,
  live,
  onClick,
}: {
  pos: string;
  lever?: "up" | "mid" | "down";
  label: string | null;
  bad?: boolean;
  disabled?: boolean;
  /** тумблер на пульте сейчас в этом положении */
  live?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`slot${label ? " filled" : ""}${bad ? " bad" : ""}${live ? " live" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={live ? t("Тумблер сейчас здесь") : undefined}
    >
      {lever && <span className={`lever ${lever}`} />}
      <span className="pos">{pos}</span>
      <span className="grow label" lang="ru" style={{ fontWeight: label ? 600 : 400 }} title={label ?? undefined}>
        {label ?? t("— ничего")}
      </span>
    </button>
  );
}

function SwitchCard({ ch, onPick }: { ch: ManifestChannel; onPick: (t: PickTarget) => void }) {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const binding = plane.bindings.find((b) => b.channel === ch.name);
  const role: Role = binding ? binding.kind : "none";
  const have = haveTokens(manifest, plane);
  const modeSwitchElsewhere = plane.bindings.find((b) => b.kind === "modes" && b.channel !== ch.name);
  const isKnob = ch.positions === "knob";
  const frame = useLive();
  // Нет кадров от приёмника — в каналах значения по умолчанию, а не положения пульта.
  const live = frame && frame.rx === "ok" ? frame : null;
  const us = live ? live.ch[channelIndex(manifest, plane, ch.name)] : undefined;
  const flash = useFlip(us);
  const down = us !== undefined && us >= SWITCH_ON_US;
  const knobPct = us !== undefined ? Math.round(Math.max(0, Math.min(1, (us - 1000) / 1000)) * 100) : null;

  const isBad = (kind: ItemKind, id: string) => {
    const item = listFor(manifest, kind).find((i) => i.id === id);
    return !item || availability(item, have).state === "unavailable";
  };

  const setRole = (r: Role) =>
    updatePlane((p) => {
      p.bindings = p.bindings.filter((b) => b.channel !== ch.name);
      const b = defaultBinding(manifest, p, ch, r);
      if (b) p.bindings.push(b);
    });

  if (!ch.bindable) {
    // SwA — ARM: закреплён прошивкой
    return (
      <div className={`tx-switch${flash ? " flash" : ""}`}>
        <div className="tx-switch-head">
          <span className="tx-switch-name">{channelTitle(ch.name)}</span>
          <span className="tx-switch-ch">CH{channelIndex(manifest, plane, ch.name) + 1}</span>
        </div>
        <div className="hint row" style={{ gap: 6, height: 30 }}>
          <Lock size={13} /> {t("ARM — закреплён")}
        </div>
        <Slot pos={t("вверх")} lever="up" label="DISARM" disabled live={us !== undefined && !down} />
        <Slot pos={t("вниз")} lever="down" label="ARM" disabled live={down} />
      </div>
    );
  }

  const hasError = binding
    ? (binding.kind === "modes" ? binding.modes.some((m) => isBad("mode", m)) :
       binding.kind === "mode" ? isBad("mode", binding.mode) :
       binding.kind === "feature" ? isBad("feature", binding.feature) : isBad("knob", binding.knob))
    : false;

  return (
    <div className={`tx-switch${hasError ? " err" : ""}${flash ? " flash" : ""}`}>
      <div className="tx-switch-head">
        <span className="tx-switch-name">{channelTitle(ch.name)}</span>
        <span className="tx-switch-ch">
          CH{channelIndex(manifest, plane, ch.name) + 1} ·{" "}
          {isKnob ? (knobPct !== null ? `${knobPct} %` : t("крутилка")) : t("{n} пол.", { n: ch.positions ?? "?" })}
        </span>
      </div>
      <select className="select tx-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        <option value="none">{t("не используется")}</option>
        {!isKnob && (
          <option value="modes" disabled={!!modeSwitchElsewhere}>
            {modeSwitchElsewhere
              ? t("тумблер режимов (уже на {ch})", { ch: channelTitle(modeSwitchElsewhere.channel) })
              : t("тумблер режимов")}
          </option>
        )}
        {!isKnob && <option value="mode">{t("режим поверх")}</option>}
        {!isKnob && <option value="feature">{t("функция")}</option>}
        {isKnob && <option value="knob">{t("крутилка")}</option>}
      </select>
      {binding?.kind === "modes" &&
        binding.modes.map((m, i) => {
          const three = binding.modes.length === 3;
          const pos = three ? [t("вверх"), t("середина"), t("вниз")][i] : [t("вверх"), t("вниз")][i];
          const lever = three ? (["up", "mid", "down"] as const)[i] : (["up", "down"] as const)[i];
          return (
            <Slot
              key={i}
              pos={pos}
              lever={lever}
              label={itemLabel("mode", m)}
              bad={isBad("mode", m)}
              live={us !== undefined && switchPosition(us, three ? 3 : 2) === i}
              onClick={() => onPick({ channel: ch.name, kind: "mode", index: i })}
            />
          );
        })}
      {(binding?.kind === "mode" || binding?.kind === "feature") && (
        <>
          <Slot pos={t("вверх")} lever="up" label={null} disabled live={us !== undefined && !down} />
          <Slot
            pos={t("вниз")}
            lever="down"
            label={binding.kind === "mode" ? itemLabel("mode", binding.mode) : itemLabel("feature", binding.feature)}
            bad={binding.kind === "mode" ? isBad("mode", binding.mode) : isBad("feature", binding.feature)}
            live={down}
            onClick={() => onPick({ channel: ch.name, kind: binding.kind === "mode" ? "mode" : "feature", index: 0 })}
          />
        </>
      )}
      {binding?.kind === "knob" && (
        <Slot
          pos={t("крутить")}
          label={itemLabel("knob", binding.knob)}
          bad={isBad("knob", binding.knob)}
          onClick={() => onPick({ channel: ch.name, kind: "knob", index: 0 })}
        />
      )}
      {!binding && <div className="hint" style={{ padding: "6px 2px" }}>{t("Выберите, что делает этот тумблер.")}</div>}
    </div>
  );
}

export function Transmitter() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const frame = useLive();
  // Нет кадров от приёмника — в каналах значения по умолчанию, а не положения пульта.
  const live = frame && frame.rx === "ok" ? frame : null;
  const chUs = (name: string) => (live ? live.ch[channelIndex(manifest, plane, name)] : undefined);
  const [pick, setPick] = useState<PickTarget | null>(null);
  const channels = manifest.channels.list.filter((c) => !c.stick && c.name !== "ARM");
  const switches = channels.filter((c) => c.positions !== "knob");
  const knobs = channels.filter((c) => c.positions === "knob");

  return (
    <div className="tx">
      {live && <div className="tx-live hint">{t("Плата на связи: щёлкните тумблером на пульте — его карточка подсветится, а текущее положение отмечено.")}</div>}
      <div className="tx-top">
        {switches.map((ch) => (
          <SwitchCard key={ch.name} ch={ch} onPick={setPick} />
        ))}
      </div>
      <div className="tx-mid">
        {knobs.map((ch) => (
          <div className="tx-knob" key={ch.name}>
            <SwitchCard ch={ch} onPick={setPick} />
          </div>
        ))}
      </div>
      <div className="tx-sticks">
        {live ? (
          <>
            <LiveStick x={chUs("RUDDER")} y={chUs("THROTTLE")} label={t("газ · руль направления")} />
            <LiveStick x={chUs("AILERON")} y={chUs("ELEVATOR")} label={t("крен · тангаж")} />
          </>
        ) : (
          <>
            <div>
              <div className="stick" />
              <div className="stick-label">
                <Lock size={11} /> {t("газ · руль направления")}
              </div>
            </div>
            <div>
              <div className="stick" />
              <div className="stick-label">
                <Lock size={11} /> {t("крен · тангаж")}
              </div>
            </div>
          </>
        )}
      </div>
      {pick && <Picker target={pick} onClose={() => setPick(null)} />}
    </div>
  );
}
