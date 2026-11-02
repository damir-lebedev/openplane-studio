import { describe, expect, it } from "vitest";

import { bytesText, checkOnStart, etaSeconds, fraction, notesLines, shouldOffer, UpdateInfo } from "./update";

const info: UpdateInfo = { version: "0.3.0", current: "0.2.0", newer: true, notes: "", page: "", published: "", asset: null };

describe("обновление приложения", () => {
  it("при запуске проверяет, пока не выключили", () => {
    expect(checkOnStart({})).toBe(true);
    expect(checkOnStart({ updateCheck: true })).toBe(true);
    expect(checkOnStart({ updateCheck: false })).toBe(false);
  });

  it("пропущенную версию не предлагает при запуске, по кнопке — предлагает", () => {
    expect(shouldOffer(info, {}, false)).toBe(true);
    expect(shouldOffer(info, { updateSkip: "0.3.0" }, false)).toBe(false);
    expect(shouldOffer(info, { updateSkip: "0.3.0" }, true)).toBe(true);
    expect(shouldOffer({ ...info, version: "0.3.1" }, { updateSkip: "0.3.0" }, false)).toBe(true);
    expect(shouldOffer({ ...info, newer: false }, {}, true)).toBe(false);
  });

  it("размер, доля и сколько осталось", () => {
    expect(bytesText(212 * 1024 * 1024, "МБ", "КБ")).toBe("212 МБ");
    expect(bytesText(5.5 * 1024 * 1024, "МБ", "КБ")).toBe("5.5 МБ");
    expect(bytesText(300, "МБ", "КБ")).toBe("1 КБ");
    expect(fraction(50, 200)).toBe(0.25);
    expect(fraction(undefined, 200)).toBe(0);
    expect(fraction(300, 200)).toBe(1);
    // 165 КБ/с, 200 МБ, прошло 10 с — около 20 минут
    const total = 200 * 1024 * 1024;
    const eta = etaSeconds(165 * 1024 * 10, total, 10_000)!;
    expect(eta).toBeGreaterThan(1200);
    expect(eta).toBeLessThan(1300);
    expect(etaSeconds(100, total, 1000)).toBeNull(); // рано судить
    expect(etaSeconds(total, total, 60_000)).toBeNull();
  });

  it("что нового — первые строки без заголовков", () => {
    const n = notesLines("## Что нового\n\n- **Автообновление**\n- Анкета\n\n- a\n- b\n- c\n- d", 4);
    expect(n.lines).toEqual(["- Автообновление", "- Анкета", "- a", "- b"]);
    expect(n.more).toBe(true);
    expect(notesLines("").lines).toEqual([]);
  });
});
