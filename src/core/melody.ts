// Мелодия по тумблеру MELODY (beeper_melody, прошивка — copter/Melody.h):
// разбор RTTTL ровно как на плате (те же ноты, длительности и ошибки), чтобы
// «послушать здесь» звучало так же, а ошибка была видна до записи на плату.

import { N_ } from "../i18n";

export const MELODY_TEXT_MAX = 128;
export const MELODY_NOTES_MAX = 64;
export const MELODY_DEFAULT = "openplane:d=8,o=6,b=150:c,e,g,4c7,p,g,2c7";

export interface MelodyNote {
  hz: number; // 0 — пауза
  ms: number;
  key: number; // MIDI (C4 = 60), у паузы 0
}

export type MelodyResult = { ok: true; notes: MelodyNote[] } | { ok: false; error: string; at: number };

// Частоты октавы 8 (C8..B8); ниже — делением на 2 с округлением, как на плате.
const OCTAVE8 = [4186, 4435, 4699, 4978, 5274, 5588, 5920, 6272, 6645, 7040, 7459, 7902];
const LETTER: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11, h: 11 };
const DURATIONS = [1, 2, 4, 8, 16, 32];

export function noteHz(semitone: number, octave: number): number {
  const shift = 8 - octave;
  return (OCTAVE8[semitone] + Math.floor((1 << shift) / 2)) >> shift;
}

/** RTTTL -> ноты; ошибка — текст (для t()) и номер символа с нуля. */
export function parseRtttl(text: string): MelodyResult {
  const s = text;
  const fail = (error: string, at: number): MelodyResult => ({ ok: false, error, at });
  const colons: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ":") continue;
    if (colons.length === 2) return fail(N_("больше двух двоеточий"), i);
    colons.push(i);
  }
  let defaults: [number, number] | null = null;
  let notesAt = 0;
  if (colons.length === 2) {
    defaults = [colons[0] + 1, colons[1]];
    notesAt = colons[1] + 1;
  } else if (colons.length === 1) {
    defaults = [0, colons[0]];
    notesAt = colons[0] + 1;
  }
  const isSpace = (c: string | undefined) => c === " " || c === "\t";
  const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";
  let p = 0;
  const skip = () => {
    while (isSpace(s[p])) p++;
  };
  const number = (): number | null => {
    let v = 0;
    let any = false;
    while (isDigit(s[p]) && v < 10000) {
      v = v * 10 + Number(s[p]);
      any = true;
      p++;
    }
    return any ? v : null;
  };

  let dur = 4,
    oct = 6,
    bpm = 63;
  if (defaults) {
    const [from, end] = defaults;
    p = from;
    while (p < end) {
      skip();
      if (p >= end) break;
      const key = s[p].toLowerCase();
      const at = p;
      p++;
      skip();
      if (s[p] !== "=") return fail(N_("в умолчаниях нужно d=, o=, b="), at);
      p++;
      skip();
      const v = number();
      if (v === null) return fail(N_("после = нужно число"), p);
      if (key === "d") {
        if (!DURATIONS.includes(v)) return fail(N_("d — 1, 2, 4, 8, 16 или 32"), at);
        dur = v;
      } else if (key === "o") {
        if (v < 3 || v > 8) return fail(N_("o — октава 3..8"), at);
        oct = v;
      } else if (key === "b") {
        if (v < 10 || v > 900) return fail(N_("b — темп 10..900"), at);
        bpm = v;
      } else return fail(N_("в умолчаниях бывают только d, o, b"), at);
      skip();
      if (p < end && s[p] !== ",") return fail(N_("умолчания — через запятую"), p);
      if (p < end) p++;
    }
  }

  const wholeMs = Math.floor(240000 / bpm);
  const notes: MelodyNote[] = [];
  p = notesAt;
  for (;;) {
    skip();
    if (p >= s.length) break;
    const at = p;
    if (notes.length >= MELODY_NOTES_MAX) return fail(N_("больше 64 нот"), at);
    let d = number();
    if (d === null) d = dur;
    else if (!DURATIONS.includes(d)) return fail(N_("длительность — 1, 2, 4, 8, 16 или 32"), at);
    const letter = (s[p] ?? "").toLowerCase();
    const pause = letter === "p";
    let semitone = pause ? 0 : (LETTER[letter] ?? -1);
    if (semitone < 0) return fail(N_("нота — c d e f g a b или p"), p);
    p++;
    if (s[p] === "#") {
      if (pause) return fail(N_("у паузы нет диеза"), p);
      semitone++;
      p++;
    }
    let dotted = false;
    if (s[p] === ".") {
      dotted = true;
      p++;
    }
    let o = number();
    if (o === null) o = oct;
    else if (o < 3 || o > 8) return fail(N_("октава 3..8"), at);
    if (s[p] === ".") {
      dotted = true;
      p++;
    }
    skip();
    if (p < s.length && s[p] !== ",") return fail(N_("ноты — через запятую"), p);
    if (s[p] === ",") p++;
    let ms = Math.floor(wholeMs / d);
    if (dotted) ms += Math.floor(ms / 2);
    ms = Math.min(ms, 60000);
    if (pause) {
      notes.push({ hz: 0, ms, key: 0 });
      continue;
    }
    if (semitone > 11) {
      semitone -= 12;
      o++;
    }
    if (o > 8) return fail(N_("выше B8 не бывает"), at);
    notes.push({ hz: noteHz(semitone, o), ms, key: 12 * (o + 1) + semitone });
  }
  if (notes.length === 0) return fail(N_("нет ни одной ноты"), p);
  return { ok: true, notes };
}

export const totalMs = (notes: MelodyNote[]) => notes.reduce((a, n) => a + n.ms, 0);

/** Тон маяка DShot 1..5 для ноты (как melodyBeaconTone на плате), пауза — 0. */
export function beaconTone(notes: MelodyNote[], n: MelodyNote): number {
  if (n.hz === 0) return 0;
  const keys = notes.filter((x) => x.hz > 0).map((x) => x.key);
  const lo = Math.min(...keys),
    hi = Math.max(...keys);
  if (hi <= lo) return 3;
  return 1 + Math.floor(((n.key - lo) * 8 + (hi - lo)) / (2 * (hi - lo)));
}

/** Тишина в конце ноты (чтобы одинаковые не сливались) — как на плате, мс. */
export function noteGapMs(ms: number): number {
  const left = Math.max(10, Math.ceil(ms / 10) * 10);
  return left >= 40 ? (left >= 160 ? 20 : 10) : 0;
}

/** Без пробелов — так строка уходит в `set` целиком. */
export const compactMelody = (text: string) => text.replace(/\s+/g, "");

export interface MelodyPreset {
  name: string;
  rtttl: string;
}

// Только свои и народные/старинные (общественное достояние).
export const MELODY_PRESETS: MelodyPreset[] = [
  { name: N_("OpenPlane"), rtttl: MELODY_DEFAULT },
  { name: N_("Гамма"), rtttl: "scale:d=8,o=5,b=180:c,d,e,f,g,a,b,c6" },
  { name: N_("Ода к радости"), rtttl: "ode:d=4,o=5,b=140:e,e,f,g,g,f,e,d,c,c,d,e,e.,8d,2d" },
  { name: N_("Мерцай, звёздочка"), rtttl: "twinkle:d=4,o=5,b=120:c,c,g,g,a,a,2g,f,f,e,e,d,d,2c" },
  { name: N_("Найди меня"), rtttl: "findme:d=16,o=7,b=200:c,p,c,p,c,4p,g6,p,g6,p,g6" },
];
