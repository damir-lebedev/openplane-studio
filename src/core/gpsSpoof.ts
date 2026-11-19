// Подмена GPS (P43 а): что прошивка проверяет и что видно сейчас.
// Прошивка (copter/GpsIntegrity.h) сверяет каждый фикс с акселерометром,
// ветром, барометром и флагом приёмника; подмена — GPS выключен из
// навигации до посадки, в живом кадре gps.spoof (причина) и gps.trust 0…100.

import type { CopterLive } from "../api";
import { N_ } from "../i18n";

export type SpoofReason = "JUMP" | "VELOCITY" | "WIND" | "ALTITUDE" | "RECEIVER";

/** Причина подмены словами (ключ перевода). */
export const SPOOF_REASON_TEXT: Record<SpoofReason, string> = {
  JUMP: N_("точка прыгнула дальше, чем коптер мог долететь"),
  VELOCITY: N_("GPS разгоняется, а акселерометр — нет (увод)"),
  WIND: N_("ветер «сменился» на 5 м/с — скорость GPS подменена"),
  ALTITUDE: N_("высота GPS разошлась с барометром"),
  RECEIVER: N_("приёмник сам сообщил о подмене"),
};

export type SpoofView = {
  /** есть ли данные: GPS подключён и прошивка шлёт доверие */
  known: boolean;
  /** доверие 0…100 */
  trust: number;
  reason: SpoofReason | null;
  /** уровень для цвета: ok — спокойно, warn — близко к порогу, bad — подмена */
  level: "ok" | "warn" | "bad";
};

export function spoofView(live: CopterLive | null): SpoofView {
  const g = live?.gps;
  if (!g || typeof g.trust !== "number") return { known: false, trust: 0, reason: null, level: "ok" };
  const reason = g.spoof && g.spoof in SPOOF_REASON_TEXT ? (g.spoof as SpoofReason) : null;
  const trust = Math.max(0, Math.min(100, Math.round(g.trust)));
  const level = reason ? "bad" : trust < 40 ? "warn" : "ok";
  return { known: true, trust, reason, level };
}

/** Настройки защиты: включена ли проверка и предупреждение в очках. */
export function spoofSettings(params: Record<string, { value: unknown } | undefined>, pending: Record<string, unknown> = {}) {
  const on = (name: string) => String(name in pending ? pending[name] : (params[name]?.value ?? "ON")) !== "OFF";
  return {
    supported: "gps_spoof_detect" in params,
    detect: on("gps_spoof_detect"),
    osdWarn: on("osd_warn_gps_spoof"),
  };
}
