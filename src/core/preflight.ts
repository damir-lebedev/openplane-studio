// «Готов к полёту» (P08): короткий список перед вылетом по живым кадрам и
// таблице тумблеров, плюс то, что проверяет только человек (винты). В очках
// до ARM — та же суть одной строкой (элемент OSD preflight, Osd.h
// preflightText): preflightOsd() повторяет её для превью.

import type { CopterLive } from "../api";
import { N_ } from "../i18n";
import { armWhyList } from "./armWhy";
import type { AuxRow } from "./copterParams";

export type PreflightId = "battery" | "radio" | "gps" | "arm" | "armSwitch" | "angle" | "rescue" | "props";

export interface PreflightItem {
  id: PreflightId;
  /** null — проверяет человек */
  ok: boolean | null;
  text: string;
  vars?: Record<string, string | number>;
}

// номера режимов BF (boxId)
const BOX_ARM = 0;
const BOX_ANGLE = 1;
const BOX_GPS_RESCUE = 46;

const onSwitch = (rows: AuxRow[], box: number) => rows.some((r) => r[1] === box && r[4] > r[3]);

export function preflight(live: CopterLive | null, aux: AuxRow[], propsChecked: boolean): PreflightItem[] {
  const items: PreflightItem[] = [];
  if (!live) return items;
  const cell = live.cell ?? 0;
  if (live.v < 0.5) items.push({ id: "battery", ok: false, text: N_("Батарея не подключена") });
  else if (live.bat === "WARNING" || live.bat === "CRITICAL") items.push({ id: "battery", ok: false, text: N_("Батарея разряжена: {cell} В на банку"), vars: { cell: cell.toFixed(2) } });
  else if (live.full === false) items.push({ id: "battery", ok: false, text: N_("Батарея не полная: {cell} В на банку — заряжена ли?"), vars: { cell: cell.toFixed(2) } });
  else items.push({ id: "battery", ok: true, text: N_("Батарея полная: {cell} В на банку"), vars: { cell: cell.toFixed(2) } });

  items.push(live.rx === "ok" ? { id: "radio", ok: true, text: N_("Пульт на связи") } : { id: "radio", ok: false, text: N_("Нет связи с пультом") });

  if (live.gps) {
    items.push(
      live.gps.fix
        ? { id: "gps", ok: true, text: N_("GPS: {sats} спутн. — дом запишется при ARM"), vars: { sats: live.gps.sats } }
        : { id: "gps", ok: false, text: N_("GPS ищет спутники ({sats}) — без них возврата домой не будет"), vars: { sats: live.gps.sats } },
    );
  }

  items.push(onSwitch(aux, BOX_ARM) ? { id: "armSwitch", ok: true, text: N_("ARM на тумблере") } : { id: "armSwitch", ok: false, text: N_("ARM не назначен на тумблер") });
  items.push(onSwitch(aux, BOX_ANGLE) ? { id: "angle", ok: true, text: N_("ANGLE на тумблере — выровняет, если растеряешься") } : { id: "angle", ok: false, text: N_("ANGLE не на тумблере: новичку без него трудно") });
  if (live.gps) {
    items.push(
      onSwitch(aux, BOX_GPS_RESCUE)
        ? { id: "rescue", ok: true, text: N_("Возврат домой на тумблере") }
        : { id: "rescue", ok: false, text: N_("Возврат домой не на тумблере — вернёт только при потере связи") },
    );
  }

  // газ и тумблер ARM на земле — обычное дело, мешает остальное
  const serious = armWhyList(live.block).filter((x) => !x.bench && x.code !== "RXLOSS" && x.code !== "NO_ARM_AUX");
  items.push(
    serious.length
      ? { id: "arm", ok: false, text: N_("Мешает ARM: {why}"), vars: { why: serious.map((x) => x.word).join(", ") } }
      : { id: "arm", ok: true, text: N_("Прошивке ничего не мешает армить") },
  );

  items.push({ id: "props", ok: propsChecked ? true : null, text: N_("Винты надеты по схеме: номер и направление") });
  return items;
}

export const preflightReady = (items: PreflightItem[]) => items.length > 0 && items.every((x) => x.ok === true);

/** Строка в очках до ARM — как preflightText в прошивке (Osd.h). */
export function preflightOsd(live: CopterLive | null): string {
  if (!live) return "BATT OK  GPS OK  RX OK";
  const parts: string[] = [];
  if (live.bat === "WARNING" || live.bat === "CRITICAL") parts.push("BATT LOW");
  else if (live.full === false) parts.push("NOT FULL");
  else if (live.bat && live.bat !== "NOT PRESENT") parts.push("BATT OK");
  if (live.gps) parts.push(live.gps.fix ? "GPS OK" : "GPS WAIT");
  parts.push(live.rx === "ok" ? "RX OK" : "NO RADIO");
  return parts.join("  ");
}
