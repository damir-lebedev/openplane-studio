import { describe, expect, it } from "vitest";

import { bytesText, checkOnStart, checkSourceOnStart, etaSeconds, fraction, notesLines, shouldOffer, shouldOfferSource, UpdateInfo } from "./update";

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

describe("исходники прошивки (P60)", () => {
  const fresh = { reference: "main", local: "a".repeat(40), remote: "b".repeat(40), newer: true, ahead: 3, notes: [] };

  it("сверяет при запуске, только если есть папка, не телефон и версия не закреплена", () => {
    expect(checkSourceOnStart({ firmwareSource: "C:/src" }, false)).toBe(true);
    expect(checkSourceOnStart({}, false)).toBe(false);
    expect(checkSourceOnStart({ firmwareSource: "C:/src" }, true)).toBe(false);
    expect(checkSourceOnStart({ firmwareSource: "C:/src", updateCheck: false }, false)).toBe(false);
    expect(checkSourceOnStart({ firmwareSource: "C:/src", firmwareVersion: "v0.6.0" }, false)).toBe(false);
  });

  it("предлагает новый коммит, пока его не пропустили", () => {
    expect(shouldOfferSource(fresh, {})).toBe(true);
    expect(shouldOfferSource({ ...fresh, newer: false }, {})).toBe(false);
    expect(shouldOfferSource(fresh, { sourceSkip: fresh.remote })).toBe(false);
    expect(shouldOfferSource(fresh, { sourceSkip: "c".repeat(40) })).toBe(true);
    expect(shouldOfferSource(null, {})).toBe(false);
  });
});
