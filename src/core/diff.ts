// «Что изменилось» между двумя версиями самолёта — словами, а не JSON:
// для истории прошивок, отката и «что изменится на плате» перед прошивкой.

import { bindingText, channelTitle } from "./labels";
import { findBoard, Manifest, SENSOR_CATEGORIES } from "./manifest";
import { formatValue, sameValue } from "./params";
import { effectiveParam, PlaneProject, sensorLabel } from "./project";

export interface Change {
  group: "Плата" | "Самолёт" | "Датчики" | "Тумблеры" | "Каналы" | "Параметры" | "Пины";
  what: string;
  from: string;
  to: string;
}

const AIRFRAME: Record<string, [string, (v: unknown) => string]> = {
  motors: ["Моторов", (v) => String(v)],
  motorPosition: ["Мотор", (v) => (v === "pusher" ? "толкающий" : "тянущий")],
  esc: ["Регулятор", (v) => (v === "bidirectional" ? "двунаправленный" : "обычный")],
  ailerons: ["Элероны", (v) => (v === "one" ? "одна серва" : "по серве на элерон")],
  rudder: ["Руль направления", (v) => (v ? "есть" : "нет")],
  gear: ["Шасси", (v) => (v === "tail" ? "хвостовое колесо" : v === "nose" ? "носовое колесо" : "нет, с руки")],
  payload: ["Сброс груза", (v) => (v ? "есть" : "нет")],
  camera: ["Камера", (v) => (v ? "есть" : "нет")],
  buzzer: ["Пищалка", (v) => (v ? "есть" : "нет")],
};

const SENSOR_TITLES: Record<string, string> = { imu: "IMU", baro: "Барометр", mag: "Компас", airspeed: "Трубка Пито", gps: "GPS" };

/** Имена частых параметров словами; остальные — как в Config.h. */
const PARAM_TITLES: Record<string, string> = {
  AILERON_LEFT_REVERSED: "Реверс: левый элерон",
  AILERON_RIGHT_REVERSED: "Реверс: правый элерон",
  ELEVATOR_REVERSED: "Реверс: руль высоты",
  RUDDER_REVERSED: "Реверс: руль направления",
  FLAPS_REVERSED: "Реверс: закрылки",
  MOTOR_REVERSED: "Реверс: мотор",
  AUX1_REVERSED: "Реверс: сброс груза",
  AUX2_REVERSED: "Реверс: камера",
  CHANNEL_REVERSED: "Каналы пульта наоборот",
  THROTTLE_LIMIT_PCT: "Предел газа, %",
  FAILSAFE_RTH: "Без связи — домой",
  GEOFENCE_ALWAYS_ON: "Геозабор всегда",
};

export function paramTitle(name: string): string {
  return PARAM_TITLES[name] ?? name;
}

/** Значение для людей: у массива флагов — номера включённых каналов. */
function showValue(value: unknown): string {
  if (Array.isArray(value) && value.every((v) => typeof v === "boolean")) {
    const on = value.map((v, i) => (v ? `CH${i + 1}` : "")).filter(Boolean);
    return on.length ? on.join(", ") : "нет";
  }
  return formatValue(value);
}

/** Изменения от a к b. Пустой список — конфигурации одинаковые. */
export function diffProjects(manifest: Manifest, a: PlaneProject, b: PlaneProject): Change[] {
  const out: Change[] = [];

  if (a.board !== b.board) {
    out.push({ group: "Плата", what: "Плата", from: findBoard(manifest, a.board)?.title ?? a.board, to: findBoard(manifest, b.board)?.title ?? b.board });
  }

  for (const [key, [title, show]] of Object.entries(AIRFRAME)) {
    const va = (a.airframe as unknown as Record<string, unknown>)[key];
    const vb = (b.airframe as unknown as Record<string, unknown>)[key];
    if (va !== vb) out.push({ group: "Самолёт", what: title, from: show(va), to: show(vb) });
  }

  for (const cat of SENSOR_CATEGORIES) {
    if (a.sensors[cat] !== b.sensors[cat]) {
      out.push({ group: "Датчики", what: SENSOR_TITLES[cat], from: sensorLabel(manifest, cat, a.sensors[cat]), to: sensorLabel(manifest, cat, b.sensors[cat]) });
    }
  }

  const channels = new Set([...a.bindings.map((x) => x.channel), ...b.bindings.map((x) => x.channel)]);
  for (const ch of channels) {
    const ba = a.bindings.find((x) => x.channel === ch);
    const bb = b.bindings.find((x) => x.channel === ch);
    const ta = ba ? bindingText(manifest, ba) : "";
    const tb = bb ? bindingText(manifest, bb) : "";
    if (ta !== tb) {
      const strip = (t: string) => t.replace(/^[^:]+:\s*/, "");
      out.push({ group: "Тумблеры", what: channelTitle(ch), from: ba ? strip(ta) : "не используется", to: bb ? strip(tb) : "не используется" });
    }
  }

  const chNames = new Set([...Object.keys(a.channels), ...Object.keys(b.channels)]);
  for (const name of chNames) {
    const ia = a.channels[name] ?? manifest.channels.list.find((c) => c.name === name)?.index;
    const ib = b.channels[name] ?? manifest.channels.list.find((c) => c.name === name)?.index;
    if (ia !== ib && name !== "SWA") {
      out.push({ group: "Каналы", what: name === "ARM" ? "SwA (ARM)" : channelTitle(name), from: `CH${(ia ?? 0) + 1}`, to: `CH${(ib ?? 0) + 1}` });
    }
  }

  // Параметры — по действующим значениям: правка, вернувшая значение прошивки, — не изменение.
  const names = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
  for (const name of names) {
    const va = effectiveParam(manifest, a, name);
    const vb = effectiveParam(manifest, b, name);
    if (!sameValue(va, vb)) out.push({ group: "Параметры", what: paramTitle(name), from: showValue(va), to: showValue(vb) });
  }

  const macros = new Set([...Object.keys(a.boardParams), ...Object.keys(b.boardParams)]);
  for (const macro of macros) {
    const pa = a.boardParams[macro] ?? {};
    const pb = b.boardParams[macro] ?? {};
    for (const name of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      const def = manifest.params.find((p) => p.name === name && p.board === macro)?.value;
      const va = name in pa ? pa[name] : def;
      const vb = name in pb ? pb[name] : def;
      if (!sameValue(va, vb)) out.push({ group: "Пины", what: name, from: formatValue(va), to: formatValue(vb) });
    }
  }
  return out;
}

/** Откат: конфигурация из снимка, имя, история и наладка остаются нынешними. */
export function restoreConfig(target: PlaneProject, from: PlaneProject) {
  target.board = from.board;
  target.airframe = structuredClone(from.airframe);
  target.sensors = structuredClone(from.sensors);
  target.bindings = structuredClone(from.bindings);
  target.params = structuredClone(from.params);
  target.boardParams = structuredClone(from.boardParams);
  target.channels = structuredClone(from.channels);
}
