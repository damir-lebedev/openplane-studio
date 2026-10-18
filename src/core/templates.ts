// Шаблоны самолётов: готовые ответы мастера для типичных машин. Шаблон
// только заполняет поля — мастер всё равно проводит по шагам, и всё можно
// поменять. В шаблоне — только то, что есть в этой версии прошивки:
// чего нет (режима, параметра, датчика), то тихо пропускается.

import { N_ } from "../i18n";
import { Binding, isNone, Manifest, SensorCategory } from "./manifest";
import { setParamValue } from "./params";
import { Airframe, blankProject, PlaneProject } from "./project";
import { availability, bindingItems, haveTokens, itemById } from "./rules";

/** "auto" — первый датчик этого вида из прошивки, "none" — без него. */
type SensorPick = "auto" | "none";

export interface PlaneTemplate {
  id: string;
  title: string;
  desc: string;
  /** для кого и для чего — одной строкой */
  forWhom: string;
  airframe: Partial<Airframe>;
  sensors: Partial<Record<SensorCategory, SensorPick>>;
  bindings: Binding[];
  params: Record<string, unknown>;
}

export const TEMPLATES: PlaneTemplate[] = [
  {
    id: "trainer",
    title: N_("Тренер"),
    desc: N_("Верхнеплан с носовым колесом: взлёт с полосы, стабилизация, удержание высоты, закрылки."),
    forWhom: N_("первый свой самолёт с элеронами"),
    airframe: { motorPosition: "tractor", esc: "normal", ailerons: "two", rudder: true, gear: "nose", payload: false, camera: false, buzzer: true },
    sensors: { imu: "auto", baro: "auto", mag: "none", airspeed: "none", gps: "none" },
    bindings: [
      { kind: "modes", channel: "SWC", modes: ["MODE_MANUAL", "MODE_STABILIZE", "MODE_ALT_HOLD"] },
      { kind: "feature", channel: "SWB", feature: "FLAPS" },
      { kind: "feature", channel: "SWD", feature: "MOTOR_KILL" },
      { kind: "knob", channel: "VRA", knob: "STAB_GAIN" },
      { kind: "knob", channel: "VRB", knob: "RATES" },
    ],
    params: {},
  },
  {
    id: "student",
    title: N_("Ученик"),
    desc: N_("Летает в стабилизации, крен ограничен, «Спасите» под пальцем, геозабор и возврат домой при потере связи."),
    forWhom: N_("самые первые полёты, инструктор рядом"),
    airframe: { motorPosition: "tractor", esc: "normal", ailerons: "two", rudder: true, gear: "nose", payload: false, camera: false, buzzer: true },
    sensors: { imu: "auto", baro: "auto", mag: "auto", airspeed: "none", gps: "auto" },
    bindings: [
      { kind: "modes", channel: "SWC", modes: ["MODE_STABILIZE", "MODE_ALT_HOLD", "MODE_MANUAL"] },
      { kind: "mode", channel: "SWD", mode: "MODE_RESCUE" },
      { kind: "feature", channel: "SWB", feature: "MOTOR_KILL" },
      { kind: "knob", channel: "VRA", knob: "MAX_BANK" },
      { kind: "knob", channel: "VRB", knob: "THROTTLE_LIMIT" },
    ],
    params: { MAX_BANK_DEG: 35, GEOFENCE_ALWAYS_ON: true, FAILSAFE_RTH: true },
  },
  {
    id: "thermal",
    title: N_("Термик"),
    desc: N_("Мотопланер с руки: автовзлёт с броска, парение в потоках, тормоз флаперонами на посадке."),
    forWhom: N_("планер с мотором, длинное крыло, без шасси"),
    airframe: { motorPosition: "tractor", esc: "normal", ailerons: "two", rudder: true, gear: "none", payload: false, camera: false, buzzer: true },
    sensors: { imu: "auto", baro: "auto", mag: "none", airspeed: "auto", gps: "none" },
    bindings: [
      { kind: "modes", channel: "SWC", modes: ["MODE_MANUAL", "MODE_STABILIZE", "MODE_SOARING"] },
      { kind: "mode", channel: "SWD", mode: "MODE_LAUNCH" },
      { kind: "feature", channel: "SWB", feature: "AIRBRAKE" },
      { kind: "knob", channel: "VRA", knob: "STAB_GAIN" },
      { kind: "knob", channel: "VRB", knob: "FLAPS" },
    ],
    params: {},
  },
  {
    id: "delivery",
    title: N_("Доставка"),
    desc: N_("Круиз по скорости, круги над точкой, сброс груза тумблером, домой — тумблером и сам при потере связи."),
    forWhom: N_("грузовой самолёт с GPS: возить и сбрасывать"),
    airframe: { motorPosition: "tractor", esc: "bidirectional", ailerons: "two", rudder: true, gear: "tail", payload: true, camera: false, buzzer: true },
    sensors: { imu: "auto", baro: "auto", mag: "auto", airspeed: "auto", gps: "auto" },
    bindings: [
      { kind: "modes", channel: "SWC", modes: ["MODE_MANUAL", "MODE_CRUISE", "MODE_LOITER"] },
      { kind: "mode", channel: "SWD", mode: "MODE_RTH" },
      { kind: "feature", channel: "SWB", feature: "PAYLOAD_DROP" },
      { kind: "knob", channel: "VRA", knob: "CRUISE_SPEED" },
      { kind: "knob", channel: "VRB", knob: "LOITER_RADIUS" },
    ],
    params: { FAILSAFE_RTH: true },
  },
];

export function findTemplate(id: string): PlaneTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

function pickSensor(manifest: Manifest, cat: SensorCategory, pick: SensorPick, fallback: string): string {
  const opts = manifest.sensors.options[cat];
  if (pick === "none") return opts.find((o) => isNone(o.id))?.id ?? fallback;
  // «auto»: датчик из прошивки как есть, если он не «нет», иначе первый настоящий.
  const current = manifest.current.sensors[cat];
  if (current && !isNone(current)) return current;
  return opts.find((o) => !isNone(o.id))?.id ?? fallback;
}

/** Новый самолёт по шаблону: всё, чего нет в прошивке или на плате, пропускается. */
export function fromTemplate(manifest: Manifest, tpl: PlaneTemplate, name: string): PlaneProject {
  const p = blankProject(manifest, name);
  p.airframe = { ...p.airframe, ...tpl.airframe, template: tpl.id };
  for (const [cat, pick] of Object.entries(tpl.sensors) as [SensorCategory, SensorPick][]) {
    p.sensors[cat] = pickSensor(manifest, cat, pick, p.sensors[cat]);
  }
  const channels = new Map(manifest.channels.list.map((c) => [c.name, c]));
  const have = haveTokens(manifest, p);
  p.bindings = tpl.bindings.filter((b) => {
    const ch = channels.get(b.channel);
    if (!ch?.bindable) return false;
    if (b.kind === "modes" && b.modes.length === 3 && ch.positions !== 3) return false;
    return bindingItems(b).every(({ kind, id }) => {
      const item = itemById(manifest, kind, id);
      return item && availability(item, have).state !== "unavailable";
    });
  });
  for (const [name, value] of Object.entries(tpl.params)) {
    if (manifest.params.some((x) => x.name === name && x.board === null)) setParamValue(manifest, p, name, value);
  }
  return p;
}
