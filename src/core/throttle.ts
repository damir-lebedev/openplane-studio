// Не чаще раза в ms, но последнее значение не теряется: живые кадры с платы
// идут 10–50 раз в секунду, а слабому телефону хватает 4 перерисовок (P51) —
// промежуточные кадры отбрасываются, последний доходит после паузы.

export function throttleLatest<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  now: () => number = Date.now,
): (...args: A) => void {
  if (ms <= 0) return fn;
  let last = -Infinity;
  let pending: A | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (!pending) return;
    const args = pending;
    pending = null;
    last = now();
    fn(...args);
  };
  return (...args: A) => {
    const wait = last + ms - now();
    if (wait <= 0 && !timer) {
      last = now();
      fn(...args);
      return;
    }
    pending = args;
    if (!timer) timer = setTimeout(flush, Math.max(0, wait));
  };
}
