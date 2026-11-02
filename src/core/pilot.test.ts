import { describe, expect, it } from "vitest";

import { copterTabs, droneLook, makeProfile, needsOnboarding, packsFor, PilotAnswers, profileOf, sectionVisible, skippedProfile, tabPack, togglePack } from "./pilot";

const answers = (patch: Partial<PilotAnswers> = {}): PilotAnswers => ({
  experience: "new",
  craft: "quad",
  classes: [],
  goals: [],
  hasDrone: null,
  ...patch,
});
const ids = (p: ReturnType<typeof makeProfile>) => copterTabs(p).map((x) => x.id);

describe("наборы по ответам", () => {
  it("«Основа» всегда, ничего не выбрал — только она", () => {
    expect(packsFor(answers())).toEqual(["base"]);
  });

  it("дела → наборы; доставка — ещё и флот; картография — работа", () => {
    expect(packsFor(answers({ goals: ["freestyle", "race"] }))).toEqual(["base", "freestyle", "race"]);
    expect(packsFor(answers({ goals: ["work"] }))).toEqual(["base", "work", "fleet"]);
    expect(packsFor(answers({ goals: ["mapping"] }))).toEqual(["base", "work"]);
  });

  it("крылья и VTOL включают «Крылья», 7\" и сине — «Съёмку и дальние»", () => {
    expect(packsFor(answers({ craft: "wing" }))).toContain("wing");
    expect(packsFor(answers({ craft: "both" }))).toContain("wing");
    expect(packsFor(answers({ craft: "quad", classes: ["quad7"] }))).toEqual(["base", "longrange"]);
    expect(packsFor(answers({ classes: ["cine"] }))).toContain("longrange");
  });

  it("инструктор — «Школа»; профи и «всё и сразу» — все девять", () => {
    expect(packsFor(answers({ experience: "instructor" }))).toContain("school");
    expect(packsFor(answers({ experience: "pro" }))).toHaveLength(9);
    expect(packsFor(answers({ goals: ["all"] }))).toHaveLength(9);
  });
});

describe("что видно", () => {
  it("новичок: мастер, ползунки и «Что подключено», без вкладок «Основы»", () => {
    expect(ids(makeProfile(answers()))).toEqual(["wizard", "flight", "parts"]);
  });

  it("новичок с «Гонками»: мастер плюс гоночные вкладки", () => {
    const tabs = ids(makeProfile(answers({ goals: ["race"] })));
    expect(tabs.slice(0, 2)).toEqual(["wizard", "flight"]);
    expect(tabs).toContain("pid");
    expect(tabs).not.toContain("motors");
    expect(tabs).not.toContain("cli");
  });

  it("летает: «Основа» без мастера; профи — всё, кроме вкладок новичка", () => {
    const flying = ids(makeProfile(answers({ experience: "flying" })));
    expect(flying).toEqual(["overview", "parts", "frombf", "setup", "receiver", "modes", "motors", "failsafe", "power", "beeper"]);
    const pro = ids(makeProfile(answers({ experience: "pro" })));
    expect(pro).toContain("cli");
    expect(pro).not.toContain("wizard");
  });

  it("«Показать всё» — все 21 вкладка, мастер первым", () => {
    const all = ids({ ...makeProfile(answers()), showAll: true });
    expect(all).toHaveLength(21);
    expect(all[0]).toBe("wizard");
  });

  it("разделы слева: «Плата» самолёта — у крыльев, «Грузы» — у флота", () => {
    const quad = makeProfile(answers());
    expect(sectionVisible(quad, "board")).toBe(false);
    expect(sectionVisible(quad, "cargo")).toBe(false);
    expect(sectionVisible(quad, "hangar")).toBe(true);
    expect(sectionVisible(makeProfile(answers({ craft: "wing" })), "board")).toBe(true);
    expect(sectionVisible({ ...quad, showAll: true }, "cargo")).toBe(true);
  });

  it("набор вкладки — для поиска; новичковые — без набора", () => {
    expect(tabPack("pid")).toBe("freestyle");
    expect(tabPack("gps")).toBe("longrange");
    expect(tabPack("motors")).toBe("base");
    expect(tabPack("wizard")).toBeNull();
  });

  it("набор включается и выключается, «Основа» — никогда", () => {
    const p = makeProfile(answers());
    const on = togglePack(p, "race");
    expect(on.packs).toEqual(["base", "race"]);
    expect(togglePack(on, "race").packs).toEqual(["base"]);
    expect(togglePack(p, "base").packs).toEqual(["base"]);
  });
});

describe("переход с «Новичок/Профи» без потерь", () => {
  it("анкеты не было: показать её; до ответа — прежний вид", () => {
    expect(needsOnboarding({})).toBe(true);
    expect(needsOnboarding({ copterMode: "pro" })).toBe(true);
    expect(profileOf({ copterMode: "pro" }).showAll).toBe(true);
    expect(ids(profileOf({ copterMode: "beginner" }))).toEqual(["wizard", "flight", "parts"]);
    // самолёты, которыми уже пользовались, не пропадают
    expect(sectionVisible(profileOf({}), "board")).toBe(true);
  });

  it("пропустили — анкета больше не появляется сама", () => {
    expect(needsOnboarding({ pilot: skippedProfile() })).toBe(false);
  });
});

describe("дрон анкеты собирается по ответам", () => {
  it("сначала одна плата, потом рама", () => {
    const zero = droneLook({ craft: "quad" }, 0);
    expect(zero.quad || zero.wing).toBe(false);
    expect(droneLook({ craft: "quad" }, 1).quad).toBe(true);
    const both = droneLook({ craft: "both" }, 1);
    expect(both.quad && both.wing).toBe(true);
  });

  it("размер и защита — по классу, обвес — по делам, винты — в итоге", () => {
    expect(droneLook({ craft: "quad", classes: ["whoop"] }, 1)).toMatchObject({ size: 0.55, ducts: true });
    expect(droneLook({ craft: "quad", classes: ["whoop", "quad7"] }, 1)).toMatchObject({ size: 1.15, gps: true, antennas: true });
    expect(droneLook({ craft: "quad", goals: ["work"] }, 2)).toMatchObject({ payload: true, gps: true, camera: false });
    expect(droneLook({ craft: "quad", goals: ["all"] }, 2)).toMatchObject({ payload: true, camera: true });
    expect(droneLook({ craft: "quad" }, 3).spin).toBe(false);
    expect(droneLook({ craft: "quad" }, 4).spin).toBe(true);
  });
});
