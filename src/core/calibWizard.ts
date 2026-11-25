// Мастер калибровок коптера (i — гироскоп, a — нуль акселерометра, o — установка
// платы тремя позами): шаги с позой для картинки и разбор ответа платы — строки
// консоли с момента нажатия «Начать» (тексты — из прошивки: ImuSensorBase.h,
// CopterConsole.h, main_copter.cpp feedAccCalibration).

import { N_ } from "../i18n";

export type CalibKey = "i" | "a" | "o";
/** Поза на картинке: неподвижно, ровно, нос вверх, правый борт вниз. */
export type CalibPose = "still" | "level" | "noseUp" | "rightDown";

export interface CalibStep {
  pose: CalibPose;
  title: string;
  text: string;
}

export const CALIB_TITLES: Record<CalibKey, string> = {
  i: N_("Гироскоп"),
  a: N_("Нуль акселерометра"),
  o: N_("Установка платы"),
};

export const CALIB_STEPS: Record<CalibKey, CalibStep[]> = {
  i: [{ pose: "still", title: N_("Не трогайте коптер"), text: N_("Плата меряет нуль гироскопа ~1–2 с. Стол не толкать, моторы не крутятся.") }],
  a: [{ pose: "level", title: N_("Поставьте ровно"), text: N_("Коптер на ровном столе, неподвижно ~0.5 с. Итог — acc_calibration, горизонт в очках станет ровным.") }],
  o: [
    { pose: "level", title: N_("Ровно"), text: N_("Поставьте коптер ровно, как в висении, и держите неподвижно ~1 с — шаг засчитается сам.") },
    { pose: "noseUp", title: N_("Нос вверх"), text: N_("Поднимите нос на 30–60° (передние моторы вверх), борта ровно, держите ~1 с.") },
    { pose: "rightDown", title: N_("Правый борт вниз"), text: N_("Нос обратно, опустите правый борт на 30–60° (правые моторы вниз), держите ~1 с.") },
  ],
};

export type CalibState = "wait" | "running" | "done" | "failed";

export interface CalibProgress {
  /** текущий шаг (индекс в CALIB_STEPS[key]) */
  step: number;
  /** сколько шагов засчитано */
  passed: number;
  state: CalibState;
  /** итог или причина отказа строкой платы; tone warn — предупреждение по ходу */
  message?: string;
  tone?: "ok" | "warn" | "err";
}

/** Сколько ждать первого ответа платы, мс. */
export const CALIB_REPLY_TIMEOUT_MS = 5000;

const ARMED = "Только без ARM";

/** Строки после «имя_датчика: » — без него (у второго гироскопа своё имя). */
const tail = (l: string) => l.replace(/^[^:]{1,24}:\s*/, "");

/**
 * Где сейчас калибровка по строкам консоли с момента нажатия.
 * elapsedMs — сколько прошло; нет ответа дольше CALIB_REPLY_TIMEOUT_MS — отказ.
 */
export function calibProgress(key: CalibKey, lines: string[], elapsedMs = 0): CalibProgress {
  const res: CalibProgress = { step: 0, passed: 0, state: "wait" };
  const fail = (l: string) => Object.assign(res, { state: "failed" as const, message: l.trim(), tone: "err" as const });
  for (const l of lines) {
    if (l.includes(ARMED)) return fail(N_("Плата в ARM — калибровки только без ARM."));
    if (key === "i") {
      if (l.includes("калибровка гироскопа")) Object.assign(res, { state: "running", message: undefined, tone: undefined });
      else if (l.includes("трясётся")) Object.assign(res, { state: "running", message: tail(l), tone: "warn" });
      else if (l.includes("калибровка не удалась")) return fail(l);
      else if (l.includes("калибровка завершена")) Object.assign(res, { state: "done", passed: 1, message: tail(l), tone: "ok" });
    } else if (key === "a") {
      if (l.includes("Нуль акселерометра: коптер стоит")) res.state = "running";
      else if (l.includes("acc_calibration =")) Object.assign(res, { state: "done", passed: 1, message: l.trim(), tone: "ok" });
      else if (l.includes("Нуль акселерометра: не удалось") || l.includes("акселерометра на этой сборке не подключена")) return fail(l);
    } else {
      const m = /Шаг (\d)\/3/.exec(l);
      if (l.includes("Калибровка установки:") || l.includes("калибровка установки —")) res.state = "running";
      if (m) Object.assign(res, { state: "running", step: Number(m[1]) - 1, passed: Number(m[1]) - 1, message: undefined, tone: undefined });
      else if (l.includes("засчитано")) res.passed = Math.max(res.passed, res.step + 1);
      else if (l.includes("установка сохранена")) Object.assign(res, { state: "done", step: 2, passed: 3, message: tail(l), tone: "ok" });
      else if (l.includes("калибровка установки отклонена") || l.includes("поза не дождалась") || l.includes("калибровка установки невозможна"))
        return fail(l);
    }
  }
  if (res.state === "wait" && elapsedMs > CALIB_REPLY_TIMEOUT_MS)
    return fail(N_("Плата не ответила — консоль занята (открыт CLI?) или прошивка старая."));
  return res;
}

/** Строки консоли, пришедшие после отметки seqAtStart (consoleSeq в момент нажатия). */
export function linesSince(lines: string[], seq: number, seqAtStart: number): string[] {
  const n = Math.max(0, Math.min(lines.length, seq - seqAtStart));
  return n ? lines.slice(-n) : [];
}
