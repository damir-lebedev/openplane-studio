// Пины платы: что каждый умеет и подходит ли под свою роль. STM32 — из
// варианта STM32duino (tools/gen_pins.py: ШИМ с таймером и каналом, UART,
// I2C, SPI, АЦП, что занято на плате); ESP32 — по даташитам: через матрицу
// GPIO почти любой пин умеет всё, но есть пины флеша, входы-только,
// strapping и АЦП2, который не работает при включённом Wi-Fi.

import { N_, t } from "../i18n";
import { findBoard, Manifest } from "./manifest";
import { effectiveParam, PlaneProject } from "./project";
import devebox from "./pins/stm32h743-devebox.json";
import weact from "./pins/stm32h743.json";

export type PinRole = "pwm" | "uart_rx" | "uart_tx" | "i2c_sda" | "i2c_scl" | "spi_sck" | "spi_miso" | "spi_mosi" | "adc" | "gpio";

const ROLE_TEXT: Record<PinRole, string> = {
  pwm: N_("ШИМ (серво, ESC)"),
  uart_rx: N_("UART RX"),
  uart_tx: N_("UART TX"),
  i2c_sda: N_("I2C SDA"),
  i2c_scl: N_("I2C SCL"),
  spi_sck: N_("SPI SCK"),
  spi_miso: N_("SPI MISO"),
  spi_mosi: N_("SPI MOSI"),
  adc: N_("АЦП"),
  gpio: N_("цифровой выход"),
};

/** Роль пина — по имени параметра Config.h. */
export function pinRole(name: string): PinRole | null {
  if (/^PIN_(AILERON_LEFT|AILERON_RIGHT|ELEVATOR|ESC|RUDDER|AUX1|AUX2)$/.test(name)) return "pwm";
  if (/^PIN_(RC_RX|IBUS|GPS_RX|TELEM_RX)$/.test(name)) return "uart_rx";
  if (/^PIN_(RC_TX|IBUS_TX|GPS_TX|TELEM_TX)$/.test(name)) return "uart_tx";
  if (/^PIN_I2C2?_SDA$/.test(name)) return "i2c_sda";
  if (/^PIN_I2C2?_SCL$/.test(name)) return "i2c_scl";
  if (name === "PIN_SENSOR_SPI_SCK") return "spi_sck";
  if (name === "PIN_SENSOR_SPI_MISO") return "spi_miso";
  if (name === "PIN_SENSOR_SPI_MOSI") return "spi_mosi";
  if (/_ADC$/.test(name)) return "adc";
  if (/^PIN_(SPI_CS_\w+|BUZZER|LIGHT|AUX3|LED\w*)$/.test(name)) return "gpio";
  return null;
}

/** Пины, что должны быть на одном экземпляре периферии (один UART, одна шина). */
export const PIN_GROUPS: string[][] = [
  ["PIN_RC_RX", "PIN_RC_TX"],
  ["PIN_IBUS", "PIN_IBUS_TX"],
  ["PIN_GPS_RX", "PIN_GPS_TX"],
  ["PIN_TELEM_RX", "PIN_TELEM_TX"],
  ["PIN_I2C_SDA", "PIN_I2C_SCL"],
  ["PIN_I2C2_SDA", "PIN_I2C2_SCL"],
  ["PIN_SENSOR_SPI_SCK", "PIN_SENSOR_SPI_MISO", "PIN_SENSOR_SPI_MOSI"],
];

interface StmEntry {
  inst: string;
  label: string;
}

interface StmTable {
  family: "stm32";
  mcu: string;
  pins: Record<string, Partial<Record<PinRole, StmEntry[]>>>;
  reserved: Record<string, string>;
  connector: Record<string, string>;
}

interface EspTable {
  family: "esp32";
  mcu: string;
  gpio: number[];
  /** пин занят на плате: флеш, PSRAM, консоль */
  reserved: Record<number, string>;
  /** выведен на разъём (второй USB): можно, если он не нужен */
  connector: Record<number, string>;
  strapping: number[];
  inputOnly: number[];
  adc1: number[];
  adc2: number[];
}

type PinTable = StmTable | EspTable;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const ESP32_S3: EspTable = {
  family: "esp32",
  mcu: "ESP32-S3 (N16R8)",
  gpio: [...range(0, 21), ...range(26, 48)],
  reserved: {
    ...Object.fromEntries(range(26, 32).map((n) => [n, N_("флеш SPI")])),
    ...Object.fromEntries(range(33, 37).map((n) => [n, N_("восьмибитная PSRAM (N16R8)")])),
    43: N_("консоль TX (USB-UART)"),
    44: N_("консоль RX (USB-UART)"),
  },
  connector: { 19: N_("второй USB (OTG) D−"), 20: N_("второй USB (OTG) D+") },
  strapping: [0, 3, 45, 46],
  inputOnly: [],
  adc1: range(1, 10),
  adc2: range(11, 20),
};

const ESP32_CLASSIC: EspTable = {
  family: "esp32",
  mcu: "ESP32 (WROOM-32)",
  gpio: [...range(0, 19), 21, 22, 23, 25, 26, 27, ...range(32, 39)],
  reserved: { ...Object.fromEntries(range(6, 11).map((n) => [n, N_("флеш SPI")])), 1: N_("консоль TX"), 3: N_("консоль RX") },
  connector: {},
  strapping: [0, 2, 5, 12, 15],
  inputOnly: range(34, 39),
  adc1: range(32, 39),
  adc2: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27],
};

const ESP32_C3: EspTable = {
  family: "esp32",
  mcu: "ESP32-C3 (SuperMini)",
  gpio: [...range(0, 10), 18, 19, 20, 21],
  reserved: { 18: N_("USB D− (консоль)"), 19: N_("USB D+ (консоль)") },
  connector: {},
  strapping: [2, 8, 9],
  inputOnly: [],
  adc1: range(0, 4),
  adc2: [5],
};

const TABLES: Record<string, PinTable> = {
  "stm32h743-devebox": devebox as unknown as StmTable,
  stm32h743: weact as unknown as StmTable,
  "esp32-s3": ESP32_S3,
  "esp32-dev": ESP32_CLASSIC,
  "esp32-c3": ESP32_C3,
};

export function pinTable(env: string): PinTable | null {
  return TABLES[env] ?? null;
}

export interface PinVerdict {
  /** пин годится под роль (ошибки нет) */
  ok: boolean;
  /** что этот пин делает в этой роли: «TIM2_CH1», «UART7» */
  what?: string;
  /** почему не годится или о чём предупредить */
  error?: string;
  warn?: string;
}

/** Годится ли пин под роль на этой плате. -1 — «не разведён» — всегда годится. */
export function judgePin(table: PinTable, role: PinRole, value: unknown): PinVerdict {
  if (value === -1 || value === "-1") return { ok: true };
  if (table.family === "stm32") {
    const pin = String(value);
    const caps = table.pins[pin];
    // Занятое на плате (USB, µSD, флеш, кварц, SWD) подключено к своей микросхеме — второе на нём сломает первое.
    if (table.reserved[pin]) return { ok: false, error: t("занят на плате: {what}", { what: table.reserved[pin] }) };
    const warn = table.connector[pin] ? t("выведен на разъём: {what} — можно, если разъём не нужен", { what: table.connector[pin] }) : undefined;
    if (role === "gpio") return { ok: /^P[A-K]\d+$/.test(pin), warn, error: /^P[A-K]\d+$/.test(pin) ? undefined : t("нет такого пина") };
    const entries = caps?.[role];
    if (!entries?.length) return { ok: false, warn, error: t("{pin} не умеет {role}", { pin, role: t(ROLE_TEXT[role]) }) };
    return { ok: true, what: entries.map((e) => (role === "pwm" || role === "adc" ? e.label : e.inst)).join(", "), warn };
  }
  const n = Number(value);
  if (!Number.isInteger(n) || !table.gpio.includes(n)) return { ok: false, error: t("GPIO{n} у {mcu} нет", { n: String(value), mcu: table.mcu }) };
  if (table.reserved[n]) return { ok: false, error: t("GPIO{n} занят: {what}", { n, what: t(table.reserved[n]) }) };
  const output = !["uart_rx", "spi_miso", "adc"].includes(role);
  if (output && table.inputOnly.includes(n)) return { ok: false, error: t("GPIO{n} — только вход, а {role} — выход", { n, role: t(ROLE_TEXT[role]) }) };
  if (role === "adc" && !table.adc1.includes(n) && !table.adc2.includes(n)) return { ok: false, error: t("GPIO{n} — не АЦП", { n }) };
  const warns: string[] = [];
  if (role === "adc" && table.adc2.includes(n)) warns.push(t("АЦП2 не работает, пока включён Wi-Fi"));
  if (table.strapping.includes(n)) warns.push(t("strapping-пин: подтяжка на нём при включении может не дать плате загрузиться"));
  if (table.connector[n]) warns.push(t("выведен на разъём: {what}", { what: t(table.connector[n]) }));
  return { ok: true, what: role === "adc" ? (table.adc1.includes(n) ? t("АЦП1") : t("АЦП2")) : undefined, warn: warns.join("; ") || undefined };
}

export interface PinIssue {
  level: "error" | "warning";
  text: string;
  target: string;
}

/** Пины платы проекта: роль, пары на одном экземпляре, повторы, таймеры. */
export function pinIssues(manifest: Manifest, project: PlaneProject): PinIssue[] {
  const board = findBoard(manifest, project.board);
  const table = board ? pinTable(board.env) : null;
  if (!board?.macro || !table) return [];
  const params = manifest.params.filter((p) => p.board === board.macro && p.kind === "pin");
  const value = (name: string) => effectiveParam(manifest, project, name);
  const out: PinIssue[] = [];
  const used = new Map<string, string>();
  const channels = new Map<string, string>();

  for (const p of params) {
    const role = pinRole(p.name);
    const v = value(p.name);
    if (v === -1 || v === "-1" || v === undefined) continue;
    const key = String(v);
    const prev = used.get(key);
    if (prev) out.push({ level: "warning", text: t("{a} и {b} на одном пине {pin} — работать будет что-то одно", { a: p.name, b: prev, pin: key }), target: p.name });
    else used.set(key, p.name);
    if (!role) continue;
    const verdict = judgePin(table, role, v);
    if (!verdict.ok && verdict.error) out.push({ level: "error", text: `${p.name}: ${verdict.error}`, target: p.name });
    else if (verdict.warn) out.push({ level: "warning", text: `${p.name} = ${key}: ${verdict.warn}`, target: p.name });
    // STM32: два ШИМ-выхода на одном канале таймера дадут один сигнал на двоих
    if (role === "pwm" && table.family === "stm32" && verdict.what) {
      const ch = verdict.what;
      const other = channels.get(ch);
      if (other) out.push({ level: "error", text: t("{a} и {b} — один канал таймера {ch}: сигнал будет один на двоих", { a: p.name, b: other, ch }), target: p.name });
      else channels.set(ch, p.name);
    }
  }

  // STM32: RX и TX — на одном UART, SDA и SCL — на одной шине I2C, SPI — на одной SPI.
  if (table.family === "stm32") {
    for (const group of PIN_GROUPS) {
      const present = group.filter((n) => params.some((p) => p.name === n));
      const live = present.filter((n) => value(n) !== -1 && value(n) !== "-1");
      if (live.length < 2) continue;
      const sets = live.map((n) => {
        const role = pinRole(n)!;
        return new Set((table.pins[String(value(n))]?.[role] ?? []).map((e) => e.inst));
      });
      const common = [...sets[0]].filter((inst) => sets.every((s) => s.has(inst)));
      if (!common.length && sets.every((s) => s.size)) {
        out.push({
          level: "error",
          text: t("{pins} — на разных экземплярах ({detail}): нужны пины одного", {
            pins: live.join(", "),
            detail: live.map((n, i) => `${n}: ${[...sets[i]].join("/")}`).join("; "),
          }),
          target: live[0],
        });
      }
    }
  }
  return out;
}

export interface PinChoice {
  value: string | number;
  label: string;
  ok: boolean;
  usedBy?: string;
  note?: string;
}

/** Варианты пина для выбора: подходящие (с тем, что пин делает), занятые, неподходящие. */
export function pinChoices(manifest: Manifest, project: PlaneProject, name: string): PinChoice[] | null {
  const board = findBoard(manifest, project.board);
  const table = board ? pinTable(board.env) : null;
  const role = pinRole(name);
  if (!board?.macro || !table || !role) return null;
  const used = new Map<string, string>();
  // STM32: канал таймера, занятый другим ШИМ-выходом, — тоже «занято»
  const channels = new Map<string, string>();
  for (const p of manifest.params.filter((x) => x.board === board.macro && x.kind === "pin" && x.name !== name)) {
    const v = effectiveParam(manifest, project, p.name);
    if (v === -1 || v === undefined) continue;
    used.set(String(v), p.name);
    if (role === "pwm" && pinRole(p.name) === "pwm" && table.family === "stm32") {
      const what = judgePin(table, "pwm", v).what;
      if (what) channels.set(what, p.name);
    }
  }
  const all: (string | number)[] =
    table.family === "stm32"
      ? [...new Set([...Object.keys(table.pins), ...Object.keys(table.reserved), ...Object.keys(table.connector)])].sort(
          (a, b) => a.charCodeAt(1) - b.charCodeAt(1) || Number(a.slice(2)) - Number(b.slice(2)),
        )
      : table.gpio;
  return all.map((pin) => {
    const v = judgePin(table, role, pin);
    const label = table.family === "stm32" ? String(pin) : `GPIO${pin}`;
    const channelOwner = v.what ? channels.get(v.what) : undefined;
    const usedBy = used.get(String(pin)) ?? (channelOwner ? t("{owner} (тот же канал)", { owner: channelOwner }) : undefined);
    return { value: pin, label: v.what ? `${label} — ${v.what}` : label, ok: v.ok, usedBy, note: v.error ?? v.warn };
  });
}
