// Прошивка самолёта на ESP32 по WiFi (P50). Плата держит свою точку доступа
// (WIFI_AP_SSID / WIFI_AP_PASSWORD из Config.h — те, что в проекте самолёта),
// прошивка принимается на http://192.168.4.1/update, только когда на плате
// открыто окно: клавиша 'u' в консоли, команда "ota" по USB или жест стиков
// (газ вниз, рысканье вправо, тангаж на себя, 3 с; ответ — 4 кивка рулей).
// Здесь — без сети: что за сеть, подходит ли файл, что сказать по ответу.

import { envFromBinName, PHONE_ENVS } from "./binFile";
import { Manifest } from "./manifest";
import { effectiveParam, PlaneProject } from "./project";

type Tr = (s: string, vars?: Record<string, string | number>) => string;

/** Сборки на ESP32: им WiFi вместо USB-загрузчика. */
export const isEspEnv = (env: string | null | undefined): boolean => !!env && /^esp32/.test(env);

/** Образ больше области app (2 МБ) — не прошивка. */
export const WIFI_IMAGE_MAX = 2 * 1024 * 1024;

/** Ответ платы на `GET /ota` (WifiOta.h). */
export interface OtaStatus {
  board: string;
  commit: string;
  config: string;
  open: boolean;
  left_ms: number;
  receiving: boolean;
  armed: boolean;
}

/** Сеть платы из проекта самолёта (значения Config.h с правками). */
export function planeWifi(manifest: Manifest, plane: PlaneProject): { ssid: string; password: string } {
  const str = (name: string, fallback: string) => {
    const v = effectiveParam(manifest, plane, name);
    return typeof v === "string" && v ? v : fallback;
  };
  return { ssid: str("WIFI_AP_SSID", "OpenPlane-Debug"), password: str("WIFI_AP_PASSWORD", "12345678") };
}

/** Файл для WiFi-прошивки самолёта: .bin, не больше 2 МБ, сборка (если видна) — его плата. */
export function checkWifiBin(input: { name: string; size: number }, planeBoard: string, t: Tr): string | null {
  if (!/\.bin$/i.test(input.name)) return t("Нужен файл .bin — «{name}» не подходит.", { name: input.name });
  if (input.size <= 0) return t("Файл пустой.");
  if (input.size > WIFI_IMAGE_MAX) return t("Файл {kb} КБ — больше области прошивки ESP32 (2048 КБ).", { kb: Math.ceil(input.size / 1024) });
  const env = envFromBinName(input.name, [...PHONE_ENVS, planeBoard]);
  if (env && env !== planeBoard) return t("Файл для {file}, а у самолёта плата {board}. Возьмите файл для своей платы.", { file: env, board: planeBoard });
  return null;
}

/** Плата ответила — можно ли слать ей прошивку этого самолёта. null — можно. */
export function checkOtaStatus(s: OtaStatus, planeBoard: string, t: Tr): string | null {
  if (s.board && s.board !== planeBoard) return t("В сети плата {got}, а у самолёта {want}. Подключитесь к сети своего самолёта.", { got: s.board, want: planeBoard });
  if (s.armed) return t("Плата заармлена. Снимите ARM (тумблер на пульте) и повторите.");
  if (s.receiving) return t("Плата уже принимает прошивку — дождитесь конца.");
  if (!s.open) return t("Окно прошивки на плате закрыто. Откройте его жестом стиков без ARM: газ вниз, рысканье вправо, тангаж на себя — 3 секунды (рули кивнут 4 раза). Или клавиша u в консоли.");
  return null;
}

export interface WifiExplain {
  title: string;
  text: string;
  retry: boolean;
}

/** Ответ Rust/платы кодом в начале (`CLOSED: …`) — фраза. */
export function explainWifiError(text: string, ssid: string, t: Tr): WifiExplain {
  const code = text.split(":")[0].trim();
  const rest = text.slice(code.length + 1).trim();
  switch (code) {
    case "NO_BOARD":
    case "NO_ANSWER":
      return {
        title: t("Плата не отвечает по WiFi"),
        text: t("Подключитесь к сети «{ssid}» (точка доступа самолёта) и повторите. Плата должна быть включена и рядом.", { ssid }),
        retry: true,
      };
    case "NO_NETWORK":
      return { title: t("Сеть самолёта не найдена"), text: t("Включите самолёт рядом с телефоном. Сеть «{ssid}» — имя и пароль из проекта самолёта.", { ssid }), retry: true };
    case "OLD_ANDROID":
      return { title: t("Подключитесь вручную"), text: t("На этом Android Studio не подключается сама. Подключитесь к сети «{ssid}» в настройках WiFi и повторите.", { ssid }), retry: true };
    case "NO_OTA":
      return { title: t("На плате нет прошивки по WiFi"), text: t("На плате старая прошивка без WiFi-обновления. Один раз прошейте её по USB с компьютера — дальше можно по воздуху."), retry: false };
    case "CLOSED":
      return {
        title: t("Окно прошивки закрыто"),
        text: t("Откройте окно жестом стиков без ARM: газ вниз, рысканье вправо, тангаж на себя — 3 секунды (рули кивнут 4 раза). Окно живёт 5 минут."),
        retry: true,
      };
    case "ARMED":
      return { title: t("Плата заармлена"), text: t("Снимите ARM (тумблер на пульте) и повторите."), retry: true };
    case "THROTTLE":
      return { title: t("Газ не внизу"), text: t("Опустите газ до упора и повторите."), retry: true };
    case "BUSY":
      return { title: t("Плата уже принимает прошивку"), text: t("Дождитесь конца и повторите, если нужно."), retry: true };
    case "DISABLED":
      return { title: t("Прошивка по WiFi выключена"), text: t("В проекте самолёта выключено OTA_WIFI. Включите и один раз прошейте по USB."), retry: false };
    case "NOT_ESP":
    case "TOO_BIG":
      return { title: t("Этот файл не подойдёт"), text: rest || text, retry: false };
    case "IMAGE":
      return { title: t("Плата не приняла образ"), text: t("Образ не прошёл проверку ({why}). Старая прошивка цела — возьмите файл для своей платы.", { why: rest || "?" }), retry: true };
    case "LOST":
    case "ABORTED":
      return { title: t("Связь оборвалась"), text: t("Прошивка не дописалась — старая цела. Подойдите ближе к самолёту и повторите."), retry: true };
    case "NO_RETURN":
      return { title: t("Плата не вернулась в сеть"), text: t("Прошивка принята, но плата не появилась снова. Проверьте самолёт и подключитесь к его сети."), retry: false };
    default:
      return { title: t("Прошивка не удалась"), text: text || t("Подробности — в журнале ниже."), retry: true };
  }
}
