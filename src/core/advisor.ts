// «Нет дрона — подбор» (P07): по ответам знакомства (опыт, что летает, зачем)
// и двум вопросам — бюджет, готовый или сборка — класс дрона, что купить,
// полётники, на которых работает наша прошивка, и что нужно для симулятора.
//
// Цены — порядок в долларах на 2026 год, а не прайс магазина: чтобы новичок
// понял, во что встанет хобби целиком (пульт и очки — больше половины), и не
// купил 7" лонг-рейндж первым дроном. Детали сборки — из каталога P03, оценка
// полёта — той же физикой (estimateBuild).

import { N_ } from "../i18n";
import type { CopterEnv } from "./copter";
import type { ManifestBoard } from "./manifest";
import { BuildEstimate, CATALOG, CatalogItem, estimateBuild } from "./parts";
import { CraftClass, guided, PilotAnswers } from "./pilot";

export type Budget = "low" | "mid" | "high";
export type BuyPath = "bnf" | "build";

export const BUDGETS: { id: Budget; title: string; desc: string; capUsd: number }[] = [
  { id: "low", title: N_("Немного"), desc: N_("до ≈ $300 на всё"), capUsd: 300 },
  { id: "mid", title: N_("Средне"), desc: N_("≈ $300–700"), capUsd: 700 },
  { id: "high", title: N_("Не жалко"), desc: N_("больше $700, цифровое видео"), capUsd: Infinity },
];

export const PATHS: { id: BuyPath; title: string; desc: string }[] = [
  { id: "bnf", title: N_("Готовый"), desc: N_("BNF: достал, привязал к пульту, полетел") },
  { id: "build", title: N_("Собрать"), desc: N_("Паяльник, детали по списку — дешевле чинить и понятнее, как устроен") },
];

export type Usd = [number, number];

export interface ShopItem {
  what: string;
  why: string;
  usd: Usd;
}

export interface Advice {
  cls: CraftClass;
  reason: string;
  /** новичку — сначала вуп в комнате, а выбранный класс — вторым */
  whoopFirst: boolean;
  /** сам дрон: готовый или сумма деталей */
  drone: ShopItem;
  /** детали сборки из каталога (у крыла — пусто) */
  parts: CatalogItem[];
  /** оценка полёта сборки; у вупа — нет */
  estimate: BuildEstimate | null;
  /** пульт, очки, батареи, зарядка */
  gear: ShopItem[];
  /** симуляторы; пульт тот же — по USB */
  sim: ShopItem[];
  digital: boolean;
  total: Usd;
  /** набор дороже выбранного бюджета */
  overBudget: boolean;
}

// Детали сборки по классу: id из CATALOG (parts.ts).
const KITS: Record<Exclude<CraftClass, "wing" | "vtol">, { motor: string; prop: string; battery: string; esc: string; frame: string }> = {
  whoop: { motor: "m0802", prop: "p31", battery: "b1s300", esc: "e12", frame: "f65" },
  cine: { motor: "m1404l", prop: "p3018", battery: "b4s850", esc: "e20", frame: "f3" },
  quad5: { motor: "m2207-1950", prop: "p5136", battery: "b6s1100", esc: "e55", frame: "f5" },
  quad7: { motor: "m2806.5-1300", prop: "p7040x3", battery: "b6s1p21700", esc: "e55", frame: "f7" },
};
const VTX: Record<CraftClass, string> = { whoop: "v25", cine: "v400", quad5: "v800", quad7: "v1600", wing: "v800", vtol: "v800" };

const DRONE: Record<CraftClass, { title: string; desc: string; bnf: Usd; build: Usd; batteries: ShopItem; charger: ShopItem }> = {
  whoop: {
    title: N_("Вуп 65–75 мм, 1S"),
    desc: N_("Летает в комнате, не ломается и никого не порежет — лучший первый дрон"),
    bnf: [90, 140],
    build: [110, 170],
    batteries: { what: N_("Батареи 1S 300 мА·ч, 6 шт."), why: N_("Летает 3–4 минуты, нужно несколько"), usd: [25, 40] },
    charger: { what: N_("Зарядка на 6 банок 1S"), why: N_("Заряжать всё сразу"), usd: [20, 35] },
  },
  cine: {
    title: N_("Синевуп 3\", 4S"),
    desc: N_("Плавная съёмка рядом с людьми и в помещении, винты в защите"),
    bnf: [220, 350],
    build: [200, 300],
    batteries: { what: N_("Батареи 4S 850 мА·ч, 4 шт."), why: N_("Летает 4–6 минут"), usd: [60, 90] },
    charger: { what: N_("Зарядка с балансиром, 2–6S"), why: N_("Балансир бережёт банки"), usd: [40, 80] },
  },
  quad5: {
    title: N_("5\" фристайл, 6S"),
    desc: N_("Основной класс: фристайл и гонки, запчасти везде"),
    bnf: [250, 400],
    build: [220, 350],
    batteries: { what: N_("Батареи 6S 1100 мА·ч, 4 шт."), why: N_("Летает 3–5 минут"), usd: [90, 130] },
    charger: { what: N_("Зарядка с балансиром, 2–6S, от 100 Вт"), why: N_("6S заряжается долго на слабой"), usd: [50, 90] },
  },
  quad7: {
    title: N_("7\" лонг-рейндж, 6S Li-ion"),
    desc: N_("Далеко и долго: 15–25 минут на Li-ion, GPS и возврат домой"),
    bnf: [380, 600],
    build: [330, 520],
    batteries: { what: N_("Батареи 6S1P 21700 Li-ion, 2 шт."), why: N_("Одна на 15–25 минут"), usd: [80, 130] },
    charger: { what: N_("Зарядка с балансиром, 2–6S, от 100 Вт"), why: N_("Li-ion заряжать до 4.2 В на банку"), usd: [50, 90] },
  },
  wing: {
    title: N_("Летающее крыло 800–1000 мм"),
    desc: N_("Долго и далеко, прощает ошибки, садится на траву. Полётник — Matek H743-WING"),
    bnf: [200, 350],
    build: [180, 300],
    batteries: { what: N_("Батареи 4S Li-ion 21700, 2 шт."), why: N_("30–60 минут полёта"), usd: [60, 100] },
    charger: { what: N_("Зарядка с балансиром, 2–6S"), why: N_("Балансир бережёт банки"), usd: [40, 80] },
  },
  vtol: {
    title: N_("Конвертоплан (VTOL)"),
    desc: N_("Взлёт без полосы и долгий полёт крылом; сложнее в настройке"),
    bnf: [450, 900],
    build: [400, 700],
    batteries: { what: N_("Батареи 4–6S Li-ion, 2 шт."), why: N_("Висение ест много — запас нужен"), usd: [80, 150] },
    charger: { what: N_("Зарядка с балансиром, 2–6S, от 100 Вт"), why: N_("Балансир бережёт банки"), usd: [50, 90] },
  },
};

const isWing = (c: CraftClass) => c === "wing" || c === "vtol";

/** Класс по ответам знакомства и почему. */
export function pickClass(a: PilotAnswers, budget: Budget): { cls: CraftClass; reason: string } {
  const chosen = a.classes.filter((c) => a.craft === "both" || (a.craft === "wing") === isWing(c));
  if (chosen.length) return { cls: chosen[0], reason: N_("Этот класс ты выбрал в знакомстве") };
  const g = a.goals;
  if (a.craft === "wing") return { cls: "wing", reason: N_("Ты выбрал крылья: крыло — самое простое и долгое в полёте") };
  if (g.includes("mapping") && a.craft === "both") return { cls: "wing", reason: N_("Для съёмки местности крыло облетит больше за один заряд") };
  if (g.includes("longrange") || g.includes("mapping") || g.includes("work")) {
    if (budget === "low") return { cls: "quad5", reason: N_("Далеко хочется, но 7\" в «немного» не влезает: 5\" с GPS — шаг к нему") };
    return { cls: "quad7", reason: N_("Далеко и долго: 7\" на Li-ion с GPS и возвратом домой") };
  }
  if (g.includes("freestyle") || g.includes("race")) return { cls: "quad5", reason: N_("Фристайл и гонки летают на 5\"") };
  if (g.includes("school")) return { cls: "whoop", reason: N_("Для учеников — вупы: дёшево, безопасно, летают в зале") };
  if (guided(a.experience)) return { cls: "whoop", reason: N_("Первый дрон — вуп: учиться в комнате дёшево и безопасно") };
  return { cls: "quad5", reason: N_("Самый ходовой класс: всё умеет, запчасти везде") };
}

const add = (a: Usd, b: Usd): Usd => [a[0] + b[0], a[1] + b[1]];
const byId = (id: string) => CATALOG.find((x) => x.id === id)!;

export function advise(a: PilotAnswers, budget: Budget, path: BuyPath): Advice {
  const { cls, reason } = pickClass(a, budget);
  const d = DRONE[cls];
  const digital = budget === "high" && cls !== "whoop";
  const newbie = guided(a.experience);
  const whoopFirst = newbie && cls !== "whoop" && !isWing(cls);

  let parts: CatalogItem[] = [];
  let estimate: BuildEstimate | null = null;
  if (!isWing(cls)) {
    const k = KITS[cls as keyof typeof KITS];
    parts = [k.frame, k.motor, k.prop, k.esc, k.battery, VTX[cls], digital ? "c-dji" : "c-analog"].map(byId);
    const frame = byId(k.frame).frame!;
    // у моторов 08xx модель завышает время висения в разы — не показываем
    if (cls !== "whoop") estimate = estimateBuild({ motor: byId(k.motor).motor!, prop: byId(k.prop).prop!, battery: byId(k.battery).battery!, esc: byId(k.esc).esc, massG: frame.massG });
  }
  // цифровое видео на дроне — сверху цены аналоговой комплектации
  const droneUsd = add(path === "bnf" ? d.bnf : d.build, digital ? [120, 180] : [0, 0]);
  const drone: ShopItem = { what: d.title, why: d.desc, usd: droneUsd };

  const gear: ShopItem[] = [
    budget === "low"
      ? { what: N_("Пульт EdgeTX с ELRS, компактный"), why: N_("Тот же пульт — в симуляторе по USB и на всех дронах"), usd: [60, 90] }
      : { what: N_("Пульт EdgeTX с ELRS, полноразмерный, стики на датчиках Холла"), why: N_("Тот же пульт — в симуляторе по USB и на всех дронах"), usd: [120, 180] },
    digital
      ? { what: N_("Цифровые очки (DJI, Walksnail или HDZero)"), why: N_("Чёткая картинка; система видео на дроне должна быть та же"), usd: [400, 550] }
      : budget === "low"
        ? { what: N_("Аналоговые очки-коробка"), why: N_("Самый дешёвый вход; потом пригодятся как запасные"), usd: [50, 90] }
        : { what: N_("Аналоговые очки с приёмником на разнесённых антеннах"), why: N_("Меньше помех, ловят любой аналоговый дрон"), usd: [150, 300] },
    d.batteries,
    d.charger,
  ];
  if (whoopFirst) gear.unshift({ what: DRONE.whoop.title, why: N_("Сначала — вуп: научиться в комнате, потом не бить дорогой дрон"), usd: DRONE.whoop.bnf });

  const sim: ShopItem[] = [
    { what: "FPV.SkyDive", why: N_("Бесплатный: первые часы и проверка, что пульт работает"), usd: [0, 0] },
    { what: "Liftoff", why: N_("Самый популярный: фристайл и трассы"), usd: [15, 25] },
    { what: "Uncrashed", why: N_("Красивые места, честная физика фристайла"), usd: [15, 25] },
    { what: "VelociDrone", why: N_("Гонки и онлайн-трассы"), usd: [15, 25] },
  ];

  const total = [drone, ...gear].reduce((s, x) => add(s, x.usd), [0, 0] as Usd);
  const cap = BUDGETS.find((b) => b.id === budget)!.capUsd;
  return { cls, reason, whoopFirst, drone, parts, estimate, gear, sim, digital, total, overBudget: total[0] > cap };
}

/** Полётники, на которых работает наша прошивка: коптер — из сборок без дампа, крыло — готовые платы с набором датчиков. */
export function compatibleBoards(cls: CraftClass, envs: CopterEnv[], boards: ManifestBoard[]): string[] {
  if (isWing(cls)) return boards.filter((b) => b.kit).map((b) => b.title);
  return envs.filter((e) => !e.needsBoardDump).map((e) => e.title);
}

export const fmtUsd = (u: Usd) => (u[1] === 0 ? N_("бесплатно") : u[0] === u[1] ? `$${u[0]}` : `$${u[0]}–${u[1]}`);
