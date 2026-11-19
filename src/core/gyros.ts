// Два гироскопа на плате (прошивка copter/GyroSelect.h, Matek H743-SLIM V4):
// живой кадр "gyros": [живые, в деле, оси] — маски (бит 0 — первый, бит 1 —
// второй) и проверка осей второго (0 — коптер ещё не вращали, 1 — совпадают,
// 2 — не совпадают). Здесь — что из этого сказать пилоту.

import { N_ } from "../i18n";

export type GyroTone = "ok" | "warn" | "muted";

export interface GyroLine {
  /** «Первый» / «Второй» */
  name: string;
  /** что с ним: жив и в деле, жив и в запасе, не отвечает… */
  state: string;
  tone: GyroTone;
}

export interface GyroReport {
  lines: GyroLine[];
  /** подсказка под строками (проверка осей второго), или null */
  hint: string | null;
  hintTone: GyroTone;
}

export function gyroReport(g: [number, number, number]): GyroReport {
  const [alive, used, agree] = g;
  const line = (bit: number, name: string): GyroLine => {
    if (!(alive & bit)) return { name, state: N_("не отвечает"), tone: "warn" };
    if (used & bit) return { name, state: N_("в деле"), tone: "ok" };
    return { name, state: N_("в запасе"), tone: "muted" };
  };
  const lines = [line(1, N_("Первый")), line(2, N_("Второй"))];
  let hint: string | null = null;
  let hintTone: GyroTone = "muted";
  if (alive & 2) {
    if (agree === 0) {
      hint = N_("Второй пойдёт в дело, когда покажет то же, что первый: покрутите коптер в руках (или он проверится сам в первые секунды полёта).");
    } else if (agree === 2) {
      hint = N_("Оси второго гироскопа не совпали с первым — до перезагрузки он не используется. Сообщите нам модель платы.");
      hintTone = "warn";
    } else {
      hint = N_("Оси совпадают: откажет выбранный — коптер сам перейдёт на другой.");
      hintTone = "ok";
    }
  }
  return { lines, hint, hintTone };
}
