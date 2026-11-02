// Связь с пультом: качество (LQ) и сила сигнала (RSSI) из живых кадров
// коптера (copter/Rssi.h прошивки) — полосы и пороги OSD.

import type { CopterLive } from "../api";
import { N_ } from "../i18n";

export type LinkLevel = "good" | "low" | "none";

export interface LinkBar {
  key: "lq" | "rssi";
  /** %, 0…100 */
  value: number;
  /** порог OSD (osd_link_quality_alarm / osd_rssi_alarm), 0 — нет */
  alarm: number;
  level: LinkLevel;
  /** уровень в dBm — только RSSI от CRSF */
  dbm?: number;
}

function level(value: number, alarm: number, lost: boolean): LinkLevel {
  if (lost || value <= 0) return "none";
  return alarm > 0 && value < alarm ? "low" : "good";
}

/** Полосы LQ и RSSI — только те, что плата сообщает. */
export function linkBars(live: CopterLive | null, lqAlarm: number, rssiAlarm: number): LinkBar[] {
  if (!live) return [];
  const lost = live.rx !== "ok";
  const bars: LinkBar[] = [];
  if (live.lq !== undefined) bars.push({ key: "lq", value: live.lq, alarm: lqAlarm, level: level(live.lq, lqAlarm, lost) });
  if (live.rssi !== undefined) {
    bars.push({ key: "rssi", value: live.rssi, alarm: rssiAlarm, level: level(live.rssi, rssiAlarm, lost), dbm: live.dbm });
  }
  return bars;
}

/** Откуда прошивка берёт RSSI — подпись (переводится вызывающим). */
export function rssiSourceText(src: CopterLive["rssisrc"]): string {
  switch (src) {
    case "channel":
      return N_("из канала пульта (rssi_channel)");
    case "frames":
      return N_("по битым кадрам (rssi_src_frame_errors)");
    case "protocol":
      return N_("от приёмника (CRSF, dBm)");
    default:
      return N_("не сообщается: задайте rssi_channel или включите rssi_src_frame_errors");
  }
}
