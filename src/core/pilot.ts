// Профиль пилота: ответы анкеты первого запуска (P01) → наборы функций (P05).
// Набор — это вкладки, разделы и подсказки, которые видны; прошивка от
// наборов не зависит. Профиль живёт в настройках приложения, не в проекте
// дрона. «Показать всё» открывает всё, не трогая выбранные наборы.

import { N_ } from "../i18n";
import type { Section } from "../store";
import { BEGINNER_TABS, CopterTab, TABS } from "./copterParams";

export type Experience = "new" | "sim" | "flying" | "pro" | "instructor";
export type Craft = "quad" | "wing" | "both";
export type CraftClass = "whoop" | "quad5" | "quad7" | "cine" | "wing" | "vtol";
export type Goal = "freestyle" | "race" | "longrange" | "mapping" | "work" | "school" | "all";
export type Pack = "base" | "freestyle" | "race" | "longrange" | "wing" | "work" | "fleet" | "school" | "geek";

export interface PilotAnswers {
  experience: Experience;
  craft: Craft;
  classes: CraftClass[];
  goals: Goal[];
  /** дрон уже есть; null — не ответил */
  hasDrone: boolean | null;
}

export interface PilotProfile extends PilotAnswers {
  /** включённые наборы («Основа» — всегда) */
  packs: Pack[];
  /** «Показать всё» — видно всё, наборы не трогаются */
  showAll?: boolean;
  /** анкету пропустили: «Основа» и мастер */
  skipped?: boolean;
  /** когда ответили, ISO */
  at: string;
}

export const EXPERIENCES: { id: Experience; title: string; desc: string }[] = [
  { id: "new", title: N_("Только начинаю"), desc: N_("Ещё не летал — покажем всё по шагам") },
  { id: "sim", title: N_("Летаю в симуляторе"), desc: N_("Стики знакомы, настоящего дрона ещё не было") },
  { id: "flying", title: N_("Летаю"), desc: N_("Есть дрон, настраивал в Betaflight или INAV") },
  { id: "pro", title: N_("Профи"), desc: N_("Знаю PID, фильтры и CLI — покажите всё") },
  { id: "instructor", title: N_("Инструктор"), desc: N_("Учу других: ученики, ограничения, симулятор") },
];

export const CRAFTS: { id: Craft; title: string; desc: string }[] = [
  { id: "quad", title: N_("Квадрокоптеры"), desc: N_("Вупы, 5\", 7\", сине") },
  { id: "wing", title: N_("Крылья и самолёты"), desc: N_("Летающее крыло, самолёт, VTOL") },
  { id: "both", title: N_("И то и то"), desc: N_("Ангар на всё сразу") },
];

export const CLASSES: { id: CraftClass; title: string; desc: string; craft: "quad" | "wing" }[] = [
  { id: "whoop", title: N_("Вуп"), desc: N_("Маленький, для дома и зала"), craft: "quad" },
  { id: "quad5", title: N_("3–5\""), desc: N_("Фристайл и гонки"), craft: "quad" },
  { id: "quad7", title: N_("7\" и больше"), desc: N_("Лонг-рейндж, большие батареи"), craft: "quad" },
  { id: "cine", title: N_("Сине"), desc: N_("Плавная съёмка, защита винтов"), craft: "quad" },
  { id: "wing", title: N_("Крыло, самолёт"), desc: N_("Долго и далеко, автопилот"), craft: "wing" },
  { id: "vtol", title: N_("VTOL"), desc: N_("Взлёт как коптер, полёт как самолёт"), craft: "wing" },
];

export const GOALS: { id: Goal; title: string; desc: string }[] = [
  { id: "freestyle", title: N_("Фристайл"), desc: N_("Трюки, споты, акро") },
  { id: "race", title: N_("Гонки"), desc: N_("Трасса, таймер кругов, малая задержка") },
  { id: "longrange", title: N_("Съёмка и дальние полёты"), desc: N_("GPS, возврат домой, плавность, запас хода") },
  { id: "mapping", title: N_("Картография и инспекция"), desc: N_("Миссии, сетка съёмки, геометки") },
  { id: "work", title: N_("Доставка и работа"), desc: N_("Грузы, флот, журналы, ТО") },
  { id: "school", title: N_("Учиться и учить"), desc: N_("Ограничения, ученик–инструктор, симулятор") },
  { id: "all", title: N_("Всё и сразу"), desc: N_("Включить все наборы") },
];

export const PACKS: { id: Pack; title: string; desc: string }[] = [
  { id: "base", title: N_("Основа"), desc: N_("Мастер по шагам, приёмник, моторы, безопасность, питание") },
  { id: "freestyle", title: N_("Фристайл"), desc: N_("PID, расходы, фильтры, видео и OSD, чёрный ящик") },
  { id: "race", title: N_("Гонки"), desc: N_("Расходы, фильтры, задержка, таймер кругов") },
  { id: "longrange", title: N_("Съёмка и дальние"), desc: N_("GPS и возврат, OSD, видео, онлайн-телеметрия") },
  { id: "wing", title: N_("Крылья и автопилот"), desc: N_("Самолёты и крылья: плата, рули, автопилот") },
  { id: "work", title: N_("Работа: миссии и журналы"), desc: N_("Миссии, журналы полётов, GPS, онлайн") },
  { id: "fleet", title: N_("Флот"), desc: N_("Грузы, несколько бортов, ТО, роли") },
  { id: "school", title: N_("Школа"), desc: N_("Ограничения ученика, инструктор, симулятор") },
  { id: "geek", title: N_("Гик"), desc: N_("CLI, прочие настройки, отладка — всё сырое") },
];

const ALL_PACKS = PACKS.map((p) => p.id);
const GOAL_PACKS: Record<Goal, Pack[]> = {
  freestyle: ["freestyle"],
  race: ["race"],
  longrange: ["longrange"],
  mapping: ["work"],
  work: ["work", "fleet"],
  school: ["school"],
  all: ALL_PACKS,
};

/** Наборы по ответам: «Основа» всегда; профи — всё. Порядок — как в PACKS. */
export function packsFor(a: PilotAnswers): Pack[] {
  const on = new Set<Pack>(["base"]);
  for (const g of a.goals) for (const p of GOAL_PACKS[g]) on.add(p);
  if (a.craft !== "quad" || a.classes.some((c) => c === "wing" || c === "vtol")) on.add("wing");
  if (a.classes.includes("quad7") || a.classes.includes("cine")) on.add("longrange");
  if (a.experience === "instructor") on.add("school");
  if (a.experience === "pro") for (const p of ALL_PACKS) on.add(p);
  return ALL_PACKS.filter((p) => on.has(p));
}

/** Новичку — мастер и ползунки вместо вкладок «Основы». */
export const guided = (e: Experience) => e === "new" || e === "sim";

export function makeProfile(a: PilotAnswers, at = new Date().toISOString()): PilotProfile {
  return { ...a, packs: packsFor(a), at };
}

/** Пропустили анкету: «Основа» и мастер; всё скрытое находит поиск. */
export function skippedProfile(at = new Date().toISOString()): PilotProfile {
  return { experience: "new", craft: "both", classes: [], goals: [], hasDrone: null, packs: ["base", "wing"], skipped: true, at };
}

type PilotSettings = { pilot?: PilotProfile; copterMode?: "beginner" | "pro" };

/**
 * Профиль из настроек. Анкеты ещё не было — из прежнего переключателя
 * «Новичок/Профи» без потерь: «Профи» = видно всё, «Новичок» и пусто —
 * «Основа» с мастером (самолёты видны: ими пользовались до анкеты).
 */
export function profileOf(settings: PilotSettings): PilotProfile {
  if (settings.pilot) return settings.pilot;
  if (settings.copterMode === "pro") return { ...makeProfile({ experience: "pro", craft: "both", classes: [], goals: [], hasDrone: true }, ""), showAll: true };
  return skippedProfile("");
}

/** Анкету ещё не проходили и не пропускали — показать при запуске. */
export const needsOnboarding = (settings: PilotSettings) => !settings.pilot;

// ---------------- что видно ----------------

/** Вкладка коптера → наборы, в которых она видна. "guided" — вкладки новичка. */
const TAB_PACKS: Record<CopterTab, (Pack | "guided")[]> = {
  wizard: ["guided"],
  flight: ["guided"],
  overview: ["base"],
  parts: ["guided", "base"],
  frombf: ["base"],
  setup: ["base"],
  receiver: ["base"],
  modes: ["base"],
  motors: ["base"],
  failsafe: ["base"],
  power: ["base"],
  beeper: ["base"],
  pid: ["freestyle", "race", "geek"],
  rates: ["freestyle", "race", "longrange"],
  filters: ["freestyle", "race", "geek"],
  vtx: ["freestyle", "race", "longrange"],
  osd: ["freestyle", "race", "longrange", "work"],
  gps: ["longrange", "work", "fleet", "school"],
  blackbox: ["freestyle", "race", "longrange", "work", "geek"],
  other: ["geek"],
  cli: ["geek"],
};

const ALL_TABS = [...BEGINNER_TABS, ...TABS];

/** Набор, который откроет вкладку (для «это в наборе Гонки — включить?»); null — новичковая. */
export function tabPack(tab: CopterTab): Pack | null {
  const p = TAB_PACKS[tab].find((x): x is Pack => x !== "guided");
  return p ?? null;
}

/**
 * Вкладки коптера по профилю. Новичок: мастер, «Настройка полёта» и
 * вкладки выбранных им наборов сверх «Основы»; остальные — «Основа» и
 * наборы; «Показать всё» — все вкладки, мастер первым.
 */
export function copterTabs(p: PilotProfile) {
  if (p.showAll) return ALL_TABS;
  const g = guided(p.experience);
  return ALL_TABS.filter((x) =>
    TAB_PACKS[x.id].some((k) => (k === "guided" ? g : k === "base" ? !g : p.packs.includes(k))),
  );
}

/** Разделы слева → наборы; нет в таблице — видны всегда. */
const SECTION_PACKS: Partial<Record<Section, Pack[]>> = {
  board: ["wing"],
  live: ["longrange", "work", "fleet"],
  cargo: ["fleet"],
};

export function sectionVisible(p: PilotProfile, s: Section): boolean {
  const need = SECTION_PACKS[s];
  return !need || !!p.showAll || need.some((k) => p.packs.includes(k));
}

/** Включить или выключить набор; «Основу» не выключить. */
export function togglePack(p: PilotProfile, pack: Pack): PilotProfile {
  if (pack === "base") return p;
  const on = p.packs.includes(pack);
  const packs = ALL_PACKS.filter((k) => (k === pack ? !on : p.packs.includes(k)));
  return { ...p, packs };
}

// ---------------- дрон анкеты ----------------

/** Как выглядит дрон на шаге анкеты: что уже собрано по ответам. */
export interface DroneLook {
  quad: boolean;
  wing: boolean;
  /** размер рамы квадрика: 0.55 вуп … 1.15 7" */
  size: number;
  ducts: boolean;
  gps: boolean;
  antennas: boolean;
  camera: boolean;
  payload: boolean;
  /** винты крутятся — дрон «готов» */
  spin: boolean;
}

const SIZES: Partial<Record<CraftClass, number>> = { whoop: 0.55, cine: 0.8, quad5: 0.85, quad7: 1.15 };

/** step: 0 — опыт, 1 — на чём, 2 — что делать, 3 — дрон есть?, 4 — итог. */
export function droneLook(a: Partial<PilotAnswers>, step: number): DroneLook {
  const classes = a.classes ?? [];
  const goals = a.goals ?? [];
  const all = goals.includes("all");
  const has = (g: Goal) => all || goals.includes(g);
  const sizes = classes.map((c) => SIZES[c]).filter((x): x is number => x !== undefined);
  return {
    quad: step >= 1 && (a.craft === "quad" || a.craft === "both"),
    wing: step >= 1 && (a.craft === "wing" || a.craft === "both"),
    size: sizes.length ? Math.max(...sizes) : 0.85,
    ducts: classes.includes("whoop") || classes.includes("cine"),
    gps: has("longrange") || has("mapping") || has("work") || classes.includes("quad7"),
    antennas: has("longrange") || classes.includes("quad7"),
    camera: has("longrange") || has("mapping") || classes.includes("cine"),
    payload: has("work"),
    spin: step >= 4,
  };
}
