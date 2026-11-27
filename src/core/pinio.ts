// Ножки PINIO 1…4 (pinio_box, pinio_config — как в Betaflight): какой режим
// включает ножку и как (1 — выход, 129 — выход наоборот, 0 — не трогать).
// Правила — как в прошивке (copter/Params.h pinioList): до четырёх чисел
// 0..255 через запятую; не названные и пустая строка — как в файле платы.
// FPV ANGLE MIX (fpv_mix_degrees): поворот скоростей крена и рысканья в оси камеры.

export const PINIO_COUNT = 4;
export const PINIO_OUT = 0x01;
export const PINIO_INVERTED = 0x80;
export const BOX_NONE = 255;

/** Строка -> значения по ножкам (null — как в файле платы); вся строка null — не так написано. */
export function parsePinio(text: string | undefined | null): (number | null)[] | null {
  const s = (text ?? "").trim();
  const out: (number | null)[] = [null, null, null, null];
  if (s === "") return out;
  const parts = s.split(",");
  if (parts.length > PINIO_COUNT) return null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim();
    if (!/^\d+$/.test(p) || Number(p) > 255) return null;
    out[i] = Number(p);
  }
  return out;
}

/** Обратно в строку: значения до последнего названного (null в середине — нельзя, берём fill). */
export function formatPinio(values: (number | null)[], fill: number): string {
  let last = -1;
  values.forEach((v, i) => {
    if (v !== null) last = i;
  });
  return values
    .slice(0, last + 1)
    .map((v) => (v === null ? fill : v))
    .join(",");
}

export type PinioUse = "out" | "inverted" | "off";

export function pinioUse(config: number): PinioUse {
  if (!(config & PINIO_OUT)) return "off";
  return config & PINIO_INVERTED ? "inverted" : "out";
}

export function pinioConfigOf(use: PinioUse): number {
  return use === "off" ? 0 : use === "inverted" ? PINIO_OUT | PINIO_INVERTED : PINIO_OUT;
}

/** FPV ANGLE MIX, как в прошивке (fpvMixRotate): камера вверх на camDeg, оси FRD. */
export function fpvMix(rollDps: number, yawDps: number, camDeg: number): { roll: number; yaw: number } {
  const d = (camDeg * Math.PI) / 180;
  return { roll: rollDps * Math.cos(d) + yawDps * Math.sin(d), yaw: yawDps * Math.cos(d) - rollDps * Math.sin(d) };
}
