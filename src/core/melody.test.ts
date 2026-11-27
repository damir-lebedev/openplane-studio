import { describe, expect, it } from "vitest";

import { applyMessage, emptyBoard } from "./copterParams";
import { beaconTone, compactMelody, MELODY_DEFAULT, MELODY_PRESETS, MELODY_TEXT_MAX, noteGapMs, parseRtttl, totalMs } from "./melody";

describe("мелодия RTTTL — как на плате (copter/Melody.h)", () => {
  it("ноты, длительности, точка, диез, b#, h", () => {
    const r = parseRtttl("t:d=8,o=5,b=120:c,4e,g.,a#6,p,2c7,b#4,h");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notes.map((n) => n.hz)).toEqual([523, 659, 784, 1865, 0, 2093, 523, 988]);
    expect(r.notes.map((n) => n.ms)).toEqual([250, 500, 375, 250, 250, 1000, 250, 250]);
    expect(r.notes[0].key).toBe(72);
    expect(totalMs(r.notes)).toBe(3125);
  });

  it("без имени и умолчаний — d=4, o=6, b=63; пробелы и заглавные", () => {
    const a = parseRtttl("D=4,O=4,B=60: 8A4. , C");
    expect(a.ok && a.notes.map((n) => [n.hz, n.ms])).toEqual([
      [440, 750],
      [262, 1000],
    ]);
    const b = parseRtttl("a");
    expect(b.ok && b.notes[0]).toEqual({ hz: 1760, ms: 952, key: 93 });
  });

  it("ошибки — те же тексты и номер символа", () => {
    expect(parseRtttl("x:d=4,o=5,b=100:c,k,e")).toEqual({ ok: false, error: "нота — c d e f g a b или p", at: 18 });
    expect(parseRtttl("x:d=3:c")).toMatchObject({ ok: false, error: "d — 1, 2, 4, 8, 16 или 32" });
    expect(parseRtttl("x:o=5:c e")).toMatchObject({ ok: false, error: "ноты — через запятую" });
    expect(parseRtttl("x:d=4:")).toMatchObject({ ok: false, error: "нет ни одной ноты" });
    expect(parseRtttl("a:b:c:d").ok).toBe(false);
    expect(parseRtttl("x:o=5:c9").ok).toBe(false);
    expect(parseRtttl("x:d=32:c" + ",c".repeat(64))).toMatchObject({ ok: false, error: "больше 64 нот" });
  });

  it("тоны маяка 1..5 и промежуток в конце ноты", () => {
    const r = parseRtttl("x:o=5:c,e,g,c6,p");
    if (!r.ok) throw new Error();
    expect(r.notes.map((n) => beaconTone(r.notes, n))).toEqual([1, 2, 3, 5, 0]);
    expect(noteGapMs(100)).toBe(10);
    expect(noteGapMs(250)).toBe(20);
    expect(noteGapMs(30)).toBe(0);
  });

  it("заготовки разбираются и помещаются в 128 символов", () => {
    for (const p of MELODY_PRESETS) {
      expect(parseRtttl(p.rtttl).ok).toBe(true);
      expect(compactMelody(p.rtttl).length).toBeLessThanOrEqual(MELODY_TEXT_MAX);
    }
    expect(MELODY_PRESETS[0].rtttl).toBe(MELODY_DEFAULT);
    expect(compactMelody(" a : d=4 : c ")).toBe("a:d=4:c");
  });

  it("ошибка «сыграть на плате» гаснет ответом @melody", () => {
    let b = applyMessage(emptyBoard(), "error", { cmd: "melody", error: "только без ARM" });
    expect(b.errors.melody).toBe("только без ARM");
    b = applyMessage(b, "melody", { ok: true, playing: true });
    expect(b.errors.melody).toBeUndefined();
  });
});
