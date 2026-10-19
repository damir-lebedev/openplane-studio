// Короткие русские имена режимов, функций и крутилок для карточек. Новый
// режим в прошивке без имени здесь покажется как есть (имя из прошивки).

import { N_, t } from "../i18n";
import { Binding, Manifest } from "./manifest";
import { ItemKind, itemById } from "./rules";

const MODES: Record<string, string> = {
  MODE_MANUAL: N_("Ручной"),
  MODE_STABILIZE: N_("Стабилизация"),
  MODE_AUTO_TAKEOFF: N_("Автовзлёт с полосы"),
  MODE_ALT_HOLD: N_("Удержание высоты"),
  MODE_ACRO: N_("Акро"),
  MODE_CRUISE: N_("Круиз"),
  MODE_LOITER: N_("Круги"),
  MODE_RTH: N_("Домой"),
  MODE_LAUNCH: N_("Автовзлёт с руки"),
  MODE_AUTO_LAND: N_("Автопосадка"),
  MODE_SOARING: N_("Парение"),
  MODE_RESCUE: N_("Спасите"),
};

const FEATURES: Record<string, string> = {
  FLAPS: N_("Закрылки"),
  AIRBRAKE: N_("Воздушный тормоз"),
  AUTO_TRIM: N_("Автотриммер"),
  TURN_COORDINATION: N_("Координация разворота"),
  MOTOR_KILL: N_("Мотор выключен"),
  BEEPER: N_("Пищалка «я здесь»"),
  PAYLOAD_DROP: N_("Сброс груза"),
  GEOFENCE: N_("Геозабор"),
  HOME_RESET: N_("Дом здесь"),
  CAMERA_STAB: N_("Стабилизация камеры"),
  MOTOR_REVERSE: N_("Реверс мотора"),
};

const KNOBS: Record<string, string> = {
  STAB_GAIN: N_("Сила стабилизации"),
  MAX_BANK: N_("Предельный крен"),
  CRUISE_SPEED: N_("Скорость круиза"),
  FLAPS: N_("Закрылки плавно"),
  CAMERA_TILT: N_("Наклон камеры"),
  RATES: N_("Чувствительность стиков"),
  LOITER_RADIUS: N_("Радиус кругов"),
  THROTTLE_LIMIT: N_("Предел газа"),
};

export function itemLabel(kind: ItemKind, id: string): string {
  const map = kind === "mode" ? MODES : kind === "feature" ? FEATURES : KNOBS;
  return map[id] ? t(map[id]) : id.replace(/^MODE_/, "");
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
      const pos = b.modes.length === 3 ? [t("вверх"), t("середина"), t("вниз")] : [t("вверх"), t("вниз")];
      return `${ch}: ${b.modes.map((m, i) => `${pos[i]} — ${itemLabel("mode", m)}`).join(", ")}`;
    }
    case "mode":
      return t("{ch} вниз: {m} поверх любого режима", { ch, m: itemLabel("mode", b.mode) });
    case "feature":
      return t("{ch} вниз: {f}", { ch, f: itemLabel("feature", b.feature) });
    case "knob":
      return `${ch}: ${itemLabel("knob", b.knob).toLowerCase()}`;
  }
}

export function channelTitle(name: string): string {
  return name.replace(/^SW/, "Sw").replace(/^VR/, "Vr");
}

/** Протоколы приёмника (Config::RX_PROTOCOL). */
export const RECEIVERS: { id: string; title: string; desc: string }[] = [
  { id: "IBUS", title: "iBUS", desc: N_("FlySky: приёмники FS-iA6B, FS-iA10B (пульты FS-i6, FS-i6X)") },
  { id: "SBUS", title: "SBUS", desc: N_("FrSky, Futaba, RadioMaster, Jumper и другие — выход SBUS приёмника") },
  { id: "CRSF", title: "CRSF / ExpressLRS", desc: N_("ExpressLRS, TBS Crossfire и Tracer") },
];

export function receiverTitle(id: string): string {
  return RECEIVERS.find((r) => r.id === id)?.title ?? id;
}

/** Как подключить приёмник: провода на пины платы. */
export function receiverWiring(id: string, rx: string, tx: string): string {
  if (id === "SBUS") return t("Провод с выхода SBUS приёмника — на {rx}, питание 5 В. Инвертор не нужен: сигнал переворачивает сам UART платы.", { rx });
  if (id === "CRSF") return t("TX приёмника — на {rx}, RX приёмника — на {tx}, питание 5 В. Скорость 420000 — как у ExpressLRS по умолчанию.", { rx, tx });
  return t("Провод с разъёма iBUS приёмника (у FS-iA6B — «iBUS servo») — на {rx}, питание 5 В.", { rx });
}

/** Кадров от приёмника нет — что проверить. */
export function receiverSilentHint(id: string): string {
  if (id === "SBUS") return t("Кадров от приёмника нет — проверьте провод SBUS и питание; в настройках приёмника выход должен быть SBUS, а не PPM.");
  if (id === "CRSF") return t("Кадров от приёмника нет — проверьте, что TX приёмника идёт на RX платы, и питание; ExpressLRS: приёмник привязан к передатчику (одна binding phrase и версия).");
  return t("Кадров от приёмника нет — проверьте провод iBUS и питание приёмника.");
}
