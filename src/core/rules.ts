// Правила «что чему нужно» и проверки перед прошивкой. Источник требований —
// метки @needs/@better в прошивке (AutopilotTypes.h, Config.h), правила
// привязок — те же, что static_assert в Controls.h.

import { channelClashes } from "./channels";
import { pinIssues } from "./pins";
import { Binding, findBoard, isNone, Manifest, ManifestItem } from "./manifest";
import { formatValue, outOfRange, rangeText } from "./params";
import { effectiveParam, PlaneProject, StepId } from "./project";

export type Have = Record<string, boolean>;

const SENSOR_TOKENS = new Set(["imu", "baro", "mag", "gps", "pitot"]);

/** Что есть у этого самолёта — в словах меток @needs. */
export function haveTokens(manifest: Manifest, project: PlaneProject): Have {
  const board = findBoard(manifest, project.board);
  const out = board?.outputs;
  const a = project.airframe;
  return {
    imu: !isNone(project.sensors.imu),
    baro: !isNone(project.sensors.baro),
    mag: !isNone(project.sensors.mag),
    gps: !isNone(project.sensors.gps),
    pitot: !isNone(project.sensors.airspeed),
    wheels: a.gear !== "none",
    rudder: !!out?.rudder && a.rudder,
    flaperons: a.ailerons === "two",
    aux1: !!out?.aux1 && a.payload,
    aux2: !!out?.aux2 && a.camera,
    buzzer: !!out?.buzzer && a.buzzer,
    esc3d: a.esc === "bidirectional",
  };
}

export interface Availability {
  state: "ok" | "degraded" | "unavailable";
  missing: string[];
  better: string[];
}

export function availability(item: Pick<ManifestItem, "needs" | "better">, have: Have): Availability {
  const missing = (item.needs ?? []).filter((t) => !have[t]);
  const better = item.better.filter((t) => !have[t]);
  return { state: missing.length ? "unavailable" : better.length ? "degraded" : "ok", missing, better };
}

export function tokenNames(manifest: Manifest, tokens: string[]): string {
  return tokens.map((t) => manifest.needTokens[t] ?? t).join(", ");
}

export type ItemKind = "mode" | "feature" | "knob";
const KIND_WORD: Record<ItemKind, string> = { mode: "режима", feature: "функции", knob: "крутилки" };

/** «Для работы режима RTH нужны датчики: GPS» (или «нужно: …», если не только датчики). */
export function needText(manifest: Manifest, kind: ItemKind, name: string, missing: string[]): string {
  const onlySensors = missing.every((t) => SENSOR_TOKENS.has(t));
  const list = tokenNames(manifest, missing);
  return onlySensors
    ? `Для работы ${KIND_WORD[kind]} ${name} нужны датчики: ${list}`
    : `Для работы ${KIND_WORD[kind]} ${name} нужно: ${list}`;
}

export function itemById(manifest: Manifest, kind: ItemKind, id: string): ManifestItem | undefined {
  const list = kind === "mode" ? manifest.modes : kind === "feature" ? manifest.features : manifest.knobs;
  return list.find((i) => i.id === id);
}

export function bindingItems(b: Binding): { kind: ItemKind; id: string }[] {
  switch (b.kind) {
    case "modes":
      return b.modes.map((id) => ({ kind: "mode" as const, id }));
    case "mode":
      return [{ kind: "mode", id: b.mode }];
    case "feature":
      return [{ kind: "feature", id: b.feature }];
    case "knob":
      return [{ kind: "knob", id: b.knob }];
  }
}

export interface Issue {
  level: "error" | "warning" | "info";
  step: StepId;
  text: string;
  /** Что подсветить: канал, параметр, датчик. */
  target?: string;
}

export function validate(manifest: Manifest, project: PlaneProject): Issue[] {
  const issues: Issue[] = [];
  const add = (level: Issue["level"], step: StepId, text: string, target?: string) =>
    issues.push({ level, step, text, target });

  const board = findBoard(manifest, project.board);
  if (!board) {
    add("error", "board", `Платы ${project.board} нет в этой версии прошивки — выберите плату`);
    return issues;
  }
  const have = haveTokens(manifest, project);
  const a = project.airframe;

  // --- самолёт против платы
  if (a.motors > 1) add("error", "airframe", "Два мотора и больше прошивка пока не умеет — скоро");
  if (a.rudder && !board.outputs.rudder) add("error", "airframe", `У платы ${board.title} нет выхода руля направления`, "rudder");
  if (a.payload && !board.outputs.aux1) add("error", "airframe", `У платы ${board.title} нет выхода AUX1 для сброса груза`, "payload");
  if (a.camera && !board.outputs.aux2) add("error", "airframe", `У платы ${board.title} нет выхода AUX2 для камеры`, "camera");
  if (a.buzzer && !board.outputs.buzzer) add("error", "airframe", `У платы ${board.title} нет выхода пищалки`, "buzzer");

  // --- датчики против платы
  if (isNone(project.sensors.imu)) add("error", "sensors", "Без IMU не работает ничего, кроме ручного режима — выберите IMU", "imu");
  if (have.gps && !board.outputs.gpsTx) {
    add("warning", "sensors", `На ${board.title} у GPS нет провода TX: модуль работает только на приём, без настройки`, "gps");
  }
  if (board.blackbox === "none") add("info", "review", `На ${board.title} чёрного ящика нет — полёты не записываются`);

  // --- привязки (как static_assert в Controls.h)
  const channels = new Map(manifest.channels.list.map((c) => [c.name, c]));
  const used = new Map<number, string>();
  let modeSwitches = 0;
  if (project.bindings.length === 0) add("error", "switches", "Назначьте хотя бы один тумблер — например, тумблер режимов");
  for (const b of project.bindings) {
    const ch = channels.get(b.channel);
    if (!ch) {
      add("error", "switches", `Канала ${b.channel} нет в раскладке пульта`, b.channel);
      continue;
    }
    if (!ch.bindable) add("error", "switches", `${b.channel} занимать нельзя: стики и ARM закреплены`, b.channel);
    const prev = used.get(ch.index);
    if (prev !== undefined) add("error", "switches", `На ${b.channel} уже есть назначение (${prev})`, b.channel);
    used.set(ch.index, b.channel);
    if (b.kind === "modes") {
      modeSwitches++;
      if (b.modes.length === 3 && ch.positions === 2) {
        add("error", "switches", `${b.channel} — двухпозиционный тумблер, три режима на нём не поместятся`, b.channel);
      }
      if (b.modes.length < 2 || b.modes.length > 3) add("error", "switches", `На тумблере режимов 2 или 3 положения`, b.channel);
    }
    if (b.kind === "knob" && ch.positions !== "knob" && ch.positions !== null) {
      add("warning", "switches", `${b.channel} — тумблер, а назначена крутилка: значение будет прыгать по положениям`, b.channel);
    }
    if (b.kind !== "knob" && ch.positions === "knob") {
      add("warning", "switches", `${b.channel} — крутилка: включится, когда повернёте дальше 3/4 хода`, b.channel);
    }
    for (const { kind, id } of bindingItems(b)) {
      const item = itemById(manifest, kind, id);
      if (!item) {
        add("error", "switches", `В этой версии прошивки нет ${id}`, b.channel);
        continue;
      }
      const av = availability(item, have);
      if (av.state === "unavailable") add("error", "switches", needText(manifest, kind, item.name, av.missing), b.channel);
    }
  }
  if (modeSwitches > 1) add("error", "switches", "Тумблер выбора режимов может быть только один");
  for (const clash of channelClashes(manifest, project)) add("error", "rc", `Два органа пульта на одном канале: ${clash}`);
  if (modeSwitches === 0 && project.bindings.length) {
    add("warning", "switches", "Нет тумблера режимов: самолёт всё время в MANUAL, кроме режимов «поверх»");
  }
  const manual = project.bindings.some(
    (b) => (b.kind === "modes" && b.modes.includes("MODE_MANUAL")) || (b.kind === "mode" && b.mode === "MODE_MANUAL"),
  );
  if (!manual && modeSwitches > 0) {
    add("warning", "switches", "MANUAL нет ни на одном тумблере — главный режим безопасности лучше держать под пальцем");
  }

  // --- безопасность
  if (effectiveParam(manifest, project, "FAILSAFE_RTH") === true && !have.gps) {
    add("info", "safety", "Без GPS при потере связи самолёт не полетит домой, а будет планировать (мотор выключен, крылья ровно)");
  }
  if (effectiveParam(manifest, project, "GEOFENCE_ALWAYS_ON") === true && !have.gps) {
    add("warning", "safety", "Геозабор включён всегда, но без GPS он не работает", "GEOFENCE_ALWAYS_ON");
  }
  const throttle = Number(effectiveParam(manifest, project, "THROTTLE_LIMIT_PCT"));
  if (Number.isFinite(throttle) && throttle < 100) {
    add("warning", "safety", `Газ ограничен ${throttle} % — режим стенда. Перед полётом верните 100 %`, "THROTTLE_LIMIT_PCT");
  }

  // --- пины платы: ошибки — всегда, предупреждения — только у пинов, что поменял пилот
  // (заводские пины прошивки выбраны с оглядкой — не засорять замечания)
  const ownPins = board.macro ? project.boardParams[board.macro] ?? {} : {};
  for (const pi of pinIssues(manifest, project)) {
    if (pi.level === "error" || pi.target in ownPins) add(pi.level, "board", pi.text, pi.target);
  }

  // --- правки параметров
  for (const name of Object.keys(project.params)) {
    const p = manifest.params.find((x) => x.name === name && x.board === null);
    if (!p) add("error", "system", `Параметра ${name} нет в этой версии прошивки`, name);
    else if (p.fixed) add("error", "system", `${name} — параметр протокола, его менять нельзя`, name);
    else if (outOfRange(p, project.params[name])) {
      add("warning", "system", `${name} = ${formatValue(project.params[name])}${p.unit ? ` ${p.unit}` : ""} — обычно ${rangeText(p)}: так и задумано?`, name);
    }
  }
  return issues;
}

export function countIssues(issues: Issue[]) {
  return {
    errors: issues.filter((i) => i.level === "error").length,
    warnings: issues.filter((i) => i.level === "warning").length,
  };
}
