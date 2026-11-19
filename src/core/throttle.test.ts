import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { throttleLatest } from "./throttle";

describe("живые кадры на телефоне: не чаще раза в 250 мс, последний не теряется", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("первый кадр сразу, промежуточные отброшены, последний — после паузы", () => {
    const got: number[] = [];
    const f = throttleLatest((n: number) => got.push(n), 250);
    f(1);
    expect(got).toEqual([1]);
    for (let n = 2; n <= 5; n++) {
      vi.advanceTimersByTime(50);
      f(n); // 10 кадров в секунду (каждые 50 мс здесь)
    }
    expect(got).toEqual([1]);
    vi.advanceTimersByTime(50); // 250 мс с первого
    expect(got).toEqual([1, 5]);
    vi.advanceTimersByTime(1000); // плата замолчала — ничего лишнего
    expect(got).toEqual([1, 5]);
    f(6); // после тишины — снова сразу
    expect(got).toEqual([1, 5, 6]);
  });

  it("поток 20 Гц за секунду → 4–5 перерисовок, и последняя — с последним кадром", () => {
    const got: number[] = [];
    const f = throttleLatest((n: number) => got.push(n), 250);
    for (let n = 1; n <= 20; n++) {
      f(n);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(300);
    expect(got.length).toBeGreaterThanOrEqual(4);
    expect(got.length).toBeLessThanOrEqual(6);
    expect(got.at(-1)).toBe(20);
  });

  it("0 мс — без задержек (компьютер)", () => {
    const fn = vi.fn();
    const f = throttleLatest(fn, 0);
    f(1);
    f(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
