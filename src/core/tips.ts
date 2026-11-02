// Подсказки, которые растут вместе с пилотом (P06): каждый открытый журнал
// коптера оставляет короткую заметку (налёт, режимы, failsafe, GPS Rescue,
// ACRO TRAINER, просадка батареи, упор моторов), а по заметкам и профилю
// пилота — одна карточка с предложением. «Понятно» убирает её навсегда
// (подсказки про конкретный полёт — до следующего такого же полёта).

import { FLAG, Summary } from "./bbanalysis";
import { Flight } from "./blackbox";
import type { CopterTab } from "./copterParams";
import { guided, Pack, PilotProfile } from "./pilot";

const N_ = (s: string) => s;

export interface FlightNote {
  /** чтобы один полёт не считать дважды */
  key: string;
  armedS: number;
  modes: string[];
  failsafe: boolean;
  /** GPS Rescue включался (не только IDLE) */
  rescue: boolean;
  trainer: boolean;
  /** плата видела GPS */
  gps: boolean;
  /** наименьшее напряжение на банку в ARM, В */
  minCellV: number | null;
  /** доля времени в ARM, когда моторы упирались в предел */
  saturated: number | null;
}

export interface PilotLearn {
  notes: FlightNote[];
  dismissed: string[];
}

export const EMPTY_LEARN: PilotLearn = { notes: [], dismissed: [] };
const KEEP = 100;

/** Банок в батарее — по напряжению в начале записи (полная 4.2, хранение 3.8 В). */
export function cellsFrom(volts: number): number {
  return Math.max(1, Math.round(volts / 4.0));
}

export function noteFromFlight(f: Flight, s: Summary): FlightNote {
  const q = f.series.QSTATE;
  let minCellV: number | null = null;
  if (q && q.count && s.minVolts !== null) {
    let first = 0;
    for (let i = 0; i < q.count && !first; i++) if (q.cols.vbat_v[i] > 1) first = q.cols.vbat_v[i];
    if (first) minCellV = s.minVolts / cellsFrom(first);
  }
  let failsafe = f.events.some((e) => e.kind === "failsafe" && !/кончился/.test(e.text));
  if (q && !failsafe) for (let i = 0; i < q.count && !failsafe; i++) failsafe = (q.cols.flags[i] & FLAG.failsafe) !== 0;
  return {
    key: [f.info.start ?? "", f.info.uptime_ms ?? "", f.number, f.info.board ?? ""].join("|"),
    armedS: s.armedTime,
    modes: s.modes,
    failsafe,
    rescue: f.events.some((e) => /^GPS Rescue: (?!IDLE)/.test(e.text)),
    trainer: f.events.some((e) => e.text === "ACRO TRAINER: вкл"),
    gps: !!f.info["sensor.gps"] && f.info["sensor.gps"] !== "0" && f.info["sensor.gps"].toLowerCase() !== "none",
    minCellV,
    saturated: s.saturatedShare,
  };
}

export function addNote(l: PilotLearn, n: FlightNote): PilotLearn {
  if (l.notes.some((x) => x.key === n.key)) return l;
  return { ...l, notes: [...l.notes, n].slice(-KEEP) };
}

export function dismiss(l: PilotLearn, id: string): PilotLearn {
  return l.dismissed.includes(id) ? l : { ...l, dismissed: [...l.dismissed, id] };
}

export type TipAction = { kind: "tab"; tab: CopterTab; label: string } | { kind: "pack"; pack: Pack; label: string };

export interface Tip {
  /** для «Понятно»; у подсказок про полёт — с ключом полёта */
  id: string;
  title: string;
  text: string;
  /** подставляется в текст {v} */
  value?: string;
  action?: TipAction;
}

/** Налёт по заметкам, с. */
export const flownSeconds = (l: PilotLearn) => l.notes.reduce((a, n) => a + n.armedS, 0);

const SAG_CELL_V = 3.3;
const SATURATED = 0.15;

/** Одна, самая нужная сейчас подсказка (или null). */
export function pickTip(p: PilotProfile, l: PilotLearn): Tip | null {
  const last = l.notes[l.notes.length - 1];
  const flown = flownSeconds(l);
  const tips: Tip[] = [];
  if (last?.failsafe) {
    tips.push({
      id: `failsafe:${last.key}`,
      title: N_("В последнем полёте был FAILSAFE"),
      text: N_("Связь с пультом пропадала. Проверьте антенны приёмника и что делает коптер без связи."),
      action: { kind: "tab", tab: "failsafe", label: N_("Безопасность") },
    });
  }
  const sag = l.notes.slice(-3).filter((n) => n.minCellV !== null && n.minCellV < SAG_CELL_V);
  if (sag.length) {
    const worst = sag.reduce((a, n) => (n.minCellV! < a.minCellV! ? n : a));
    tips.push({
      id: `battery-sag:${worst.key}`,
      title: N_("Батарея проседает"),
      text: N_("Под газом было {v} В на банку — ниже 3.3 В батарея быстро стареет. Садитесь раньше, проверьте C батареи или замените старую."),
      value: worst.minCellV!.toFixed(2),
      action: { kind: "tab", tab: "power", label: N_("Питание") },
    });
  }
  if (l.notes.some((n) => n.gps) && !l.notes.some((n) => n.rescue)) {
    tips.push({
      id: "rescue-untested",
      title: N_("GPS Rescue ещё не проверен"),
      text: N_("GPS на борту есть, а возврат домой ни разу не включался. Проверьте его в поле на высоте и с запасом батареи, пока он не понадобился по-настоящему."),
      action: { kind: "tab", tab: "gps", label: N_("GPS") },
    });
  }
  if (guided(p.experience) && flown < 3 * 3600 && l.notes.some((n) => n.modes.includes("ACRO")) && !l.notes.some((n) => n.trainer)) {
    tips.push({
      id: "acro-trainer",
      title: N_("Учитесь ACRO? Есть тренер"),
      text: N_("Режим ACRO TRAINER не даёт наклониться сильнее заданного угла — коптер не перевернётся от лишнего движения стика. Поставьте его на тумблер."),
      action: { kind: "tab", tab: "modes", label: N_("Режимы") },
    });
  }
  const recent = l.notes.slice(-5).filter((n) => n.saturated !== null);
  if (flown >= 20 * 60 && recent.length >= 3 && recent.reduce((a, n) => a + n.saturated!, 0) / recent.length > SATURATED) {
    tips.push({
      id: "saturation",
      title: N_("Моторы часто упираются в предел"),
      text: N_("В последних полётах моторы больше {v} % времени работали на краю — коптеру не хватает запаса: фильтры пропускают шум или PID велики. Посмотрите спектр в журнале."),
      value: String(Math.round(SATURATED * 100)),
      action: { kind: "tab", tab: "filters", label: N_("Фильтры") },
    });
  }
  if (guided(p.experience) && flown >= 3600 && !p.packs.includes("freestyle") && !p.showAll) {
    tips.push({
      id: "pack-freestyle",
      title: N_("Час в воздухе!"),
      text: N_("Можно открыть больше: набор «Фристайл» — PID, расходы, фильтры, видео и OSD, чёрный ящик."),
      action: { kind: "pack", pack: "freestyle", label: N_("Включить «Фристайл»") },
    });
  }
  return tips.find((x) => !l.dismissed.includes(x.id)) ?? null;
}
