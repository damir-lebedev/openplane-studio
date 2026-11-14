import { describe, expect, it } from "vitest";

import type { CopterLive } from "../api";
import { dumpedBoard, param } from "./__fixtures__/copterBoard";
import { applyMessage, osdElements, osdPos, osdVisible, osdX, osdY } from "./copterParams";
import {
  OSD_SYSTEMS,
  osdCanvasNow,
  osdLayoutCanvas,
  osdLinkNotes,
  osdOutputSupported,
  osdOutside,
  osdRemap,
  osdRemapAll,
  osdRemapOffer,
  osdSystemOf,
  osdSystemSettings,
} from "./osdCanvas";

const osd = (name: string, value: number) => param(name, { group: "osd", scope: "master", default: value, value, min: 0, max: 16383 });
const en = (name: string, options: string[], value: string) => param(name, { type: "enum", group: "osd", scope: "master", options, default: value, value });

/** Плата с раскладкой по умолчанию из прошивки (copter/Osd.h) и настройками вывода. */
function board(extra: Record<string, string | number> = {}) {
  const b = dumpedBoard([
    osd("osd_link_quality_pos", osdPos(1, 0)),
    osd("osd_flymode_pos", osdPos(13, 0)),
    osd("osd_gps_sats_pos", osdPos(24, 0)),
    osd("osd_crosshairs_pos", osdPos(14, 6)),
    osd("osd_warnings_pos", osdPos(9, 9)),
    osd("osd_vbat_pos", osdPos(1, 12)),
    osd("osd_tim_2_pos", osdPos(22, 12)),
    osd("osd_throttle_pos", osdPos(1, 2, 0)),
    en("osd_displayport_device", ["NONE", "AUTO", "MAX7456", "MSP"], "AUTO"),
    en("vcd_video_system", ["AUTO", "PAL", "NTSC", "HD"], "AUTO"),
    param("osd_canvas_width", { group: "osd", scope: "master", min: 30, max: 60, default: 53, value: 53 }),
    param("osd_canvas_height", { group: "osd", scope: "master", min: 13, max: 22, default: 20, value: 20 }),
  ]);
  let out = b;
  for (const [name, value] of Object.entries(extra)) out = applyMessage(out, "param", { ...out.params[name], value });
  return out;
}

const WIDTHS: Record<string, number> = { link_quality: 4, flymode: 4, gps_sats: 4, crosshairs: 1, warnings: 12, vbat: 5, tim_2: 6, throttle: 3 };
const width = (key: string) => WIDTHS[key] ?? 4;

const live = (osdPart: CopterLive["osd"]): CopterLive => ({ osd: osdPart }) as CopterLive;
const SD = { cols: 30, rows: 13, hd: false };
const PAL = { cols: 30, rows: 16, hd: false };
const HD = { cols: 53, rows: 20, hd: true };

describe("экран OSD", () => {
  it("наборы под видеосистемы: что выставлено и что отправить", () => {
    const b = board();
    expect(osdOutputSupported(b)).toBe(true);
    expect(osdOutputSupported(dumpedBoard([osd("osd_vbat_pos", 2433)]))).toBe(false);
    expect(osdSystemOf(b)?.id).toBe("auto");
    const hdzero = OSD_SYSTEMS.find((s) => s.id === "hdzero")!;
    expect(osdSystemSettings(b, hdzero)).toEqual([
      { name: "osd_displayport_device", value: "MSP" },
      { name: "vcd_video_system", value: "HD" },
      { name: "osd_canvas_width", value: 50 },
      { name: "osd_canvas_height", value: 18 },
    ]);
    // DJI O3 и Walksnail — 53 × 20: размер уже такой, шлём только устройство и HD
    const hd53 = OSD_SYSTEMS.find((s) => s.id === "hd53")!;
    expect(osdSystemSettings(b, hd53).map((c) => c.name)).toEqual(["osd_displayport_device", "vcd_video_system"]);
    const set = board({ osd_displayport_device: "MSP", vcd_video_system: "HD" });
    expect(osdSystemOf(set)?.id).toBe("hd53");
    expect(osdSystemSettings(set, hd53)).toEqual([]);
    expect(osdSystemOf(board({ osd_displayport_device: "MSP", vcd_video_system: "HD", osd_canvas_width: 60, osd_canvas_height: 22 }))?.id).toBe("wtfos");
    expect(osdSystemOf(board({ osd_displayport_device: "MAX7456" }))?.id).toBe("analog");
    // своё сочетание — ни один набор
    expect(osdSystemOf(board({ osd_displayport_device: "MSP", vcd_video_system: "HD", osd_canvas_width: 40 }))).toBeNull();
    expect(osdSystemOf(board({ osd_displayport_device: "NONE" }))).toBeNull();
    // назад в аналог: размер экрана очков не трогаем
    expect(osdSystemSettings(set, OSD_SYSTEMS.find((s) => s.id === "analog")!)).toEqual([
      { name: "osd_displayport_device", value: "MAX7456" },
      { name: "vcd_video_system", value: "AUTO" },
    ]);
  });

  it("какой экран сейчас: очки главнее настроек, настройки — камеры, камера — переключателя", () => {
    const b = board();
    expect(osdCanvasNow(b, null, true)).toEqual({ canvas: PAL, source: "manual" });
    expect(osdCanvasNow(b, null, false)).toEqual({ canvas: SD, source: "manual" });
    // чип на плате видит камеру NTSC
    const chip = live({ chip: true, msp: false, c: 30, r: 13, hd: false, port: true, dev: false, devc: false, vtx: false, req: 0 });
    expect(osdCanvasNow(b, chip, true)).toEqual({ canvas: SD, source: "camera" });
    // выбрали HDZero — экран сразу его, хоть плата ещё рисует по-старому
    const hdzero = board({ osd_displayport_device: "MSP", vcd_video_system: "HD", osd_canvas_width: 50, osd_canvas_height: 18 });
    expect(osdCanvasNow(hdzero, chip, true)).toEqual({ canvas: { cols: 50, rows: 18, hd: true }, source: "settings" });
    // очки сами сообщили 53 × 20 — это и есть экран
    const goggles = live({ chip: false, msp: true, c: 53, r: 20, hd: true, port: true, dev: true, devc: true, vtx: false, req: 40 });
    expect(osdCanvasNow(b, goggles, true)).toEqual({ canvas: HD, source: "device" });
    expect(osdCanvasNow(hdzero, goggles, true)).toEqual({ canvas: HD, source: "device" });
    // HD в настройках при выводе только в чип — не про чип
    expect(osdCanvasNow(board({ osd_displayport_device: "MAX7456", vcd_video_system: "HD" }), null, true).canvas).toEqual(PAL);
    expect(osdCanvasNow(board({ vcd_video_system: "NTSC" }), null, true)).toEqual({ canvas: SD, source: "settings" });
  });

  it("раскладка по умолчанию сделана под 30 × 13 и переносится на экран очков по краям и центру", () => {
    const b = board();
    const els = osdElements(b);
    expect(osdLayoutCanvas(els, width)).toEqual(SD);
    expect(osdOutside(els, width, SD)).toEqual([]);
    expect(osdRemapOffer(els, width, PAL)).toBeNull();          // аналог: всё на месте
    expect(osdRemapOffer(els, width, HD)).toEqual(SD);          // очки шире — предложить

    const moved = Object.fromEntries(osdRemapAll(els, width, SD, HD).map((c) => [c.name, c.value]));
    const at = (name: string) => [osdX(moved[name]), osdY(moved[name])];
    expect(moved.osd_link_quality_pos).toBeUndefined();         // левый верхний угол — не двигается
    expect(at("osd_gps_sats_pos")).toEqual([47, 0]);            // правый верхний: тот же отступ от края
    expect(at("osd_crosshairs_pos")).toEqual([26, 10]);         // прицел — в центре экрана
    expect(at("osd_flymode_pos")).toEqual([25, 0]);
    expect(at("osd_warnings_pos")).toEqual([21, 16]);
    expect(at("osd_vbat_pos")).toEqual([1, 19]);                // левый нижний угол
    expect(at("osd_tim_2_pos")).toEqual([45, 19]);              // правый нижний
    // то, что стоит рядом с левым краем, но правее его трети по центру, не отрывается от соседа
    expect(osdX(osdRemap(osdPos(8, 12), 5, SD, HD))).toBe(8);   // напряжение на банку — рядом с батареей
    expect(osdX(osdRemap(osdPos(11, 5), 3, SD, HD))).toBe(23);  // левее центра, но не у края — едет с центром
    // спрятанный остаётся спрятанным, но тоже переезжает осмысленно
    expect(moved.osd_throttle_pos).toBeUndefined();
    expect(osdVisible(osdRemap(osdPos(20, 12, 0), 3, SD, HD))).toBe(false);
    expect(osdX(osdRemap(osdPos(20, 12, 0), 3, SD, HD))).toBe(43);

    // после переноса раскладка — под экран очков, предлагать больше нечего
    let hd = b;
    for (const [name, value] of Object.entries(moved)) hd = applyMessage(hd, "param", { ...hd.params[name], value });
    const hdEls = osdElements(hd);
    expect(osdLayoutCanvas(hdEls, width)).toEqual(HD);
    expect(osdRemapOffer(hdEls, width, HD)).toBeNull();
    // вернулись на аналог: часть элементов за краем — предложить обратно, и всё помещается
    expect(osdOutside(hdEls, width, PAL).map((e) => e.key)).toEqual(["gps_sats", "warnings", "vbat", "tim_2"]);
    expect(osdRemapOffer(hdEls, width, PAL)).toEqual(HD);
    let back = hd;
    for (const c of osdRemapAll(hdEls, width, HD, PAL)) back = applyMessage(back, "param", { ...back.params[c.name], value: c.value });
    expect(osdOutside(osdElements(back), width, PAL)).toEqual([]);
    expect([osdX(Number(back.params.osd_crosshairs_pos.value)), osdY(Number(back.params.osd_crosshairs_pos.value))]).toEqual([15, 8]);
  });

  it("позиция за 31-м столбцом — шестой бит x, как в BF", () => {
    const p = osdRemap(osdPos(24, 0), 4, SD, { cols: 60, rows: 22, hd: true });
    expect(osdX(p)).toBe(54);
    expect(p & 0x0400).toBe(0x0400);
    expect(osdVisible(p)).toBe(true);
    // широкий элемент не вылезает за край
    expect(osdX(osdRemap(osdPos(40, 5), 20, HD, PAL))).toBe(10);
  });

  it("что сказать о связи с очками", () => {
    const base = { chip: false, msp: false, c: 30, r: 16, hd: false, port: true, dev: false, devc: false, vtx: false, req: 0 };
    expect(osdLinkNotes(null, "AUTO")).toEqual([]);
    expect(osdLinkNotes(live(base), "AUTO")).toEqual(["waiting"]);
    expect(osdLinkNotes(live(base), "MAX7456")).toEqual([]);
    expect(osdLinkNotes(live({ ...base, chip: true }), "AUTO")).toEqual(["chip", "waiting"]);
    expect(osdLinkNotes(live({ ...base, port: false, chip: true }), "AUTO")).toEqual(["chip", "no-port"]);
    expect(osdLinkNotes(live({ ...base, msp: true }), "MSP")).toEqual(["silent"]);
    expect(osdLinkNotes(live({ ...base, msp: true, dev: true }), "MSP")).toEqual(["goggles"]);
    expect(osdLinkNotes(live({ ...base, msp: true, dev: true, devc: true, vtx: true }), "AUTO")).toEqual(["goggles-own-size", "vtx"]);
  });
});
