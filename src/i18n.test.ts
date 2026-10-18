// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { getLanguage, plural, setLanguage, systemLanguage, t } from "./i18n";
import en from "./locales/en.json";
import enFirmware from "./locales/en.firmware.json";

const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(" ");

describe("перевод интерфейса", () => {
  afterEach(() => setLanguage("ru"));

  it("русский — исходные строки, английский — из словарей приложения и прошивки", () => {
    setLanguage("ru");
    expect(t("Плата")).toBe("Плата");
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(t("Плата")).toBe("Board");
    expect(t("работает, на {a}", { a: "0x68" })).toBe("working, at 0x68");
    expect(t("мкс")).toBe("µs");                       // единица из Config.h
    expect(t("строка, которой нет в словаре")).toBe("строка, которой нет в словаре");
  });

  it("множественное число: русские три формы, в английском — одна или много", () => {
    expect(plural(1, "ошибка", "ошибки", "ошибок")).toBe("ошибка");
    expect(plural(3, "ошибка", "ошибки", "ошибок")).toBe("ошибки");
    expect(plural(11, "ошибка", "ошибки", "ошибок")).toBe("ошибок");
    setLanguage("en");
    expect(plural(1, "ошибка", "ошибки", "ошибок")).toBe("error");
    expect(plural(3, "ошибка", "ошибки", "ошибок")).toBe("errors");
  });

  it("язык системы: по списку языков, иначе по часовому поясу", () => {
    expect(systemLanguage(["en-US", "en"], "Europe/Moscow")).toBe("ru");   // английская Windows в Москве
    expect(systemLanguage(["uk-UA"], "")).toBe("ru");
    expect(systemLanguage(["de-DE", "en"], "Europe/Berlin")).toBe("en");
    expect(systemLanguage(["en-US"], "America/New_York")).toBe("en");
  });

  it("незнакомый язык — по языку системы", () => {
    setLanguage("xx");
    expect(["ru", "en"]).toContain(getLanguage());
  });

  it("в переводе те же подстановки, что в строке", () => {
    const bad = Object.entries({ ...en, ...enFirmware }).filter(([k, v]) => vars(k) !== vars(v));
    expect(bad).toEqual([]);
  });
});
