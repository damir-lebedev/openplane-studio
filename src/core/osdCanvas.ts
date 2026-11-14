// Экран OSD: аналоговый чип на плате (30 × 16 PAL или 13 NTSC) или цифровые
// очки по MSP DisplayPort — DJI, Walksnail, HDZero (до 60 × 22). Прошивка:
// copter/DisplayPort.h. Здесь — какой экран сейчас, готовые наборы настроек
// под видеосистему и перенос раскладки с одного экрана на другой.

import type { CopterLive } from "../api";
import { N_ } from "../i18n";
import { CopterBoard, OsdElementParam, osdMove, osdVisible, osdX, osdY, ParamValue } from "./copterParams";

export interface OsdCanvas {
  cols: number;
  rows: number;
  /** большой экран цифровых очков */
  hd: boolean;
}

/** Экраны, под которые бывает сделана раскладка, — от меньшего к большему. */
export const OSD_CANVASES: OsdCanvas[] = [
  { cols: 30, rows: 13, hd: false },
  { cols: 30, rows: 16, hd: false },
  { cols: 50, rows: 18, hd: true },
  { cols: 53, rows: 20, hd: true },
  { cols: 60, rows: 22, hd: true },
];

export interface OsdSystem {
  id: "auto" | "analog" | "hd53" | "hdzero" | "wtfos";
  title: string;
  note: string;
  /** osd_displayport_device */
  device: "AUTO" | "MAX7456" | "MSP";
  /** vcd_video_system */
  video: "AUTO" | "HD";
  cols: number;
  rows: number;
}

/** Видеосистемы: что выставить в настройках, чтобы OSD появился в очках. */
export const OSD_SYSTEMS: OsdSystem[] = [
  { id: "auto", title: N_("Сам разберётся"), note: N_("Чип на плате и очки на проводе — что найдётся. Размер экрана очки сообщают сами."), device: "AUTO", video: "AUTO", cols: 30, rows: 16 },
  { id: "analog", title: N_("Аналоговое видео"), note: N_("Чип OSD на плате рисует поверх картинки камеры: 30 × 16 (PAL) или 13 (NTSC)."), device: "MAX7456", video: "AUTO", cols: 30, rows: 16 },
  { id: "hd53", title: "DJI O3 / O4 · Walksnail Avatar", note: N_("Цифровые очки, экран 53 × 20."), device: "MSP", video: "HD", cols: 53, rows: 20 },
  { id: "hdzero", title: "HDZero", note: N_("Цифровые очки, экран 50 × 18."), device: "MSP", video: "HD", cols: 50, rows: 18 },
  { id: "wtfos", title: "DJI V1 / V2 + WTFOS", note: N_("Старые очки DJI с прошивкой WTFOS, экран 60 × 22."), device: "MSP", video: "HD", cols: 60, rows: 22 },
];

const value = (b: CopterBoard, name: string): ParamValue | undefined => b.pending[name] ?? b.params[name]?.value;

/** Прошивка умеет выводить OSD в очки (есть настройка osd_displayport_device). */
export const osdOutputSupported = (b: CopterBoard) => "osd_displayport_device" in b.params;

/** Какой набор сейчас выставлен; null — своё сочетание настроек. */
export function osdSystemOf(b: CopterBoard): OsdSystem | null {
  const device = String(value(b, "osd_displayport_device") ?? "AUTO");
  const video = String(value(b, "vcd_video_system") ?? "AUTO");
  const cols = Number(value(b, "osd_canvas_width") ?? 53);
  const rows = Number(value(b, "osd_canvas_height") ?? 20);
  return (
    OSD_SYSTEMS.find((s) => {
      if (s.device !== device) return false;
      if (s.video === "HD") return video === "HD" && s.cols === cols && s.rows === rows;
      return video === "AUTO";
    }) ?? null
  );
}

/** Что отправить на плату, чтобы выставить набор (только то, что отличается). */
export function osdSystemSettings(b: CopterBoard, s: OsdSystem): { name: string; value: ParamValue }[] {
  const want: [string, ParamValue][] = [
    ["osd_displayport_device", s.device],
    ["vcd_video_system", s.video],
  ];
  if (s.video === "HD") want.push(["osd_canvas_width", s.cols], ["osd_canvas_height", s.rows]);
  return want.filter(([name, v]) => name in b.params && String(value(b, name)) !== String(v)).map(([name, v]) => ({ name, value: v }));
}

export interface OsdCanvasNow {
  canvas: OsdCanvas;
  /** откуда размер: очки сказали сами, настройки, камера (чип видит PAL/NTSC) или переключатель в приложении */
  source: "device" | "settings" | "camera" | "manual";
}

/**
 * Экран, под который сейчас рисуется раскладка. Очки, сообщившие свой размер,
 * главнее настроек (так делает и прошивка); настройки берутся с учётом ещё не
 * сохранённых — выбрал систему и сразу видишь её экран.
 */
export function osdCanvasNow(b: CopterBoard, live: CopterLive | null, pal: boolean): OsdCanvasNow {
  const o = live?.osd;
  if (o && o.msp && o.devc) return { canvas: { cols: o.c, rows: o.r, hd: true }, source: "device" };
  const device = String(value(b, "osd_displayport_device") ?? "AUTO");
  const video = String(value(b, "vcd_video_system") ?? "AUTO");
  if (video === "HD" && device !== "MAX7456" && device !== "NONE") {
    const cols = clamp(Number(value(b, "osd_canvas_width") ?? 53), 30, 60);
    const rows = clamp(Number(value(b, "osd_canvas_height") ?? 20), 13, 22);
    return { canvas: { cols, rows, hd: true }, source: "settings" };
  }
  if (video === "NTSC") return { canvas: { cols: 30, rows: 13, hd: false }, source: "settings" };
  if (video === "PAL") return { canvas: { cols: 30, rows: 16, hd: false }, source: "settings" };
  if (o && o.chip && !o.hd) return { canvas: { cols: 30, rows: o.r, hd: false }, source: "camera" };
  return { canvas: { cols: 30, rows: pal ? 16 : 13, hd: false }, source: "manual" };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

/** Ширина элемента в клетках (зависит от того, что он показывает). */
export type OsdWidth = (key: string) => number;

/** Показанные элементы, которые не помещаются на экране. */
export function osdOutside(elements: OsdElementParam[], width: OsdWidth, canvas: OsdCanvas): OsdElementParam[] {
  return elements.filter((el) => osdVisible(el.pos) && (osdY(el.pos) >= canvas.rows || osdX(el.pos) + Math.max(1, width(el.key)) > canvas.cols));
}

/** Под какой экран сделана раскладка: наименьший из известных, куда помещаются все показанные элементы. */
export function osdLayoutCanvas(elements: OsdElementParam[], width: OsdWidth): OsdCanvas {
  return OSD_CANVASES.find((c) => osdOutside(elements, width, c).length === 0) ?? OSD_CANVASES[OSD_CANVASES.length - 1];
}

/**
 * Позиция элемента на другом экране: что стояло у левого края — остаётся у
 * левого, у правого — у правого (тот же отступ), в середине — сдвигается
 * вместе с центром; по вертикали — по третям экрана. Прицел остаётся в
 * центре, батарея — в углу, время — у нижнего края.
 */
export function osdRemap(pos: number, width: number, from: OsdCanvas, to: OsdCanvas): number {
  const w = Math.max(1, width);
  const x = osdX(pos);
  const y = osdY(pos);
  // по горизонтали: к центру едет то, что стоит на центральном столбце (прицел, режим,
  // предупреждение); что целиком слева и начинается в левой трети — держится левого края
  // (напряжение на банку остаётся рядом с напряжением батареи), справа — правого
  const mid = from.cols / 2;
  let nx: number;
  if (x + w < mid && x < from.cols / 3) nx = x;
  else if (x > mid && x + w > (from.cols * 2) / 3) nx = to.cols - (from.cols - x);
  else nx = Math.round(x + (to.cols - from.cols) / 2);
  const cy = y + 0.5;
  let ny: number;
  if (cy < from.rows / 3) ny = y;
  else if (cy > (from.rows * 2) / 3) ny = to.rows - (from.rows - y);
  else ny = Math.round(y + (to.rows - from.rows) / 2);
  nx = clamp(nx, 0, Math.max(0, to.cols - w));
  ny = clamp(ny, 0, to.rows - 1);
  return osdMove(pos, nx, ny);
}

/** Вся раскладка — на другой экран; возвращает только то, что изменилось. */
export function osdRemapAll(elements: OsdElementParam[], width: OsdWidth, from: OsdCanvas, to: OsdCanvas): { name: string; value: number }[] {
  return elements
    .map((el) => ({ name: el.param.name, value: osdRemap(el.pos, width(el.key), from, to), was: el.pos }))
    .filter((c) => c.value !== c.was)
    .map(({ name, value }) => ({ name, value }));
}

/** Стоит ли предложить «разложить по экрану»: экран шире раскладки или часть элементов за краем. */
export function osdRemapOffer(elements: OsdElementParam[], width: OsdWidth, canvas: OsdCanvas): OsdCanvas | null {
  const made = osdLayoutCanvas(elements, width);
  if (made.cols === canvas.cols && made.rows === canvas.rows) return null;
  if (canvas.cols > made.cols || osdOutside(elements, width, canvas).length > 0) return made;
  return null;
}

export type OsdLinkNote = "no-port" | "chip" | "goggles" | "goggles-own-size" | "silent" | "waiting" | "vtx";

/** Что сказать о выводе по живому кадру платы (по порядку показа). */
export function osdLinkNotes(live: CopterLive | null, device: string): OsdLinkNote[] {
  const o = live?.osd;
  if (!o) return [];
  const notes: OsdLinkNote[] = [];
  if (o.chip) notes.push("chip");
  if (!o.port) notes.push("no-port");
  else if (o.msp && o.dev) notes.push(o.devc ? "goggles-own-size" : "goggles");
  else if (o.msp) notes.push("silent");
  else if (device === "AUTO") notes.push("waiting");
  if (o.vtx) notes.push("vtx");
  return notes;
}
