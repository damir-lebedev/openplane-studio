import { describe, expect, it } from "vitest";

import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import {
  applyMessage,
  checkValue,
  CopterParam,
  emptyBoard,
  FLIGHT_SLIDERS,
  flightSliders,
  marginLevel,
  parseBfDiff,
  rateAt,
  rateCurve,
  RatesType,
  RATES_TYPES,
  convertRates,
  throttleAt,
  rcAutoCutoff,
  rcStepResponse,
  rescuePath,
  sliderCommands,
  sliderText,
  sliderValue,
  tabParams,
  yawSpinThreshold,
} from "./copterParams";

describe("настройки коптера с платы", () => {
  it("флеш настроек: из заголовка, save обновляет «занято»", () => {
    const b = applyMessage(emptyBoard(), "params", { count: 1, profiles: 4, profile: 0, rateprofile: 0, build: "", source: "MODEL", unsaved: false, flash: [300, 8192] });
    expect(b.header?.flash).toEqual([300, 8192]);
    const s = applyMessage(b, "save", { ok: true, stored: true, flash: [3100, 8192] });
    expect(s.header?.flash).toEqual([3100, 8192]);
    expect(s.unsaved).toBe(false);
  });

  it("дамп: заголовок, настройки по порядку, @rc, конец — по @modes", () => {
    const b = dumpedBoard([param("p_roll"), param("serialrx_provider", { type: "enum", group: "receiver", scope: "master", options: ["IBUS", "SBUS", "CRSF"], value: "CRSF", default: "CRSF" })]);
    expect(b.loading).toBe(false);
    expect(b.loadedAt).toBe(123);
    expect(b.order).toEqual(["p_roll", "serialrx_provider"]);
    expect(b.unsaved).toBe(false);   // @rc во время дампа — не правка
    expect(b.rc?.usingFallback).toBe(true);
    expect(tabParams(b, "receiver").map((p) => p.name)).toEqual(["serialrx_provider"]);
    expect(tabParams(b, "pid", ["p_roll"])).toEqual([]);
  });

  it("set: ок — новое значение в активном профиле, ошибка — текст у настройки", () => {
    let b = dumpedBoard([param("p_roll")]);
    b = { ...b, pending: { p_roll: 47 } };
    b = applyMessage(b, "set", { name: "p_roll", ok: true, value: 47 });
    expect(b.params.p_roll.value).toBe(47);
    expect(b.params.p_roll.set).toBe(true);
    expect(b.params.p_roll.profiles).toEqual([47, 40, 40, 40]);
    expect(b.pending).toEqual({});
    expect(b.unsaved).toBe(true);
    b = applyMessage(b, "set", { name: "p_roll", ok: false, error: "допустимо 0 - 250", value: 47 });
    expect(b.errors.p_roll).toBe("допустимо 0 - 250");
    expect(b.edited).toEqual(["p_roll"]);   // P65: ошибка не добавляет, повтор не дублирует
    b = applyMessage(b, "set", { name: "p_roll", ok: true, value: 48 });
    expect(b.edited).toEqual(["p_roll"]);
    b = applyMessage(b, "save", { ok: true, stored: true }, 5000);
    expect(b.unsaved).toBe(false);
    expect(b.errors).toEqual({});
    expect(b.edited).toEqual([]);
    expect(b.savedAt).toBe(5000);
    b = applyMessage(b, "rc", { ...b.rc!, aux: [[0, 0, 0, 1700, 2100, 0, 0]], usingFallback: false });
    expect(b.unsaved).toBe(true);   // aux после дампа — правка
    b = applyMessage(b, "motor", { ok: true, max: 30, m: [10, 0, 0, 0] });
    expect(b.motorTest).toEqual([10, 0, 0, 0]);
  });

  it("проверка ввода по границам и типу", () => {
    const p = param("p_roll");
    expect(checkValue(p, 47)).toBeNull();
    expect(checkValue(p, 300)).toBe("не больше 250");
    expect(checkValue(p, 4.5)).toBe("нужно целое");
    expect(checkValue(p, "abc")).toBe("нужно число");
    expect(checkValue(param("x", { type: "enum", options: ["OFF", "ON"] }), "ON")).toBeNull();
    expect(checkValue(param("x", { type: "enum", options: ["OFF", "ON"] }), "MAYBE")).toBe("нет такого значения");
    expect(checkValue(param("n", { type: "string", maxlen: 4 }), "ABCDE")).toBe("не длиннее 4");
  });

  it("пять формул rates_type — точки как в прошивке (test_rates_types)", () => {
    const s = (type: RatesType, rc: number, srate: number, expo: number, limit = 1998) => ({ type, rc, srate, expo, limit });
    expect(rateCurve(s("BETAFLIGHT", 100, 70, 0), 1)).toBeCloseTo(666.67, 1);
    expect(rateCurve(s("BETAFLIGHT", 100, 70, 0), 0.5)).toBeCloseTo(153.85, 1);
    expect(rateCurve(s("RACEFLIGHT", 37, 80, 50), 0.5)).toBeCloseTo(161.875, 2);
    expect(rateCurve(s("KISS", 100, 70, 0), 1)).toBeCloseTo(666.67, 1);
    expect(rateCurve(s("ACTUAL", 7, 67, 50), 0.5)).toBeCloseTo(114.6875, 3);
    expect(rateCurve(s("QUICK", 100, 67, 0), 1)).toBeCloseTo(670, 1);
    expect(rateCurve(s("BETAFLIGHT", 100, 99, 0), 1)).toBe(1998);
    expect(rateCurve(s("BETAFLIGHT", 100, 99, 0, 800), -1)).toBe(-800);
  });

  it("смена формулы: стик ощущается так же", () => {
    const from = { type: "ACTUAL" as RatesType, rc: 20, srate: 67, expo: 50, limit: 1998 };
    for (const to of RATES_TYPES) {
      const v = convertRates(from, to);
      const c = { type: to, ...v, limit: 1998 };
      expect(Math.abs(rateCurve(c, 1) - 670)).toBeLessThan(25);
      expect(Math.abs(rateCurve(c, 0.5) - rateCurve(from, 0.5))).toBeLessThan(40);
    }
  });

  it("кривая газа thr_mid / thr_expo и предел", () => {
    expect(throttleAt(50, 0, "OFF", 100, 0.37)).toBeCloseTo(0.37, 6);
    expect(throttleAt(30, 50, "OFF", 100, 0.5)).toBeCloseTo(0.408163, 5);
    expect(throttleAt(30, 50, "OFF", 100, 0.3)).toBeCloseTo(0.3, 6);
    expect(throttleAt(50, 0, "SCALE", 80, 0.5)).toBeCloseTo(0.4, 6);
    expect(throttleAt(50, 0, "CLIP", 80, 1)).toBeCloseTo(0.8, 6);
  });

  it("кривая расходов как в прошивке (Presets.h RateCurve)", () => {
    expect(rateAt(20, 67, 50, 0)).toBe(0);
    expect(rateAt(20, 67, 50, 1)).toBeCloseTo(670, 6);
    expect(rateAt(20, 67, 50, -1)).toBeCloseTo(-670, 6);
    // у центра наклон — «центр»
    expect(rateAt(20, 67, 50, 0.001) / 0.001).toBeCloseTo(200, 0);
    // максимум меньше центра — прямая
    expect(rateAt(30, 10, 0, 1)).toBeCloseTo(300, 6);
  });

  it("diff all из Betaflight: понятное — строками, железо и незнакомое — отдельно", () => {
    const params = { p_roll: param("p_roll"), vtx_band: param("vtx_band", { group: "vtx" }), craft_name: param("craft_name", { group: "other", type: "string" }) };
    const dump = [
      "### version",
      "# Betaflight / STM32F405 (S405) 4.5.1",
      "### diff all",
      "# version",
      "batch start",
      "board_name GETFUNF405V3",
      "resource MOTOR 1 B00",
      "feature -RX_PARALLEL_PWM",
      "serial 1 64 115200 57600 0 115200",
      "aux 0 0 0 1700 2100 0 0",
      "map TAER1234",
      "set vtx_band = 5",
      "set craft_name = Q7",
      "set gyro_1_spibus = 1",
      "profile 0",
      "set p_roll = 52",
      "rateprofile 0",
      "batch end",
      "save",
    ].join("\n");
    const { lines, unknown } = parseBfDiff(dump, params);
    expect(lines.map((l) => l.line)).toEqual(["aux 0 0 0 1700 2100 0 0", "map TAER1234", "set vtx_band 5", "set craft_name Q7", "profile 0", "set p_roll 52", "rateprofile 0"]);
    expect(lines.find((l) => l.name === "p_roll")?.group).toBe("pid");
    expect(unknown).toEqual(["resource MOTOR 1 B00", "feature -RX_PARALLEL_PWM", "serial 1 64 115200 57600 0 115200", "set gyro_1_spibus = 1"]);
    // просто вставленный diff (без заголовков ###) — тоже
    expect(parseBfDiff("set p_roll = 50", params).lines).toHaveLength(1);
  });
});

describe("GPS Rescue: профиль возврата", () => {
  const board = (vals: Record<string, string | number>) => {
    const b = emptyBoard();
    for (const [name, value] of Object.entries(vals)) b.params[name] = { name, value } as unknown as CopterParam;
    return b;
  };

  it("MAX_ALT: наибольшая высота + initial_climb, снижение с descent_dist", () => {
    const p = rescuePath(board({}), 300, 20, 35);
    expect(p.ret).toBe(45);
    expect(p.descent).toBe(20);
    expect(p.tooClose).toBe(false);
    // набор 25 м по 7.5 м/с + 280 м по 7.5 м/с + снижение 20 м вдвое медленнее + 4 м по 0.75 м/с
    expect(p.seconds).toBeCloseTo(25 / 7.5 + 280 / 7.5 + 40 / 7.5 + 4 / 0.75, 5);
  });

  it("FIXED_ALT и CURRENT_ALT", () => {
    expect(rescuePath(board({ gps_rescue_alt_mode: "FIXED_ALT", gps_rescue_return_alt: 60 }), 300, 20, 35).ret).toBe(60);
    expect(rescuePath(board({ gps_rescue_alt_mode: "CURRENT_ALT" }), 300, 20, 35).ret).toBe(30);
  });

  it("ближе min_start_dist — посадка на месте", () => {
    const p = rescuePath(board({}), 10, 10, 10);
    expect(p.tooClose).toBe(true);
    expect(p.seconds).toBeCloseTo(6 / 1.5 + 4 / 0.75, 5);
  });
});

describe("сглаживание стиков", () => {
  it("срез — как в прошивке: кадры × 1.5 / (1 + factor/10), не ниже 15 Гц", () => {
    expect(rcAutoCutoff(250, 30)).toBeCloseTo(93.75, 5);
    expect(rcAutoCutoff(50, 30)).toBeCloseTo(18.75, 5);
    expect(rcAutoCutoff(20, 30)).toBe(15);
  });

  it("ступеньки кадров и плавная кривая: без фильтра — как пришло, с фильтром — догоняет позже", () => {
    const raw = rcStepResponse(250, 0);
    expect(raw.every((p) => p.smooth === p.raw)).toBe(true);
    const sm = rcStepResponse(250, 94);
    const at10 = sm.find((p) => p.t >= 10)!;
    expect(at10.smooth).toBeLessThan(at10.raw);
    expect(sm[sm.length - 1].smooth).toBeGreaterThan(0.98);
  });
});

describe("ползунки «Настройки полёта» и запас устойчивости", () => {
  const board = () =>
    dumpedBoard([
      param("simplified_pids_mode", { type: "enum", options: ["OFF", "RP", "RPY"], default: "RPY", value: "OFF" }),
      param("simplified_master_multiplier", { default: 100, value: 100, max: 200 }),
      param("simplified_feedforward_gain", { default: 100, value: 100, max: 200 }),
      param("simplified_gyro_filter", { type: "enum", options: ["OFF", "ON"], default: "ON", value: "OFF" }),
      param("simplified_gyro_filter_multiplier", { default: 100, value: 100, min: 10, max: 200 }),
      param("simplified_dterm_filter", { type: "enum", options: ["OFF", "ON"], default: "ON", value: "ON" }),
      param("simplified_dterm_filter_multiplier", { default: 100, value: 100, min: 10, max: 200 }),
      ...["roll", "pitch", "yaw"].flatMap((a) => [param(`${a}_rc_rate`, { value: 30 }), param(`${a}_srate`, { value: a === "yaw" ? 50 : 60 }), param(`${a}_expo`, { value: 40 })]),
    ]);

  it("выключенные ползунки прошивки включаются; плавность — обратный FF", () => {
    const b = board();
    expect(sliderCommands(b, "response", 120)).toEqual([["simplified_pids_mode", "RPY"], ["simplified_master_multiplier", 120]]);
    expect(sliderValue(b, "smooth")).toBe(50);
    expect(sliderCommands(b, "smooth", 80)).toEqual([["simplified_pids_mode", "RPY"], ["simplified_feedforward_gain", 70]]);
    expect(sliderCommands(b, "filters", 80)).toEqual([
      ["simplified_gyro_filter", "ON"],
      ["simplified_gyro_filter_multiplier", 80],
      ["simplified_dterm_filter_multiplier", 80],
    ]);
  });

  it("скорость: центр не выше максимума, рысканье в той же доле", () => {
    const b = board();
    expect(sliderValue(b, "speed")).toBe(600);
    expect(sliderCommands(b, "speed", 250)).toEqual([
      ["roll_srate", 25],
      ["roll_rc_rate", 25],
      ["pitch_srate", 25],
      ["pitch_rc_rate", 25],
      ["yaw_srate", 21],
      ["yaw_rc_rate", 21],
    ]);
    expect(flightSliders(b).map((s) => s.id)).toEqual(["response", "smooth", "filters", "speed", "center"]);   // angle_limit нет — и ползунка нет
    expect(sliderText(FLIGHT_SLIDERS[0], 120)).toBe("×1.20");
  });

  it("запас из @set и @save — в заголовок; уровни", () => {
    let b = board();
    b = applyMessage(b, "set", { name: "simplified_master_multiplier", ok: true, value: 150, margin: { gm: 8.1, pm: 44, hz: 25, min: 6 } });
    expect(b.header?.margin?.gm).toBe(8.1);
    expect(marginLevel(b.header!.margin!)).toBe("warn");
    b = applyMessage(b, "save", { ok: true, stored: true, margin: { gm: 12, pm: 50, hz: 20, min: 6 } });
    expect(marginLevel(b.header!.margin!)).toBe("ok");
    expect(marginLevel({ gm: 5.9, pm: 30, hz: 30, min: 6 })).toBe("bad");
  });
});

describe("yaw spin recovery", () => {
  const board = (mode: string, extra: Record<string, number> = {}) =>
    dumpedBoard([
      param("rates_type", { type: "enum", scope: "rate", value: "ACTUAL" }),
      param("yaw_rc_rate", { scope: "rate", value: 20 }),
      param("yaw_srate", { scope: "rate", value: extra.srate ?? 67 }),
      param("yaw_expo", { scope: "rate", value: 0 }),
      param("yaw_spin_recovery", { type: "enum", scope: "master", value: mode }),
      param("yaw_spin_threshold", { scope: "master", value: extra.threshold ?? 1950 }),
    ]);
  it("AUTO — рейт рысканья ×1.25 + 200, в пределах 500…1950", () => {
    expect(yawSpinThreshold(board("AUTO"))).toBe(1038);
    expect(yawSpinThreshold(board("AUTO", { srate: 180 }))).toBe(1950);
    expect(yawSpinThreshold(board("AUTO", { srate: 20 }))).toBe(500);
  });
  it("ON — своё число, OFF — нет защиты", () => {
    expect(yawSpinThreshold(board("ON", { threshold: 1200 }))).toBe(1200);
    expect(yawSpinThreshold(board("OFF"))).toBeNull();
  });
});
