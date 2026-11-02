import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { makeProfile } from "./pilot";
import { trainingCommands, trainingNotes, trainingOf, trainingPresetOf, trainingRecommended, TRAINING_PRESETS } from "./training";

const safety = (name: string, value: number | string, type: "int" | "enum" = "int") =>
  param(name, { group: "safety", scope: "master", type, value, default: value, options: type === "enum" ? ["OFF", "ON"] : undefined });

const board = (on: string, alt = 50, dist = 150, angle = 30, speed = 40) =>
  dumpedBoard([
    safety("training_limits", on, "enum"),
    safety("training_max_alt", alt),
    safety("training_max_dist", dist),
    safety("training_max_angle", angle),
    safety("training_max_speed", speed),
    param("gps_rescue_min_start_dist", { group: "gps", scope: "master", value: 15 }),
  ]);

const live = (patch: Partial<CopterLive> = {}) => ({ alt: 0, ...patch }) as CopterLive;

describe("учебные ограничения", () => {
  it("с платы: включены ли и пределы; старая прошивка — null", () => {
    expect(trainingOf(board("ON"))).toEqual({ on: true, alt: 50, dist: 150, angle: 30, speed: 40 });
    expect(trainingOf(dumpedBoard([param("p_roll")]))).toBeNull();
  });

  it("рекомендуем новичку, из симулятора и школе, а не пилоту", () => {
    const p = (experience: "new" | "sim" | "flying", goals: ("freestyle" | "school")[] = []) =>
      makeProfile({ experience, craft: "quad", classes: [], goals, hasDrone: null });
    expect(trainingRecommended(p("new"))).toBe(true);
    expect(trainingRecommended(p("sim"))).toBe(true);
    expect(trainingRecommended(p("flying"))).toBe(false);
    expect(trainingRecommended(p("flying", ["school"]))).toBe(true);
  });

  it("наборы: «Площадка» — как прошивка из коробки; свои числа — null", () => {
    expect(trainingPresetOf(trainingOf(board("ON"))!)).toBe("park");
    expect(trainingPresetOf(trainingOf(board("ON", 30, 80, 25, 30))!)).toBe("first");
    expect(trainingPresetOf(trainingOf(board("ON", 33))!)).toBeNull();
    expect(TRAINING_PRESETS.find((x) => x.id === "park")!.values).toEqual({ alt: 50, dist: 150, angle: 30, speed: 40 });
  });

  it("команды: включить с набором, выключить одной", () => {
    expect(trainingCommands(true, TRAINING_PRESETS[0].values)).toEqual([
      ["training_limits", "ON"],
      ["training_max_alt", 30],
      ["training_max_dist", 80],
      ["training_max_angle", 25],
      ["training_max_speed", 30],
    ]);
    expect(trainingCommands(false)).toEqual([["training_limits", "OFF"]]);
  });

  it("подсказки: без GPS круга нет, маленький круг, выключены — молчим", () => {
    const b = board("ON");
    expect(trainingNotes(trainingOf(b)!, b, live()).some((n) => n.warn && n.text.includes("GPS не виден"))).toBe(true);
    const withGps = live({ gps: { fix: true, sats: 10, lat: 0, lon: 0, spd: 0 } });
    expect(trainingNotes(trainingOf(b)!, b, withGps).some((n) => n.text.includes("дом ставится"))).toBe(true);
    const small = board("ON", 50, 25);
    expect(trainingNotes(trainingOf(small)!, small, withGps).some((n) => n.warn && n.text.includes("min_start_dist"))).toBe(true);
    const off = board("OFF");
    expect(trainingNotes(trainingOf(off)!, off, live())).toEqual([]);
  });
});
