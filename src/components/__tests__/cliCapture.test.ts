import { describe, expect, it } from "vitest";

import { cliCapture } from "../copter/MiscTabs";

describe("CLI «В файл»", () => {
  it("вывод последнего diff/dump без кадров приложения и выхода", () => {
    const lines = [
      "# status",
      "MCU F405",
      "# diff all",
      "# version",
      "set copter_build = heavy10",
      '@live {"hz":1}',
      "profile 0",
      "# exit",
      "Выход из CLI.",
    ];
    expect(cliCapture(lines)).toEqual(["# diff all", "# version", "set copter_build = heavy10", "profile 0"]);
    expect(cliCapture([...lines, "# dump", "set a = 1\r"])).toEqual(["# dump", "set a = 1"]);
    expect(cliCapture(["# status", "MCU F405"])).toEqual([]);
  });
});
