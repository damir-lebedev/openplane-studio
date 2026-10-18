// Разбор живых данных платы (строки @live из AppLink.h прошивки): где стоит
// тумблер, щёлкнули ли им, выведены ли каналы на пульте, не сбиты ли триммеры.

import { LiveFrame } from "../api";

/** Положение тумблера по импульсу — как в прошивке (ControlBinding.h). */
export function switchPosition(us: number, positions: 2 | 3 | "knob" | null): number {
  if (positions === 3) return us < 1250 ? 0 : us < 1750 ? 1 : 2;
  return us < 1500 ? 0 : 1;
}

/** Функция и режим «поверх» включены выше SWITCH_ON_US (1750 мкс). */
export function switchOn(us: number): boolean {
  return us >= 1750;
}

export const LIVE_STALE_MS = 1500;

export function isFresh(liveAt: number, now = Date.now()): boolean {
  return now - liveAt < LIVE_STALE_MS;
}

/** Каналы, которые щёлкнули между двумя кадрами (скачок больше 350 мкс). */
export function flippedChannels(prev: LiveFrame | null, next: LiveFrame): number[] {
  if (!prev) return [];
  const out: number[] = [];
  next.ch.forEach((v, i) => {
    if (Math.abs(v - (prev.ch[i] ?? v)) > 350) out.push(i);
  });
  return out;
}

/** Наблюдение за каналами за сеанс: размах и последние значения. */
export class ChannelWatch {
  min: number[] = [];
  max: number[] = [];
  recent: number[][] = [];
  since = Date.now();

  push(frame: LiveFrame) {
    frame.ch.forEach((v, i) => {
      this.min[i] = Math.min(this.min[i] ?? v, v);
      this.max[i] = Math.max(this.max[i] ?? v, v);
      const r = (this.recent[i] ??= []);
      r.push(v);
      if (r.length > 30) r.shift();
    });
  }

  /** Каналы, что ни разу не сдвинулись с 1500 за полминуты: не выведены на пульте. */
  silent(fromIndex: number, minAgeMs = 30000): number[] {
    if (Date.now() - this.since < minAgeMs) return [];
    const out: number[] = [];
    for (let i = fromIndex; i < this.min.length; i++) {
      if (this.max[i] - this.min[i] < 10 && Math.abs(this.max[i] - 1500) < 5) out.push(i);
    }
    return out;
  }

  /** Стик в покое не в центре: сдвиг 15…100 мкс, кадры почти не меняются — триммер. */
  trimOffset(index: number): number | null {
    const r = this.recent[index];
    if (!r || r.length < 20) return null;
    const lo = Math.min(...r);
    const hi = Math.max(...r);
    if (hi - lo > 6) return null;
    const offset = Math.round((lo + hi) / 2 - 1500);
    return Math.abs(offset) >= 15 && Math.abs(offset) <= 100 ? offset : null;
  }
}

/** Адреса I2C, где ищется датчик (как в SensorSelection.h). */
export const SENSOR_ADDRESSES: Record<string, number[]> = {
  SENSOR_IMU_MPU6050: [0x68],
  SENSOR_IMU_LSM6DSV: [0x6a, 0x6b],
  SENSOR_IMU_ICM45686: [0x68, 0x69],
  SENSOR_BARO_BME280: [0x76],
  SENSOR_BARO_BMP388_I2C: [0x76],
  SENSOR_BARO_SPL06: [0x76, 0x77],
  SENSOR_BARO_BMP581: [0x46, 0x47],
  SENSOR_MAG_QMC5883P: [0x2c],
  SENSOR_MAG_QMC5883L: [0x0d],
  SENSOR_MAG_QMC6309: [0x7c],
  SENSOR_AIRSPEED_PITOT_BMP581: [0x47],
};

export function hex(a: number): string {
  return `0x${a.toString(16).toUpperCase().padStart(2, "0")}`;
}
