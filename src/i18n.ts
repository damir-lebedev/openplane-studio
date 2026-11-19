// Перевод интерфейса. Русский — исходный язык: ключ — сама русская строка
// (как в gettext). Другие языки — словари «русская строка → перевод» без
// правки компонентов. Подстановки — {имя}.
//
// Словарей у языка два: строки приложения (en.json) и строки прошивки —
// описания из Config.h, названия плат и датчиков (en.firmware.json). Их
// сверяет с исходниками tools/i18n_check.py.
//
// Словари грузятся отдельным файлом, только когда язык выбран (≈400 КБ: русскому
// интерфейсу и слабому телефону они при запуске не нужны, P51) — switchLanguage().

type Vars = Record<string, string | number>;

/** Языки интерфейса: код → название на самом языке. */
export const LANGUAGES = { ru: "Русский", en: "English" } as const;
export type Language = keyof typeof LANGUAGES;

const dictionaries: Partial<Record<Language, Record<string, string>>> = {};

const loaders: Partial<Record<Language, () => Promise<Record<string, string>>>> = {
  en: () =>
    Promise.all([import("./locales/en.json"), import("./locales/en.firmware.json")]).then(([app, firmware]) => ({
      ...firmware.default,
      ...app.default,
    })),
};
let language: Language = "ru";

const STORED = "openplane.language";

const known = (lang: string | null | undefined): lang is Language => !!lang && lang in LANGUAGES;

// Русский интерфейс Windows ставят не все, кто читает по-русски: тогда подскажет часовой пояс.
const RU_LANGS = ["ru", "uk", "be", "kk", "ky", "uz", "tg", "hy", "az", "ka"];
const RU_ZONES = /^(Europe\/(Moscow|Kaliningrad|Samara|Ulyanovsk|Saratov|Astrakhan|Volgograd|Kirov|Simferopol|Minsk|Kyiv|Kiev|Chisinau)|Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Khandyga|Vladivostok|Ust-Nera|Magadan|Sakhalin|Srednekolymsk|Kamchatka|Anadyr|Almaty|Qostanay|Aqtobe|Aqtau|Atyrau|Oral|Qyzylorda|Bishkek|Tashkent|Samarkand|Dushanbe|Ashgabat|Yerevan|Baku|Tbilisi))$/;

/** Язык системы: русский для русских и соседних языков и часовых поясов, остальным английский. */
export function systemLanguage(languages: readonly string[], timeZone: string): Language {
  if (languages.some((l) => RU_LANGS.includes(l.toLowerCase().split("-")[0]))) return "ru";
  return RU_ZONES.test(timeZone) ? "ru" : "en";
}

/** Язык при запуске: выбранный в прошлый раз, иначе язык системы. */
export function startLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORED);
    if (known(saved)) return saved;
  } catch {
    // хранилища нет — по языку системы
  }
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    // без часового пояса — только по языкам
  }
  return systemLanguage(navigator.languages?.length ? navigator.languages : [navigator.language || ""], zone);
}

export function getLanguage(): Language {
  return language;
}

/** Локаль для дат и чисел на языке интерфейса (английский — с 24-часовым временем). */
export function locale(): string {
  return language === "ru" ? "ru-RU" : "en-GB";
}

export function setLanguage(lang: string | null | undefined) {
  language = known(lang) ? lang : startLanguage();
  try {
    localStorage.setItem(STORED, language);
  } catch {
    // не запомнится до следующего запуска — не страшно, язык есть в настройках
  }
  document.documentElement.lang = language;
}

/** Выбрать язык и дождаться его словаря (без сети: файл внутри приложения). Не загрузился — строки по-русски. */
export async function switchLanguage(lang: string | null | undefined): Promise<void> {
  setLanguage(lang);
  const want = language;
  if (dictionaries[want] || !loaders[want]) return;
  try {
    dictionaries[want] = await loaders[want]!();
  } catch {
    // словарь не прочитался — останется исходный русский, приложение работает
  }
}

/** Метка строки для перевода, когда t() позовут позже (таблицы имён): возвращает как есть. */
export const N_ = <T extends string>(text: T): T => text;

export function t(text: string, vars?: Vars): string {
  const translated = dictionaries[language]?.[text] ?? text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (_, key: string) => (key in vars ? String(vars[key]) : `{${key}}`));
}

/** 1 ошибка, 2 ошибки, 5 ошибок. В других языках — одна или много (перевод форм one и many). */
export function plural(n: number, one: string, few: string, many: string): string {
  if (language !== "ru") return t(n === 1 ? one : many);
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
