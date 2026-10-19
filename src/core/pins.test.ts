import { describe, expect, it } from "vitest";

import manifestJson from "./__fixtures__/manifest.json";
import { Manifest } from "./manifest";
import { setParamValue } from "./params";
import { judgePin, pinChoices, pinIssues, pinTable } from "./pins";
import { importFromFirmware, PlaneProject } from "./project";
import { validate } from "./rules";

const manifest = manifestJson as unknown as Manifest;

function plane(env = "stm32h743-devebox", patch: (p: PlaneProject) => void = () => {}): PlaneProject {
  const p = importFromFirmware(manifest, "Т", env);
  patch(p);
  return p;
}

const errors = (p: PlaneProject) => pinIssues(manifest, p).filter((i) => i.level === "error");

describe("пины приёмника", () => {
  it("RX и TX приёмника — пара одного UART, у всех плат без ошибок", () => {
    expect(judgePin(pinTable("stm32h743-devebox")!, "uart_rx", "PE7").ok).toBe(true);
    const p = plane("stm32h743-devebox", (p) => setParamValue(manifest, p, "PIN_RC_TX", "PD1"));
    expect(errors(p).map((e) => e.text)).toContainEqual(expect.stringContaining("PIN_RC_RX"));
  });
});

describe("пины Matek H743", () => {
  it("занятое на плате — ошибка: CAN, OSD, второй IMU", () => {
    const table = pinTable("matek-h743")!;
    expect(judgePin(table, "uart_rx", "PD0").error).toMatch(/CAN/);
    expect(judgePin(table, "pwm", "PB13").error).toMatch(/OSD/);
    expect(judgePin(table, "pwm", "PD14").ok).toBe(true);   // S9 свободен
    expect(judgePin(table, "pwm", "PB0").what).toBe("TIM1_CH2N");
    const p = plane("matek-h743", (p) => setParamValue(manifest, p, "PIN_TELEM_RX", "PD0"));
    expect(errors(p).map((e) => e.text)).toContainEqual(expect.stringContaining("CAN"));
  });

  it("внешний разъём I2C — пара одной шины", () => {
    const table = pinTable("matek-h743")!;
    expect(judgePin(table, "i2c_sda", "PB7").what).toBe("I2C1");
    expect(judgePin(table, "i2c_scl", "PB6").what).toBe("I2C1");
  });
});

describe("пины платы", () => {
  it("заводские пины всех плат без ошибок, и проверка их не засоряет", () => {
    for (const env of ["stm32h743-devebox", "stm32h743", "matek-h743", "esp32-s3", "esp32-dev", "esp32-c3"]) {
      expect(errors(plane(env)).map((e) => e.text)).toEqual([]);
      expect(validate(manifest, plane(env)).filter((i) => i.step === "board")).toEqual([]);
    }
  });

  it("STM32: пин без таймера — не серво", () => {
    const p = plane("stm32h743-devebox", (p) => setParamValue(manifest, p, "PIN_ESC", "PC0"));
    expect(errors(p).map((e) => e.text)).toContainEqual(expect.stringContaining("PC0 не умеет ШИМ"));
  });

  it("STM32: два выхода на одном канале таймера", () => {
    const p = plane("stm32h743-devebox", (p) => setParamValue(manifest, p, "PIN_AILERON_RIGHT", "PA5"));
    expect(errors(p).some((e) => e.text.includes("TIM2_CH1"))).toBe(true);
  });

  it("STM32: SDA и SCL на разных шинах I2C", () => {
    const p = plane("stm32h743-devebox", (p) => setParamValue(manifest, p, "PIN_I2C_SDA", "PB7"));
    expect(errors(p).some((e) => e.text.includes("PIN_I2C_SDA, PIN_I2C_SCL"))).toBe(true);
  });

  it("STM32: занятый на плате пин (µSD, USB) — ошибка, разъём камеры — предупреждение", () => {
    const sd = plane("stm32h743-devebox", (p) => setParamValue(manifest, p, "PIN_BUZZER", "PC8"));
    const issue = validate(manifest, sd).find((i) => i.target === "PIN_BUZZER");
    expect(issue?.level).toBe("error");
    expect(issue?.text).toContain("µSD");
    const cam = plane("stm32h743-devebox", (p) => setParamValue(manifest, p, "PIN_BUZZER", "PC6"));
    expect(validate(manifest, cam).find((i) => i.target === "PIN_BUZZER")?.level).toBe("warning");
  });

  it("STM32: пин с занятым каналом таймера — в «заняты», с хозяином канала", () => {
    const choices = pinChoices(manifest, plane(), "PIN_ESC")!;
    expect(choices.find((c) => c.value === "PA5")).toMatchObject({ ok: true, usedBy: "PIN_AILERON_LEFT (тот же канал)" });
    expect(choices.find((c) => c.value === "PA11")?.ok).toBe(false);
  });

  it("ESP32: флеш и PSRAM — нельзя, вход-только — не выход, АЦП2 — с оговоркой", () => {
    expect(judgePin(pinTable("esp32-s3")!, "pwm", 35).error).toContain("PSRAM");
    expect(judgePin(pinTable("esp32-dev")!, "pwm", 34).error).toContain("только вход");
    expect(judgePin(pinTable("esp32-dev")!, "uart_rx", 34).ok).toBe(true);
    expect(judgePin(pinTable("esp32-dev")!, "adc", 25).warn).toContain("Wi-Fi");
  });

  it("варианты для выбора: подходящие с тем, что пин делает; занятые — с хозяином", () => {
    const choices = pinChoices(manifest, plane(), "PIN_ESC")!;
    expect(choices.find((c) => c.value === "PA3")).toMatchObject({ ok: true, label: "PA3 — TIM2_CH4" });
    expect(choices.find((c) => c.value === "PA0")).toMatchObject({ ok: true, usedBy: "PIN_AILERON_LEFT" });
    expect(choices.find((c) => c.value === "PC0")?.ok).toBe(false);
  });
});
