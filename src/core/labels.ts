// Короткие русские имена режимов, функций и крутилок для карточек. Новый
// режим в прошивке без имени здесь покажется как есть (имя из прошивки).

import { Binding, Manifest } from "./manifest";
import { ItemKind, itemById } from "./rules";

const MODES: Record<string, string> = {
  MODE_MANUAL: "Ручной",
  MODE_STABILIZE: "Стабилизация",
  MODE_AUTO_TAKEOFF: "Автовзлёт с полосы",
  MODE_ALT_HOLD: "Удержание высоты",
  MODE_ACRO: "Акро",
  MODE_CRUISE: "Круиз",
  MODE_LOITER: "Круги",
  MODE_RTH: "Домой",
  MODE_LAUNCH: "Автовзлёт с руки",
  MODE_AUTO_LAND: "Автопосадка",
  MODE_SOARING: "Парение",
  MODE_RESCUE: "Спасите",
};

const FEATURES: Record<string, string> = {
  FLAPS: "Закрылки",
  AIRBRAKE: "Воздушный тормоз",
  AUTO_TRIM: "Автотриммер",
  TURN_COORDINATION: "Координация разворота",
  MOTOR_KILL: "Мотор выключен",
  BEEPER: "Пищалка «я здесь»",
  PAYLOAD_DROP: "Сброс груза",
  GEOFENCE: "Геозабор",
  HOME_RESET: "Дом здесь",
  CAMERA_STAB: "Стабилизация камеры",
  MOTOR_REVERSE: "Реверс мотора",
};

const KNOBS: Record<string, string> = {
  STAB_GAIN: "Сила стабилизации",
  MAX_BANK: "Предельный крен",
  CRUISE_SPEED: "Скорость круиза",
  FLAPS: "Закрылки плавно",
  CAMERA_TILT: "Наклон камеры",
  RATES: "Чувствительность стиков",
  LOITER_RADIUS: "Радиус кругов",
  THROTTLE_LIMIT: "Предел газа",
};

export function itemLabel(kind: ItemKind, id: string): string {
  const map = kind === "mode" ? MODES : kind === "feature" ? FEATURES : KNOBS;
  return map[id] ?? id.replace(/^MODE_/, "");
}

/** «Домой (RTH)». */
export function itemTitle(manifest: Manifest, kind: ItemKind, id: string): string {
  const name = itemById(manifest, kind, id)?.name ?? id.replace(/^MODE_/, "");
  const label = itemLabel(kind, id);
  return label === name ? name : `${label} (${name})`;
}

/** Строка раскладки: «SwC: вверх — Ручной, середина — Стабилизация, вниз — Автовзлёт». */
export function bindingText(_manifest: Manifest, b: Binding): string {
  const ch = b.channel.replace(/^SW/, "Sw").replace(/^VR/, "Vr");
  switch (b.kind) {
    case "modes": {
      const pos = b.modes.length === 3 ? ["вверх", "середина", "вниз"] : ["вверх", "вниз"];
      return `${ch}: ${b.modes.map((m, i) => `${pos[i]} — ${itemLabel("mode", m)}`).join(", ")}`;
    }
    case "mode":
      return `${ch} вниз: ${itemLabel("mode", b.mode)} поверх любого режима`;
    case "feature":
      return `${ch} вниз: ${itemLabel("feature", b.feature)}`;
    case "knob":
      return `${ch}: ${itemLabel("knob", b.knob).toLowerCase()}`;
  }
}

export function channelTitle(name: string): string {
  return name.replace(/^SW/, "Sw").replace(/^VR/, "Vr");
}
