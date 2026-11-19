import { describe, expect, it } from "vitest";
import { checkBin, chipOfEnv, envFromBinName, exportBinName } from "./binFile";

const t = (s: string, v?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v?.[k] ?? `{${k}}`));

describe("готовый .bin на телефоне", () => {
  it("сборка по имени: релиз, экспорт с ПК, повторное скачивание", () => {
    expect(envFromBinName("firmware-matek-h743-quad.bin")).toBe("matek-h743-quad");
    expect(envFromBinName("firmware-matek-h743.bin")).toBe("matek-h743");
    expect(envFromBinName("Мой квадрик-stm32h743-devebox-quad.bin")).toBe("stm32h743-devebox-quad");
    expect(envFromBinName("/storage/emulated/0/Download/firmware-aocodarc-f405v3-quad (1).bin")).toBe("aocodarc-f405v3-quad");
    expect(envFromBinName("FIRMWARE-STM32H743.BIN")).toBe("stm32h743");
    expect(envFromBinName("firmware.bin")).toBeNull();
    // «devebox» не путается с «stm32h743»: берётся самое длинное совпадение
    expect(envFromBinName("x-stm32h743-devebox.bin")).toBe("stm32h743-devebox");
  });

  it("чип по сборке", () => {
    expect(chipOfEnv("matek-h743-quad")).toBe("h743");
    expect(chipOfEnv("aocodarc-f405v3-quad")).toBe("f405");
    expect(chipOfEnv("esp32-s3")).toBeNull();
    expect(chipOfEnv(null)).toBeNull();
  });

  it("подходящий файл — без ошибок, чип для DfuSe", () => {
    const r = checkBin({ name: "firmware-matek-h743-quad.bin", size: 400_000, boardEnv: "matek-h743-quad" }, t);
    expect(r).toEqual({ env: "matek-h743-quad", chip: "h743", error: null, warning: null });
  });

  it("файл другой платы — отказ до загрузчика", () => {
    const r = checkBin({ name: "firmware-matek-h743-quad.bin", size: 400_000, boardEnv: "aocodarc-f405v3-quad" }, t);
    expect(r.error).toContain("matek-h743-quad");
    expect(r.error).toContain("aocodarc-f405v3-quad");
    // плата уже в DFU (нет @id) — сверка с выбранной у коптера сборкой
    const c = checkBin({ name: "firmware-matek-h743-quad.bin", size: 400_000, boardEnv: null, copterEnv: "stm32h743-devebox-quad" }, t);
    expect(c.error).toContain("stm32h743-devebox-quad");
  });

  it("не .bin, пустой, ESP32, слишком большой", () => {
    expect(checkBin({ name: "firmware.hex", size: 10, boardEnv: null }, t).error).toContain(".bin");
    expect(checkBin({ name: "firmware-matek-h743.bin", size: 0, boardEnv: null }, t).error).toBeTruthy();
    expect(checkBin({ name: "firmware-esp32-s3.bin", size: 1000, boardEnv: null }, t).error).toContain("WiFi");
    const big = checkBin({ name: "firmware-aocodarc-f405v3-quad.bin", size: 900 * 1024, boardEnv: null }, t);
    expect(big.error).toContain("896");
    expect(checkBin({ name: "firmware-matek-h743.bin", size: 1900 * 1024, boardEnv: null }, t).error).toBeNull();
  });

  it("имя без сборки — можно, с предупреждением и чипом платы", () => {
    const r = checkBin({ name: "firmware.bin", size: 300_000, boardEnv: "matek-h743-quad" }, t);
    expect(r.error).toBeNull();
    expect(r.chip).toBe("h743");
    expect(r.warning).toContain("matek-h743-quad");
    expect(checkBin({ name: "firmware.bin", size: 300_000, boardEnv: null }, t).chip).toBeNull();
  });

  it("имя экспорта с ПК читается обратно", () => {
    const name = exportBinName('Мой "квадрик" 5/7', "matek-h743-quad");
    expect(name).toBe("Мой-квадрик-5-7-matek-h743-quad.bin");
    expect(envFromBinName(name)).toBe("matek-h743-quad");
    expect(exportBinName("  ", "matek-h743")).toBe("openplane-matek-h743.bin");
  });
});
