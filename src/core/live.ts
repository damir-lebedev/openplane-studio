// Разбор живых данных платы (строки @live из AppLink.h прошивки) и текста
// консоли во время калибровок: что видит плата, на каком шаге процедура,
// почему не армится. Всё — из того, что прислала настоящая плата.

import { LiveFrame, ScanResult } from "../api";
import { isNone, Manifest, SensorCategory, SENSOR_CATEGORIES } from "./manifest";
import { PlaneProject, sensorLabel } from "./project";

export const LIVE_STALE_MS = 1500;

export function isFresh(liveAt: number, now = Date.now()): boolean {
  return now - liveAt < LIVE_STALE_MS;
}

/** Положение тумблера по импульсу — как в прошивке (ControlBinding.h): 0 — вверх. */
export function switchPosition(us: number, positions: 2 | 3 | "knob" | null): number {
  if (positions === 3) return us < 1250 ? 0 : us < 1750 ? 1 : 2;
  return us < 1500 ? 0 : 1;
}

/** Функция и режим «поверх» включены от SWITCH_ON_US (1750 мкс) — тумблер вниз. */
export const SWITCH_ON_US = 1750;

/** Каналы, которые щёлкнули между двумя кадрами (скачок больше 350 мкс). */
export function flippedChannels(prev: LiveFrame | null, next: LiveFrame): number[] {
  if (!prev) return [];
  const out: number[] = [];
  next.ch.forEach((v, i) => {
    if (Math.abs(v - (prev.ch[i] ?? v)) > 350) out.push(i);
  });
  return out;
}

/** Наблюдение за каналами: размах за сеанс и последние значения. */
export class ChannelWatch {
  min: number[] = [];
  max: number[] = [];
  recent: number[][] = [];

  push(frame: LiveFrame) {
    frame.ch.forEach((v, i) => {
      this.min[i] = Math.min(this.min[i] ?? v, v);
      this.max[i] = Math.max(this.max[i] ?? v, v);
      const r = (this.recent[i] ??= []);
      r.push(v);
      if (r.length > 30) r.shift();
    });
  }

  range(index: number): number {
    return (this.max[index] ?? 0) - (this.min[index] ?? 0);
  }

  reset() {
    this.min = [];
    this.max = [];
    this.recent = [];
  }

  /** Канал за весь сеанс не сдвинулся с 1500: на пульте не выведен. */
  silent(index: number): boolean {
    return this.range(index) < 10 && Math.abs((this.max[index] ?? 0) - 1500) < 5;
  }

  /** Стик отпущен, а канал стоит не в центре: 15…120 мкс — сбит триммер. */
  trimOffset(index: number): number | null {
    const r = this.recent[index];
    if (!r || r.length < 20) return null;
    const lo = Math.min(...r);
    const hi = Math.max(...r);
    if (hi - lo > 6) return null; // стик трогают
    const offset = Math.round((lo + hi) / 2 - 1500);
    return Math.abs(offset) >= 15 && Math.abs(offset) <= 120 ? offset : null;
  }
}

// --- датчики на шине ---

/** Адреса I2C, где отвечает датчик (драйверы в include/sensors прошивки). */
const I2C_ADDRESSES: Record<string, number[]> = {
  SENSOR_IMU_MPU6050: [0x68, 0x69],
  SENSOR_IMU_LSM6DSV: [0x6a, 0x6b],
  SENSOR_IMU_ICM45686: [0x68, 0x69],
  SENSOR_BARO_BME280: [0x76, 0x77],
  SENSOR_BARO_BMP388_I2C: [0x76, 0x77],
  SENSOR_BARO_SPL06: [0x76, 0x77],
  SENSOR_BARO_BMP581: [0x46, 0x47],
  SENSOR_MAG_QMC5883P: [0x2c],
  SENSOR_MAG_QMC5883L: [0x0d],
  SENSOR_MAG_QMC6309: [0x7c],
  SENSOR_AIRSPEED_PITOT_BMP581: [0x47],
};

/** Где искать датчик на шине датчиков; null — он не на I2C (SPI, UART) или не выбран. */
export function expectedAddresses(project: PlaneProject, cat: SensorCategory): number[] | null {
  const id = project.sensors[cat];
  if (isNone(id)) return null;
  const list = I2C_ADDRESSES[id];
  if (!list) return null;
  // Барометр BMP581 рядом с трубкой Пито на BMP581: трубка — 0x47, барометр — 0x46.
  if (cat === "baro" && id === "SENSOR_BARO_BMP581" && project.sensors.airspeed === "SENSOR_AIRSPEED_PITOT_BMP581") {
    return [0x46];
  }
  return list;
}

export function hex(a: number): string {
  return `0x${a.toString(16).toUpperCase().padStart(2, "0")}`;
}

const CAT_TITLES: Record<SensorCategory, string> = {
  imu: "IMU",
  baro: "Барометр",
  mag: "Компас",
  airspeed: "Трубка Пито",
  gps: "GPS",
};

export interface SensorRow {
  cat: SensorCategory;
  title: string;
  chip: string;
  state: "ok" | "bad" | "warn" | "off" | "wait";
  text: string;
}

function liveState(live: LiveFrame | null, cat: SensorCategory): string | null {
  if (!live) return null;
  return cat === "airspeed" ? live.pitot : live[cat];
}

/** Датчики проекта против того, что видит плата: опрос шины и живые данные. */
export function sensorRows(manifest: Manifest, project: PlaneProject, live: LiveFrame | null, scan: ScanResult | null): SensorRow[] {
  const found = new Set((scan?.sensor ?? []).map((d) => d.a));
  return SENSOR_CATEGORIES.map((cat): SensorRow => {
    const id = project.sensors[cat];
    const title = CAT_TITLES[cat];
    const chip = sensorLabel(manifest, cat, id);
    if (isNone(id)) return { cat, title, chip, state: "off", text: "нет в проекте" };
    const st = liveState(live, cat);
    const addrs = expectedAddresses(project, cat);
    const at = addrs?.find((a) => found.has(a));
    if (st === "ok") {
      if (cat === "gps" && live) {
        const sats = live.sats ?? 0;
        return { cat, title, chip, state: "ok", text: live.fix && live.fix >= 3 ? `работает, спутников ${sats}` : `отвечает, ищет спутники (${sats})` };
      }
      return { cat, title, chip, state: "ok", text: at !== undefined ? `работает, на ${hex(at)}` : "работает" };
    }
    if (st === "check") {
      return { cat, title, chip, state: "warn", text: "отвечает, но предполётная проверка не пройдена — см. «ARM»" };
    }
    if (st === "none") {
      return { cat, title, chip, state: "warn", text: "в прошивке на плате его нет — перепрошейте этот проект" };
    }
    if (addrs) {
      if (!scan) return { cat, title, chip, state: st ? "bad" : "wait", text: st ? "не отвечает — нажмите «Опросить шину»" : "ждём плату" };
      if (at !== undefined) {
        return { cat, title, chip, state: "warn", text: `на шине есть ${hex(at)}, но прошивка его не видит: другой чип с тем же адресом?` };
      }
      return {
        cat,
        title,
        chip,
        state: "bad",
        text: `не отвечает на ${addrs.map(hex).join(" / ")}: проверьте питание 3,3 В, провода SDA и SCL`,
      };
    }
    if (cat === "gps") {
      return { cat, title, chip, state: st ? "bad" : "wait", text: st ? "молчит: TX модуля — на RX платы (крест-накрест), питание 5 В" : "ждём плату" };
    }
    return { cat, title, chip, state: st ? "bad" : "wait", text: st ? "не отвечает (SPI): проверьте CS, SCK, MISO, MOSI" : "ждём плату" };
  });
}

/** Ответившие на шине, кого проект не ждёт (экран, второй датчик, чужой модуль). */
export function extraDevices(project: PlaneProject, scan: ScanResult | null): { a: number; g: string }[] {
  const expected = new Set(SENSOR_CATEGORIES.flatMap((c) => expectedAddresses(project, c) ?? []));
  return (scan?.sensor ?? []).filter((d) => !expected.has(d.a));
}

// --- процедуры наладки по тексту консоли ---

export type ProcKind = "mount" | "ground" | "gyro" | "compass";

export interface Proc {
  kind: ProcKind;
  state: "run" | "ok" | "fail";
  /** текущий шаг, с 1; 0 — ещё не начат */
  step: number;
  steps: number;
  /** итог или причина отказа — как написала плата */
  text?: string;
  startedAt: number;
}

const PROC_STEPS: Record<ProcKind, number> = { mount: 3, ground: 2, gyro: 1, compass: 1 };

/** Клавиша консоли для процедуры (DebugConsole::runAction). */
export const PROC_KEY: Record<ProcKind, string> = { mount: "o", ground: "c", gyro: "i", compass: "m" };

export function procStart(kind: ProcKind, now = Date.now()): Proc {
  return { kind, state: "run", step: kind === "gyro" || kind === "compass" ? 1 : 0, steps: PROC_STEPS[kind], startedAt: now };
}

const COMMON_FAIL = [/команда недоступна, пока заармлено/, /не выбран в SensorSelection\.h/, /только без ARM/];

/** Строка консоли → новое состояние процедуры (тот же объект, если строка не о ней). */
export function procLine(p: Proc, raw: string): Proc {
  if (p.state !== "run") return p;
  const line = raw.trim();
  if (COMMON_FAIL.some((r) => r.test(line))) return { ...p, state: "fail", text: line.replace(/^Консоль:\s*/, "") };
  const step = /Шаг (\d)\/(\d)/.exec(line);
  switch (p.kind) {
    case "mount":
      if (step) return { ...p, step: Number(step[1]) };
      if (/установка сохранена/.test(line)) return { ...p, state: "ok", step: p.steps, text: line.replace(/^.*?установка сохранена:\s*/, "") };
      if (/калибровка установки отклонена/.test(line)) return { ...p, state: "fail", text: line.replace(/^.*?отклонена\s*—\s*/, "") };
      if (/поза не дождалась/.test(line)) return { ...p, state: "fail", text: "поза не дождалась за 30 с — самолёт не держали неподвижно?" };
      if (/калибровка установки невозможна/.test(line)) return { ...p, state: "fail", text: "IMU не отвечает" };
      return p;
    case "ground":
      if (step) return { ...p, step: Number(step[1]) };
      if (/Калибровка самолёта сохранена/.test(line)) return { ...p, state: "ok", step: p.steps, text: line };
      if (/Калибровка самолёта: ОШИБКА/.test(line)) {
        return { ...p, state: "fail", text: line.replace(/^.*?ОШИБКА\s*—\s*/, "").replace(/\.\s*Ничего не сохранено\.?$/, "") };
      }
      if (/Калибровка самолёта отменена/.test(line)) return { ...p, state: "fail", text: line.replace(/^.*?отменена:\s*/, "отменена: ") };
      if (/Стоянка: нос/.test(line)) return { ...p, text: line.replace(/^Стоянка:\s*/, "") };
      return p;
    case "gyro":
      if (/калибровка завершена/.test(line)) return { ...p, text: line.replace(/^.*?калибровка завершена,\s*/, "") };
      if (/предполётная проверка пройдена/.test(line)) return { ...p, state: "ok", text: p.text };
      if (/ПРЕДПОЛЁТНАЯ ПРОВЕРКА НЕ ПРОЙДЕНА/.test(line)) return { ...p, state: "fail", text: line.replace(/^.*?НЕ ПРОЙДЕНА\s*—\s*/, "") };
      if (/калибровка не удалась/.test(line)) return { ...p, state: "fail", text: line.replace(/^[^:]*:\s*/, "") };
      return p;
    case "compass":
      if (/калибровка сохранена/.test(line)) return { ...p, state: "ok", text: line.replace(/^[^:]*:\s*/, "") };
      if (/калибровка не удалась/.test(line)) return { ...p, state: "fail", text: line.replace(/^[^:]*:\s*/, "") };
      return p;
  }
}

// --- почему не армится ---

export type SetupCheckId = "sensors" | "tx" | "failsafe" | "mount" | "ground" | "compass" | "surfaces" | "motor";

export interface ArmHint {
  text: string;
  check?: SetupCheckId;
  /** процедура, которая это чинит */
  fix?: ProcKind;
}

/** Причина запрета ARM (FlightController::armBlockNow) → что сделать. */
export function armBlockHint(reason: string): ArmHint {
  const r = reason.toLowerCase();
  if (r.includes("газ не на минимуме")) return { text: "Опустите газ до упора; триммер газа — в центр.", check: "tx" };
  if (r.includes("нет связи с пультом")) return { text: "Включите пульт; проверьте, что приёмник светится ровно (привязан).", check: "tx" };
  if (r.includes("двигали во время калибровки")) return { text: "Поставьте самолёт неподвижно и откалибруйте гироскоп.", fix: "gyro" };
  if (r.includes("не совпадает с калибровкой установки") || r.includes("установк")) {
    return { text: "Плату переставили — повторите установку IMU тремя позами.", check: "mount", fix: "mount" };
  }
  if (r.includes("не 1g")) return { text: "Акселерометр врёт в покое — поставьте ровно и откалибруйте гироскоп; не помогло — датчик неисправен.", fix: "gyro" };
  if (r.includes("imu не отвечает")) return { text: "IMU пропал — проверьте провода датчика.", check: "sensors" };
  if (r.includes("калибровки шасси")) return { text: "Нужна калибровка на земле: горизонт и стоянка.", check: "ground", fix: "ground" };
  if (r.includes("барометр не отвечает")) return { text: "Барометр пропал — проверьте провода датчика или выберите режим без высоты.", check: "sensors" };
  if (r.includes("идёт калибровка")) return { text: "Дождитесь конца калибровки на земле или отмените её.", check: "ground" };
  if (r.includes("отменена калибровка")) return { text: "Верните тумблер ARM вверх и снова вниз." };
  if (r.includes("сигнал") || r.includes("направление мотора")) return { text: "Подождите пару секунд." };
  return { text: "" };
}
