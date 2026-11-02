// типов Node в проекте нет — как в blackbox.test.ts
// @ts-ignore
import { readFileSync } from "node:fs";
// @ts-ignore
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { summarize } from "./bbanalysis";
import { decodeFlight } from "./blackbox";
import { makeProfile, PilotAnswers } from "./pilot";
import { addNote, cellsFrom, dismiss, EMPTY_LEARN, FlightNote, flownSeconds, noteFromFlight, PilotLearn, pickTip } from "./tips";

const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL("./__fixtures__/copter_flight_head.bbl", import.meta.url))));

const answers = (experience: PilotAnswers["experience"]): PilotAnswers => ({ experience, craft: "quad", classes: ["quad5"], goals: ["freestyle"], hasDrone: true });
const newbie = makeProfile({ ...answers("new"), goals: ["longrange"] });
const pro = makeProfile(answers("pro"));

let n = 0;
const note = (patch: Partial<FlightNote> = {}): FlightNote => ({
  key: `f${++n}`,
  armedS: 240,
  modes: ["ANGLE"],
  failsafe: false,
  rescue: false,
  trainer: false,
  gps: false,
  minCellV: 3.6,
  saturated: 0.02,
  ...patch,
});
const learn = (...notes: FlightNote[]): PilotLearn => notes.reduce(addNote, EMPTY_LEARN);

describe("подсказки по налёту (P06)", () => {
  it("заметка из настоящего журнала: налёт, режимы, банки", () => {
    const f = decodeFlight(bytes);
    const s = summarize(f);
    const x = noteFromFlight(f, s);
    expect(x.armedS).toBeCloseTo(s.armedTime);
    expect(x.modes).toEqual(s.modes);
    expect(x.key).toContain(String(f.number));
    if (s.minVolts !== null) expect(x.minCellV!).toBeGreaterThan(2.5);
    // один полёт дважды не считается
    const l = addNote(addNote(EMPTY_LEARN, x), x);
    expect(l.notes).toHaveLength(1);
  });

  it("банки по напряжению: 4S и 6S полные и на хранении", () => {
    expect(cellsFrom(16.8)).toBe(4);
    expect(cellsFrom(15.2)).toBe(4);
    expect(cellsFrom(25.2)).toBe(6);
    expect(cellsFrom(22.8)).toBe(6);
  });

  it("ничего не случилось — молчит", () => {
    expect(pickTip(newbie, EMPTY_LEARN)).toBeNull();
    expect(pickTip(newbie, learn(note(), note()))).toBeNull();
  });

  it("FAILSAFE в последнем полёте — первым; «Понятно» — до следующего такого", () => {
    const l = learn(note({ minCellV: 3.1 }), note({ failsafe: true, minCellV: 3.1 }));
    const tip = pickTip(pro, l)!;
    expect(tip.id).toMatch(/^failsafe:/);
    expect(tip.action).toMatchObject({ kind: "tab", tab: "failsafe" });
    // убрали — следующая по важности: просадка
    const next = pickTip(pro, dismiss(l, tip.id))!;
    expect(next.id).toMatch(/^battery-sag:/);
    expect(next.value).toBe("3.10");
    // новый failsafe — снова
    expect(pickTip(pro, addNote(dismiss(l, tip.id), note({ failsafe: true })))!.id).toMatch(/^failsafe:/);
  });

  it("GPS есть, возврата не было — проверить; был — тихо", () => {
    expect(pickTip(pro, learn(note({ gps: true })))!.id).toBe("rescue-untested");
    expect(pickTip(pro, learn(note({ gps: true }), note({ rescue: true })))).toBeNull();
  });

  it("новичок в ACRO без тренера — ACRO TRAINER; профи — нет", () => {
    const l = learn(note({ modes: ["ANGLE", "ACRO"] }));
    expect(pickTip(newbie, l)!.id).toBe("acro-trainer");
    expect(pickTip(pro, l)).toBeNull();
    expect(pickTip(newbie, addNote(l, note({ trainer: true })))).toBeNull();
  });

  it("моторы на краю после 20 минут налёта — фильтры", () => {
    const busy = Array.from({ length: 6 }, () => note({ saturated: 0.3 }));
    expect(flownSeconds(learn(...busy))).toBe(6 * 240);
    expect(pickTip(pro, learn(...busy))!.action).toMatchObject({ tab: "filters" });
    expect(pickTip(pro, learn(busy[0], busy[1], busy[2]))).toBeNull();   // 12 минут — рано
  });

  it("час в воздухе у новичка — открыть «Фристайл»", () => {
    const hour = Array.from({ length: 15 }, () => note());
    const tip = pickTip(newbie, learn(...hour))!;
    expect(tip.action).toMatchObject({ kind: "pack", pack: "freestyle" });
    expect(pickTip({ ...newbie, packs: [...newbie.packs, "freestyle"] }, learn(...hour))).toBeNull();
  });
});
