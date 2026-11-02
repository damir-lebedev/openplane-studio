// Тренировка failsafe на земле (P12): без винтов заармиться, выключить
// пульт и посмотреть по живым кадрам, что сделала прошивка. На земле
// (коптер не взлетал) прошивка при потере связи сразу делает DISARM и не
// даёт заармиться снова, пока связь не продержится и тумблер ARM не
// перещёлкнут (CopterController.h, handleFailsafe). Этапы в воздухе
// (ровно → процедура) на столе не проверить — их показывает схема
// «Связь пропала — что будет».

import type { CopterLive } from "../api";
import { N_ } from "../i18n";

export type DrillStep = "arm" | "radioOff" | "radioOn" | "done" | "failed";

export interface DrillState {
  step: DrillStep;
  /** время платы (live.t), мс: связь пропала / моторы встали / связь вернулась */
  lostAt?: number;
  stoppedAt?: number;
  backAt?: number;
  /** дом записан при ARM (для GPS-RESCUE) */
  homeAtArm?: boolean;
  /** почему не прошла (строка для t()) */
  fail?: string;
}

/** Моторы должны встать за это время после потери связи (прошивка — 0.3 с). */
export const STOP_LIMIT_MS = 1500;
/** Связь вернулась и держится — запрет ARM должен остаться всё это время. */
export const HOLD_MS = 1500;

export const drillStart = (): DrillState => ({ step: "arm" });

export function drillFeed(s: DrillState, live: CopterLive | null): DrillState {
  if (!live) return s;
  const linkOk = live.rx === "ok";
  switch (s.step) {
    case "arm":
      if (live.arm && linkOk) return { step: "radioOff", homeAtArm: live.gps?.home !== undefined };
      return s;
    case "radioOff":
      if (s.lostAt === undefined) {
        if (!live.arm) return { step: "arm" };   // пилот сам разармился — сначала
        return linkOk ? s : { ...s, lostAt: live.t };
      }
      if (!live.arm) return { ...s, step: "radioOn", stoppedAt: live.t };
      if (live.t - s.lostAt > STOP_LIMIT_MS) return { ...s, step: "failed", fail: N_("Связь пропала, а моторы крутятся дольше 1.5 с — прошивка не видит потерю связи (настройки приёмника, rxfail).") };
      return s;
    case "radioOn":
      if (live.arm) return { ...s, step: "failed", fail: N_("После включения пульта коптер заармился сам — так быть не должно.") };
      if (!linkOk) return s.backAt === undefined ? s : { ...s, backAt: undefined };
      if (s.backAt === undefined) return { ...s, backAt: live.t };
      return live.t - s.backAt >= HOLD_MS ? { ...s, step: "done" } : s;
    default:
      return s;
  }
}

/** Что сделать сейчас — подсказка шага (для t()). */
export function drillHint(s: DrillState): string {
  switch (s.step) {
    case "arm":
      return N_("Снимите винты. Включите пульт и заармьте коптер тумблером ARM — моторы закрутятся.");
    case "radioOff":
      return s.lostAt === undefined ? N_("Выключите пульт.") : N_("Связь пропала — жду, что моторы встанут…");
    case "radioOn":
      return N_("Моторы встали. Включите пульт, тумблер ARM не трогайте.");
    case "done":
      return N_("Готово: прошивка выключила моторы и не заармилась сама. Перед новым ARM перещёлкните тумблер.");
    default:
      return s.fail ?? "";
  }
}

/** Время реакции, мс (от потери связи до остановки моторов). */
export const drillReactionMs = (s: DrillState) => (s.lostAt !== undefined && s.stoppedAt !== undefined ? s.stoppedAt - s.lostAt : undefined);
