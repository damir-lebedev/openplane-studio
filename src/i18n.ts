// Перевод интерфейса. Русский — исходный язык: ключ — сама русская строка
// (как в gettext). Другие языки добавятся словарями «русская строка →
// перевод» без правки компонентов. Подстановки — {имя}.

type Vars = Record<string, string | number>;

const dictionaries: Record<string, Record<string, string>> = {};
let language = "ru";

export function setLanguage(lang: string) {
  language = lang;
}

export function t(text: string, vars?: Vars): string {
  const translated = dictionaries[language]?.[text] ?? text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (_, key: string) => (key in vars ? String(vars[key]) : `{${key}}`));
}

/** 1 ошибка, 2 ошибки, 5 ошибок. */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
