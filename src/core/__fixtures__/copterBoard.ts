// Настройки коптера, как их присылает прошивка на "params", — для тестов.

import { applyMessage, CopterBoard, CopterParam, emptyBoard } from "../copterParams";

export function param(name: string, patch: Partial<CopterParam> = {}): CopterParam {
  return {
    name,
    type: "int",
    group: "pid",
    scope: "pid",
    min: 0,
    max: 250,
    default: 40,
    from: "tune",
    units: "",
    text: name,
    value: 40,
    set: false,
    profiles: [40, 40, 40, 40],
    ...patch,
  };
}

/** Дамп платы, как его присылает прошивка на "params". */
export function dumpedBoard(params: CopterParam[]): CopterBoard {
  let b = applyMessage(emptyBoard(), "params", {
    count: params.length,
    profiles: 4,
    profile: 0,
    rateprofile: 0,
    build: "longrange7li",
    source: "MODEL",
    unsaved: false,
    frame: { type: "Quad X", motors: [[-0.71, 0.71, "cw", false], [0.71, 0.71, "ccw", false], [-0.71, -0.71, "ccw", false], [0.71, -0.71, "cw", false]] },
    motorTestMax: 30,
  });
  for (const p of params) b = applyMessage(b, "param", p);
  b = applyMessage(b, "rc", { map: "AETR1234", channels: 12, rxrange: [[1000, 2000], [1000, 2000], [1000, 2000], [1000, 2000]], aux: [], fallback: [[0, 0, 0, 1700, 2100, 0, 0], [1, 1, 1, 900, 1300, 0, 0]], usingFallback: true, vtx: [], rxfail: [] });
  return applyMessage(b, "modes", [[0, "ARM", true], [1, "ANGLE", true], [2, "HORIZON", true], [13, "BEEPER", true]], 123);
}
