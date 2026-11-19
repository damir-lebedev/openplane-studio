// Расширенная телеметрия регуляторов (EDT, dshot_edt) из живого кадра:
// "esc":[[°C, В, А, статус], …] по моторам, null — значение не приходило.
// Статус (кадр 0xE Bluejay/AM32): 0x80 тревога, 0x40 предупреждение,
// 0x20 ошибка, младшие 4 бита — наибольший «стресс» 0–15.

export type EscLiveRow = (number | null)[];

export interface EscRow {
  motor: number;
  tempC: number | null;
  volts: number | null;
  amps: number | null;
  /** 0–15, наибольший стресс регулятора; null — статус не приходил */
  stress: number | null;
  alert: boolean;
  warning: boolean;
  error: boolean;
  /** горячий: от ESC_HOT_C */
  hot: boolean;
  /** напряжение заметно ниже остальных — плохой контакт питания этого регулятора */
  sag: boolean;
}

/** С этой температуры регулятор — «горячий» (Bluejay и BLHeli_32 режут газ около 140 °C). */
export const ESC_HOT_C = 100;
/** Ниже медианы напряжения регуляторов на столько — подозрение на контакт. */
export const ESC_SAG_V = 0.5;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function escRows(esc: EscLiveRow[] | undefined): EscRow[] {
  if (!Array.isArray(esc)) return [];
  const volts = esc.map((r) => num(r?.[1])).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = volts.length ? volts[Math.floor(volts.length / 2)] : null;
  return esc.map((r, i) => {
    const tempC = num(r?.[0]);
    const v = num(r?.[1]);
    const status = num(r?.[3]);
    return {
      motor: i,
      tempC,
      volts: v,
      amps: num(r?.[2]),
      stress: status === null ? null : status & 0x0f,
      alert: status !== null && (status & 0x80) !== 0,
      warning: status !== null && (status & 0x40) !== 0,
      error: status !== null && (status & 0x20) !== 0,
      hot: tempC !== null && tempC >= ESC_HOT_C,
      sag: v !== null && median !== null && volts.length >= 3 && median - v >= ESC_SAG_V,
    };
  });
}

/** Что-то не так хоть у одного регулятора. */
export function escTrouble(rows: EscRow[]): boolean {
  return rows.some((r) => r.hot || r.alert || r.error || r.sag);
}

/** Сумма токов, когда ток шлют все; иначе null. */
export function escTotalAmps(rows: EscRow[]): number | null {
  if (!rows.length || rows.some((r) => r.amps === null)) return null;
  return rows.reduce((s, r) => s + (r.amps ?? 0), 0);
}
