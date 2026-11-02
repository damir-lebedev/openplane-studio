// «Что ещё подключено» (P03): то, чего плата не видит, — мотор, винты,
// батарея, регулятор, видеопередатчик, камера, рама. Выбор из каталога с
// поиском или руками; значения уходят в настройки описания коптера на плате
// (motor_*, prop_*, battery_*, esc_*, copter_*, vtx_max_power_mw).
//
// Оценка — та же физика, что у прошивки (copter/Propulsion.h): тяга и ток
// мотора на полном газе и на висении, время полёта, тяговооружённость, и
// проверки «регулятор и батарея выдержат полный газ». ±30 %, как и там:
// чтобы заметить «регулятор 35 А на моторе, который тянет 60», а не для
// паспорта.

import { N_ } from "../i18n";

export type PartKind = "motor" | "prop" | "battery" | "esc" | "vtx" | "camera" | "frame";
export type Chemistry = "LIPO" | "LIHV" | "LIION";

export interface MotorSpec {
  statorMm: number;
  heightMm: number;
  kv: number;
}
export interface PropSpec {
  diameterIn: number;
  pitchIn: number;
  blades: number;
}
export interface BatterySpec {
  cells: number;
  mah: number;
  chemistry: Chemistry;
  /** длительная токоотдача, C; 0 — не знаем */
  c: number;
}
export interface EscSpec {
  /** длительный ток на мотор, А */
  continuousA: number;
  /** пиковый, А; 0 — 1.25 × длительного */
  burstA: number;
}
export interface FrameSpec {
  wheelbaseMm: number;
  /** взлётная масса с батареей, г */
  massG: number;
}

export interface CatalogItem {
  kind: PartKind;
  id: string;
  title: string;
  /** слова для поиска сверх названия */
  tags?: string;
  motor?: MotorSpec;
  prop?: PropSpec;
  battery?: BatterySpec;
  esc?: EscSpec;
  vtxMw?: number;
  frame?: FrameSpec;
  note?: string;
}

// Каталог — типовые классы, а не модели магазинов: KV и токи у
// производителей разные, точные цифры — с коробки (поля можно поправить).
export const CATALOG: CatalogItem[] = [
  // моторы: статор ширина × высота, KV
  { kind: "motor", id: "m0802", title: "0802 22000KV", tags: "вуп 1S", motor: { statorMm: 8, heightMm: 2, kv: 22000 } },
  { kind: "motor", id: "m1103", title: "1103 11000KV", tags: "вуп 2S", motor: { statorMm: 11, heightMm: 3, kv: 11000 } },
  { kind: "motor", id: "m1404", title: "1404 4600KV", tags: "3\" 4S", motor: { statorMm: 14, heightMm: 4, kv: 4600 } },
  { kind: "motor", id: "m1404l", title: "1404 3800KV", tags: "синевуп 3\" 4S", motor: { statorMm: 14, heightMm: 4, kv: 3800 } },
  { kind: "motor", id: "m2004", title: "2004 3000KV", tags: "4\" 4S", motor: { statorMm: 20, heightMm: 4, kv: 3000 } },
  { kind: "motor", id: "m2207-1950", title: "2207 1950KV", tags: "5\" 6S фристайл", motor: { statorMm: 22, heightMm: 7, kv: 1950 } },
  { kind: "motor", id: "m2207-2550", title: "2207 2550KV", tags: "5\" 4S", motor: { statorMm: 22, heightMm: 7, kv: 2550 } },
  { kind: "motor", id: "m2306-1750", title: "2306 1750KV", tags: "5\" 6S", motor: { statorMm: 23, heightMm: 6, kv: 1750 } },
  { kind: "motor", id: "m2306.5-1900", title: "2306.5 1900KV", tags: "5\" 6S гонки", motor: { statorMm: 23, heightMm: 6.5, kv: 1900 } },
  { kind: "motor", id: "m2507-1800", title: "2507 1800KV", tags: "6\" 6S", motor: { statorMm: 25, heightMm: 7, kv: 1800 } },
  { kind: "motor", id: "m2806.5-1300", title: "2806.5 1300KV", tags: "7\" 6S лонг-рейндж", motor: { statorMm: 28, heightMm: 6.5, kv: 1300 } },
  { kind: "motor", id: "m2808-1350", title: "2808 1350KV", tags: "7\" 6S", motor: { statorMm: 28, heightMm: 8, kv: 1350 } },
  { kind: "motor", id: "m2810-1300", title: "2810 1300KV", tags: "7\" 6S", motor: { statorMm: 28, heightMm: 10, kv: 1300 } },
  { kind: "motor", id: "m2812-900", title: "2812 900KV", tags: "8\" 6S", motor: { statorMm: 28, heightMm: 12, kv: 900 } },
  { kind: "motor", id: "m3115-900", title: "3115 900KV", tags: "9–10\" 6S", motor: { statorMm: 31, heightMm: 15, kv: 900 } },
  { kind: "motor", id: "m4114-400", title: "4114 400KV", tags: "13–15\" 6S тяжёлый", motor: { statorMm: 41, heightMm: 14, kv: 400 } },
  // винты: диаметр × шаг × лопасти
  { kind: "prop", id: "p31", title: N_("31 мм, 4 лопасти"), tags: "вуп 65", prop: { diameterIn: 1.22, pitchIn: 0.85, blades: 4 } },
  { kind: "prop", id: "p40", title: N_("40 мм, 3 лопасти"), tags: "вуп 75", prop: { diameterIn: 1.57, pitchIn: 1.0, blades: 3 } },
  { kind: "prop", id: "p3018", title: "3018 × 5", tags: "синевуп 3\"", prop: { diameterIn: 3.0, pitchIn: 1.8, blades: 5 } },
  { kind: "prop", id: "p3030", title: "3030 × 3", tags: "3\"", prop: { diameterIn: 3.0, pitchIn: 3.0, blades: 3 } },
  { kind: "prop", id: "p5043", title: "5043 × 3", tags: "5\" 5.1", prop: { diameterIn: 5.1, pitchIn: 4.3, blades: 3 } },
  { kind: "prop", id: "p5136", title: "5136 × 3", tags: "5\"", prop: { diameterIn: 5.1, pitchIn: 3.6, blades: 3 } },
  { kind: "prop", id: "p6030", title: "6030 × 3", tags: "6\"", prop: { diameterIn: 6.0, pitchIn: 3.0, blades: 3 } },
  { kind: "prop", id: "p7040x2", title: "7040 × 2", tags: "7\" лонг-рейндж", prop: { diameterIn: 7.0, pitchIn: 4.0, blades: 2 } },
  { kind: "prop", id: "p7040x3", title: "7040 × 3", tags: "7\"", prop: { diameterIn: 7.0, pitchIn: 4.0, blades: 3 } },
  { kind: "prop", id: "p8045", title: "8045 × 3", tags: "8\"", prop: { diameterIn: 8.0, pitchIn: 4.5, blades: 3 } },
  { kind: "prop", id: "p1050", title: "1050 × 3", tags: "10\"", prop: { diameterIn: 10.0, pitchIn: 5.0, blades: 3 } },
  // батареи
  { kind: "battery", id: "b1s300", title: N_("1S 300 мА·ч LiHV"), tags: "вуп", battery: { cells: 1, mah: 300, chemistry: "LIHV", c: 30 } },
  { kind: "battery", id: "b4s650", title: N_("4S 650 мА·ч LiPo"), tags: "3\"", battery: { cells: 4, mah: 650, chemistry: "LIPO", c: 75 } },
  { kind: "battery", id: "b4s850", title: N_("4S 850 мА·ч LiPo"), tags: "синевуп", battery: { cells: 4, mah: 850, chemistry: "LIPO", c: 75 } },
  { kind: "battery", id: "b6s1100", title: N_("6S 1100 мА·ч LiPo"), tags: "5\"", battery: { cells: 6, mah: 1100, chemistry: "LIPO", c: 100 } },
  { kind: "battery", id: "b6s1300", title: N_("6S 1300 мА·ч LiPo"), tags: "5\"", battery: { cells: 6, mah: 1300, chemistry: "LIPO", c: 100 } },
  { kind: "battery", id: "b6s1800", title: N_("6S 1800 мА·ч LiPo"), tags: "6–7\"", battery: { cells: 6, mah: 1800, chemistry: "LIPO", c: 80 } },
  {
    kind: "battery",
    id: "b6s1p21700",
    title: N_("6S1P 21700 Li-ion 4000 мА·ч"),
    tags: "7\" лонг-рейндж p42a",
    battery: { cells: 6, mah: 4000, chemistry: "LIION", c: 10 },
    note: N_("у Li-ion токоотдача — с банки (≈ 45 А у 21700 → 10C)"),
  },
  { kind: "battery", id: "b6s2p21700", title: N_("6S2P 21700 Li-ion 8000 мА·ч"), tags: "8–10\" лонг-рейндж", battery: { cells: 6, mah: 8000, chemistry: "LIION", c: 10 } },
  // регуляторы: ток на мотор
  { kind: "esc", id: "e12", title: N_("12 А на мотор"), tags: "вуп AIO", esc: { continuousA: 12, burstA: 15 } },
  { kind: "esc", id: "e20", title: N_("20 А на мотор"), tags: "2–3\"", esc: { continuousA: 20, burstA: 25 } },
  { kind: "esc", id: "e35", title: N_("35 А на мотор"), tags: "4–5\"", esc: { continuousA: 35, burstA: 45 } },
  { kind: "esc", id: "e45", title: N_("45 А на мотор"), tags: "5\"", esc: { continuousA: 45, burstA: 55 } },
  { kind: "esc", id: "e55", title: N_("55 А на мотор"), tags: "5–7\"", esc: { continuousA: 55, burstA: 65 } },
  { kind: "esc", id: "e60", title: N_("60 А на мотор"), tags: "7\"", esc: { continuousA: 60, burstA: 70 } },
  { kind: "esc", id: "e80", title: N_("80 А на мотор"), tags: "8–10\"", esc: { continuousA: 80, burstA: 100 } },
  // видео
  { kind: "vtx", id: "v25", title: N_("25 мВт"), tags: "вуп", vtxMw: 25 },
  { kind: "vtx", id: "v400", title: N_("400 мВт"), vtxMw: 400 },
  { kind: "vtx", id: "v800", title: N_("800 мВт"), vtxMw: 800 },
  { kind: "vtx", id: "v1600", title: N_("1.6 Вт"), tags: "лонг-рейндж", vtxMw: 1600 },
  { kind: "vtx", id: "v2500", title: N_("2.5 Вт"), tags: "лонг-рейндж", vtxMw: 2500 },
  { kind: "vtx", id: "v4000", title: N_("4 Вт"), tags: "лонг-рейндж", vtxMw: 4000 },
  // камеры
  { kind: "camera", id: "c-analog", title: N_("Аналоговая"), tags: "ratel caddx runcam" },
  { kind: "camera", id: "c-dji", title: "DJI O3 / O4", tags: "цифра" },
  { kind: "camera", id: "c-walksnail", title: "Walksnail Avatar", tags: "цифра" },
  { kind: "camera", id: "c-hdzero", title: "HDZero", tags: "цифра" },
  // рамы
  { kind: "frame", id: "f65", title: N_("Вуп 65 мм"), frame: { wheelbaseMm: 65, massG: 22 } },
  { kind: "frame", id: "f3", title: N_("3\" рама"), frame: { wheelbaseMm: 140, massG: 190 } },
  { kind: "frame", id: "f5", title: N_("5\" рама, 225 мм"), tags: "фристайл", frame: { wheelbaseMm: 225, massG: 680 } },
  { kind: "frame", id: "f7", title: N_("7\" рама, 300 мм"), tags: "лонг-рейндж", frame: { wheelbaseMm: 300, massG: 950 } },
  { kind: "frame", id: "f10", title: N_("10\" рама, 420 мм"), frame: { wheelbaseMm: 420, massG: 1800 } },
];

export const KIND_TITLES: Record<PartKind, string> = {
  motor: N_("Мотор"),
  prop: N_("Винты"),
  battery: N_("Батарея"),
  esc: N_("Регулятор"),
  vtx: N_("Видеопередатчик"),
  camera: N_("Камера"),
  frame: N_("Рама"),
};

/** Поиск по каталогу: все слова запроса — в названии или тегах. */
export function searchCatalog(kind: PartKind, query: string, translate: (s: string) => string = (s) => s): CatalogItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return CATALOG.filter((c) => c.kind === kind).filter((c) => {
    const text = `${translate(c.title)} ${c.title} ${c.tags ?? ""}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

// ---------------- оценка (copter/Propulsion.h) ----------------

const RHO = 1.225;
const G = 9.80665;

/** Напряжение банки под нагрузкой (Battery.h cellVoltages().loaded). */
export const LOADED_CELL_V: Record<Chemistry, number> = { LIPO: 3.75, LIHV: 3.85, LIION: 3.5 };

function bladeFactor(n: number): number {
  return ({ 2: 1.0, 3: 1.3, 4: 1.5, 5: 1.65, 6: 1.75 } as Record<number, number>)[n] ?? (n < 2 ? 0.7 : 1.8);
}

export interface MotorModel {
  kT: number;
  kQ: number;
  kvRad: number;
  resistance: number;
}

export function motorModel(prop: PropSpec, motor: MotorSpec): MotorModel {
  const d = prop.diameterIn * 0.0254;
  const pd = Math.min(1.5, Math.max(0.3, prop.pitchIn / prop.diameterIn));
  const bf = bladeFactor(prop.blades);
  const ct = (0.07 + 0.11 * pd) * bf;
  const cp = (0.025 + 0.12 * pd) * Math.pow(bf, 1.1);
  const fourPi2 = 4 * Math.PI * Math.PI;
  const volume = Math.PI * (motor.statorMm / 2) ** 2 * motor.heightMm;
  return {
    kT: (ct * RHO * d ** 4) / fourPi2,
    kQ: ((cp / (2 * Math.PI)) * RHO * d ** 5) / fourPi2,
    kvRad: (motor.kv * 2 * Math.PI) / 60,
    resistance: 0.004 + 0.11 * (2400 / motor.kv) ** 2 * (2661 / volume) ** (5 / 3),
  };
}

function steadyOmega(m: MotorModel, u: number, volts: number): number {
  const a = m.kQ;
  const b = 1 / (m.resistance * m.kvRad * m.kvRad);
  const c = -(Math.max(0, u) * volts) / (m.resistance * m.kvRad);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

function point(m: MotorModel, u: number, volts: number) {
  const w = steadyOmega(m, u, volts);
  return { thrustG: (m.kT * w * w * 1000) / G, amps: Math.max(0, (u * volts - w / m.kvRad) / m.resistance), rpm: (w * 60) / (2 * Math.PI) };
}

export interface BuildInput {
  motor: MotorSpec;
  prop: PropSpec;
  battery: BatterySpec;
  esc?: EscSpec;
  massG: number;
  motors?: number;
}

export type BuildWarning = "no-lift" | "low-thrust" | "esc-burst" | "esc-continuous" | "battery-c";

export interface BuildEstimate {
  volts: number;
  /** на один мотор на полном газе */
  fullThrustG: number;
  fullAmpsPerMotor: number;
  fullRpm: number;
  /** весь коптер */
  fullAmps: number;
  thrustToWeight: number;
  /** газ висения 0…1 (скважность) и ток на висении, А */
  hoverThrottle: number | null;
  hoverAmps: number | null;
  /** минут висения на 80 % ёмкости */
  hoverMinutes: number | null;
  /** что батарея может отдать длительно, А (0 — C не задан) */
  batteryMaxA: number;
  warnings: BuildWarning[];
}

export function estimateBuild(b: BuildInput): BuildEstimate {
  const n = b.motors ?? 4;
  const volts = b.battery.cells * LOADED_CELL_V[b.battery.chemistry];
  const m = motorModel(b.prop, b.motor);
  const full = point(m, 1, volts);
  const weightG = Math.max(1, b.massG);
  const thrustToWeight = (full.thrustG * n) / weightG;
  let hoverThrottle: number | null = null;
  let hoverAmps: number | null = null;
  if (thrustToWeight > 1) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (point(m, mid, volts).thrustG * n < weightG) lo = mid;
      else hi = mid;
    }
    hoverThrottle = hi;
    // ток батареи = ток мотора × скважность (регулятор — понижающий преобразователь)
    hoverAmps = point(m, hi, volts).amps * hi * n;
  }
  const hoverMinutes = hoverAmps ? (0.8 * b.battery.mah) / 1000 / hoverAmps * 60 : null;
  const batteryMaxA = b.battery.c > 0 ? (b.battery.c * b.battery.mah) / 1000 : 0;
  const fullAmps = full.amps * n;
  const warnings: BuildWarning[] = [];
  if (thrustToWeight < 1.2) warnings.push("no-lift");
  else if (thrustToWeight < 1.8) warnings.push("low-thrust");
  if (b.esc && b.esc.continuousA > 0) {
    const burst = b.esc.burstA > 0 ? b.esc.burstA : b.esc.continuousA * 1.25;
    if (full.amps > burst) warnings.push("esc-burst");
    else if (full.amps > b.esc.continuousA) warnings.push("esc-continuous");
  }
  if (batteryMaxA > 0 && fullAmps > batteryMaxA) warnings.push("battery-c");
  return {
    volts,
    fullThrustG: full.thrustG,
    fullAmpsPerMotor: full.amps,
    fullRpm: full.rpm,
    fullAmps,
    thrustToWeight,
    hoverThrottle,
    hoverAmps,
    hoverMinutes,
    batteryMaxA,
    warnings,
  };
}

export const WARNING_TEXT: Record<BuildWarning, string> = {
  "no-lift": N_("Тяги почти нет: коптер едва оторвётся (тяговооружённость меньше 1.2)"),
  "low-thrust": N_("Тяги мало: вялый, плохо держит ветер (меньше 1.8)"),
  "esc-burst": N_("На полном газе мотор тянет больше пикового тока регулятора — сгорит. Винт меньше, KV ниже или регулятор мощнее."),
  "esc-continuous": N_("На полном газе мотор тянет больше длительного тока регулятора: коротко можно, долго — перегрев. Прошивка предупредит в очках (ESC OVERLOAD)."),
  "battery-c": N_("Полный газ просит больше, чем батарея отдаёт длительно (C × ёмкость): просадка и нагрев. Прошивка предупредит (BATT OVERLOAD)."),
};

// ---------------- настройки платы ----------------

/** Значения деталей → настройки описания коптера (имена — Params.h). */
export function partParams(kind: PartKind, item: CatalogItem): Record<string, string | number> {
  switch (kind) {
    case "motor":
      return item.motor ? { motor_stator_mm: item.motor.statorMm, motor_height_mm: item.motor.heightMm, motor_kv: item.motor.kv } : {};
    case "prop":
      return item.prop ? { prop_diameter_in: item.prop.diameterIn, prop_pitch_in: item.prop.pitchIn, prop_blades: item.prop.blades } : {};
    case "battery":
      return item.battery
        ? { battery_cells: item.battery.cells, battery_mah: item.battery.mah, battery_chemistry: item.battery.chemistry, battery_c_rating: item.battery.c }
        : {};
    case "esc":
      return item.esc ? { esc_current_a: item.esc.continuousA, esc_burst_current_a: item.esc.burstA } : {};
    case "vtx":
      return item.vtxMw ? { vtx_max_power_mw: item.vtxMw } : {};
    case "frame":
      return item.frame ? { copter_wheelbase_mm: item.frame.wheelbaseMm, copter_mass_g: item.frame.massG } : {};
    default:
      return {};
  }
}

/** Числа платы → вход оценки (null — описания на плате ещё нет). */
export function buildFromParams(v: (name: string) => number | string | undefined): BuildInput | null {
  const num = (name: string) => Number(v(name) ?? NaN);
  const chem = String(v("battery_chemistry") ?? "LIPO").toUpperCase();
  const b: BuildInput = {
    motor: { statorMm: num("motor_stator_mm"), heightMm: num("motor_height_mm"), kv: num("motor_kv") },
    prop: { diameterIn: num("prop_diameter_in"), pitchIn: num("prop_pitch_in"), blades: num("prop_blades") },
    battery: {
      cells: num("battery_cells"),
      mah: num("battery_mah"),
      chemistry: (["LIPO", "LIHV", "LIION"].includes(chem) ? chem : "LIPO") as Chemistry,
      c: Number(v("battery_c_rating") ?? 0) || 0,
    },
    esc: { continuousA: Number(v("esc_current_a") ?? 0) || 0, burstA: Number(v("esc_burst_current_a") ?? 0) || 0 },
    massG: num("copter_mass_g"),
  };
  const all = [b.motor.statorMm, b.motor.heightMm, b.motor.kv, b.prop.diameterIn, b.prop.pitchIn, b.prop.blades, b.battery.cells, b.battery.mah, b.massG];
  return all.every((x) => Number.isFinite(x) && x > 0) ? b : null;
}
