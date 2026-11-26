// «Моторы» (096): мастер направления кликом, как в конфигураторе BF. Все
// моторы крутятся тихо; пилот щёлкает по тому, что крутится не туда, — мотор
// встаёт, регулятор получает «обратное»/«обычное» (DShot 8/7), мотор крутится
// снова. В конце — «сохранить» (DShot 12) всем. На старте всем шлётся
// «обычное»: какое направление было сохранено раньше — с платы не узнать,
// а так мастер знает, что сейчас у каждого.

export type Dir = "normal" | "reversed";

/** Тяга мастера, %: моторы еле крутятся, но направление видно. */
export const WIZARD_PCT = 6;

/** Сколько ждать: мотор остановился (регулятор меняет направление только стоя) и команда ушла. */
export const STOP_MS = 700;
export const SETTLE_MS = 400;

export type Step = { line: string } | { wait: number } | { spin: boolean };

export function wizardPct(motorTestMax: number): number {
  return Math.max(1, Math.min(WIZARD_PCT, motorTestMax));
}

/** Начать: стоп, всем «обычное», затем крутить. */
export function startSteps(): Step[] {
  return [{ line: "motor stop" }, { line: "dshot all 7" }, { wait: SETTLE_MS }, { spin: true }];
}

/** Щелчок по мотору i: остановить всё, развернуть его, крутить дальше. */
export function flipSteps(i: number, dirs: Dir[]): { steps: Step[]; dirs: Dir[] } {
  const next = dirs.map((d, k) => (k === i ? (d === "normal" ? "reversed" : "normal") : d));
  const code = next[i] === "reversed" ? 8 : 7;
  return {
    dirs: next,
    steps: [{ spin: false }, { line: "motor stop" }, { wait: STOP_MS }, { line: `dshot ${i} ${code}` }, { wait: SETTLE_MS }, { spin: true }],
  };
}

/** Готово: стоп и «сохранить» всем — регуляторы помнят направление после питания. */
export function saveSteps(): Step[] {
  return [{ spin: false }, { line: "motor stop" }, { wait: STOP_MS }, { line: "dshot all 12" }];
}

/** Отмена: стоп; сохранённое в регуляторах вернётся после переподключения батареи. */
export function cancelSteps(): Step[] {
  return [{ spin: false }, { line: "motor stop" }];
}

/** Выполнить шаги по очереди; spin(false/true) — ползунки мастера. */
export async function runSteps(steps: Step[], io: { send: (line: string) => Promise<unknown>; spin: (on: boolean) => void; sleep?: (ms: number) => Promise<void> }) {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (const s of steps) {
    if ("line" in s) await io.send(s.line);
    else if ("wait" in s) await sleep(s.wait);
    else io.spin(s.spin);
  }
}
