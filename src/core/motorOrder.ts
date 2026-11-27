// Порядок выходов моторов (motor_output_reordering, как в Betaflight):
// мотор i схемы — на выход платы order[i] (с нуля). Правила — как в прошивке
// (copter/Params.h motorOrder): до 8 чисел 0..7 без повторов, не названные
// моторы — на свободные выходы по возрастанию, пусто — по порядку.

export const MAX_OUTPUTS = 8;

/** Строка настройки -> выход каждого из 8 моторов; null — не так написано. */
export function parseMotorOrder(text: string | undefined | null): number[] | null {
  const s = (text ?? "").trim();
  const order: number[] = [];
  const used = new Set<number>();
  if (s !== "") {
    for (const part of s.split(",")) {
      const p = part.trim();
      if (!/^\d+$/.test(p)) return null;
      const v = Number(p);
      if (v >= MAX_OUTPUTS || used.has(v) || order.length >= MAX_OUTPUTS) return null;
      used.add(v);
      order.push(v);
    }
  }
  for (let next = 0; order.length < MAX_OUTPUTS; next++) {
    if (!used.has(next)) {
      used.add(next);
      order.push(next);
    }
  }
  return order;
}

/** По порядку — пусто (как хранит прошивка), иначе 8 чисел через запятую (как пишет BF). */
export function formatMotorOrder(order: number[]): string {
  return order.every((v, i) => v === i) ? "" : order.join(",");
}

/** Мотор a и мотор b меняются выходами. */
export function swapOutputs(order: number[], a: number, b: number): number[] {
  const next = [...order];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
