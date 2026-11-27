import { describe, expect, it } from "vitest";
import { formatMotorOrder, parseMotorOrder, swapOutputs } from "./motorOrder";

describe("motor_output_reordering", () => {
  it("пусто — по порядку, не названные — свободные выходы", () => {
    expect(parseMotorOrder("")).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(parseMotorOrder(undefined)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(parseMotorOrder("1, 0,3")).toEqual([1, 0, 3, 2, 4, 5, 6, 7]);
  });

  it("повторы, выход за 7 и мусор — ошибка", () => {
    expect(parseMotorOrder("1,1")).toBeNull();
    expect(parseMotorOrder("0,8")).toBeNull();
    expect(parseMotorOrder("a")).toBeNull();
    expect(parseMotorOrder("0,,1")).toBeNull();
  });

  it("обмен двух моторов и запись как в BF", () => {
    const o = swapOutputs(parseMotorOrder("")!, 0, 1);
    expect(formatMotorOrder(o)).toBe("1,0,2,3,4,5,6,7");
    expect(formatMotorOrder(swapOutputs(o, 0, 1))).toBe("");
  });
});
