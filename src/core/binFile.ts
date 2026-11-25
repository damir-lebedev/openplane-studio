// Готовый .bin на телефоне (P48): для какой сборки файл, подходит ли он плате.
// Телефон не собирает прошивку (Config.h компилируется только на ПК), поэтому
// приходит файл: из релиза (`firmware-<env>.bin`) или экспорт с ПК
// (`<самолёт>-<env>.bin`). Сборка — по концу имени, плата — по своему `@id`.
// Чип и размер ещё раз проверит DfuSe в Rust (WRONG_CHIP, TOO_BIG) — здесь
// понятная фраза до того, как плата уйдёт в загрузчик.

/** Сборки STM32, которые прошиваются с телефона (как в релизе P49 + самолёты). */
export const PHONE_ENVS = [
  "stm32h743-devebox",
  "stm32h743-devebox-quad",
  "matek-h743",
  "matek-h743-quad",
  "aocodarc-f405v3-quad",
  "speedybee-f405v4-quad",
  "hakrc-f405-quad",
  "speedybee-f405v3-quad",
  "getfun-f405v3-quad",
  "stm32h743",
] as const;

/** Сборки, чьи `firmware-<env>.bin` лежат в релизе Studio (job firmware в installers.yml,
 *  как RELEASE_ENVS в update.rs). getfun-f405v3-quad нет — `#error` до дампа платы. */
export const RELEASE_ENVS = [
  "stm32h743-devebox",
  "stm32h743-devebox-quad",
  "matek-h743",
  "matek-h743-quad",
  "aocodarc-f405v3-quad",
  "speedybee-f405v4-quad",
  "hakrc-f405-quad",
  "speedybee-f405v3-quad",
] as const;

/** Сборка для «Скачать прошивку»: плата на связи, иначе выбранная у коптера; null — в релизе нет. */
export function releaseEnv(boardEnv: string | null | undefined, copterEnv: string | null | undefined): string | null {
  const env = boardEnv || copterEnv || null;
  return env && (RELEASE_ENVS as readonly string[]).includes(env) ? env : null;
}

/** ESP32 — по WiFi (P50), не по USB-OTG. */
const ESP_ENV = /^esp32/;

const FLASH_BASE = 0x0800_0000;
/** Начало сектора настроек — образ не должен туда заходить (как LIMIT_* в dfuse.rs). */
const LIMITS: Record<string, number> = { h743: 0x081e_0000 - FLASH_BASE, f405: 0x080e_0000 - FLASH_BASE };

/** Сборка по имени файла: самое длинное известное имя, которым оно заканчивается. */
export function envFromBinName(fileName: string, known: readonly string[] = PHONE_ENVS): string | null {
  const base = fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\s*\(\d+\)(?=\.bin$)/i, "") // «firmware-matek-h743 (1).bin» — второе скачивание
    .replace(/\.bin$/i, "")
    .toLowerCase();
  const all = [...new Set([...known, "esp32-s3", "esp32-c3", "esp32-dev"])].sort((a, b) => b.length - a.length);
  return all.find((env) => base === env || base.endsWith(`-${env}`) || base.endsWith(`_${env}`)) ?? null;
}

/** Чип по имени сборки: h743 / f405, иначе null. */
export function chipOfEnv(env: string | null | undefined): "h743" | "f405" | null {
  if (!env) return null;
  if (/h743/.test(env)) return "h743";
  if (/f405/.test(env)) return "f405";
  return null;
}

export interface BinCheck {
  /** сборка файла (по имени) или null — имя не говорит */
  env: string | null;
  /** чип для DfuSe: по файлу, иначе по плате */
  chip: "h743" | "f405" | null;
  /** почему прошивать нельзя (null — можно) */
  error: string | null;
  /** можно, но стоит знать (имя без сборки) */
  warning: string | null;
}

export interface BinInput {
  name: string;
  size: number;
  /** env из `@id` платы на связи; null — платы нет или она уже в DFU */
  boardEnv: string | null;
  /** сборка, выбранная у коптера в ангаре */
  copterEnv?: string | null;
}

type Tr = (s: string, vars?: Record<string, string | number>) => string;

/** Проверка файла до прошивки. `t` — перевод (фразы — ключи en.json). */
export function checkBin(input: BinInput, t: Tr): BinCheck {
  const env = envFromBinName(input.name, [...PHONE_ENVS, ...(input.copterEnv ? [input.copterEnv] : []), ...(input.boardEnv ? [input.boardEnv] : [])]);
  const target = input.boardEnv ?? input.copterEnv ?? null;
  const chip = chipOfEnv(env) ?? chipOfEnv(target);
  const res = (error: string | null, warning: string | null = null): BinCheck => ({ env, chip, error, warning });

  if (!/\.bin$/i.test(input.name)) return res(t("Нужен файл .bin — «{name}» не подходит.", { name: input.name }));
  if (input.size <= 0) return res(t("Файл пустой."));
  if (env && ESP_ENV.test(env)) return res(t("Это прошивка ESP32 — она ставится по WiFi, не по кабелю."));
  if (env && input.boardEnv && env !== input.boardEnv) {
    return res(t("Файл для {file}, а на плате {board}. Возьмите файл для своей платы.", { file: env, board: input.boardEnv }));
  }
  if (env && !input.boardEnv && input.copterEnv && env !== input.copterEnv) {
    return res(t("Файл для {file}, а у коптера выбрана {board}. Возьмите файл для своей платы.", { file: env, board: input.copterEnv }));
  }
  const limit = chip ? LIMITS[chip] : undefined;
  if (limit && input.size > limit) {
    return res(t("Файл {kb} КБ — больше, чем помещается до настроек ({max} КБ). Это не прошивка этой платы.", { kb: Math.ceil(input.size / 1024), max: limit / 1024 }));
  }
  if (!env) {
    return target
      ? res(null, t("По имени файла не видно, для какой он платы. Прошиваю как {board} — чип проверю перед записью.", { board: target }))
      : res(null, t("По имени файла не видно, для какой он платы — чип проверю перед записью."));
  }
  return res(null);
}

/** Имя файла экспорта с ПК: `<самолёт>-<env>.bin` (без символов, запрещённых в именах файлов). */
export function exportBinName(planeName: string, env: string): string {
  const name = planeName
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 60);
  return `${name || "openplane"}-${env}.bin`;
}
