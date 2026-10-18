// Раскладка каналов пульта у самолёта: Channels.h прошивки плюс правки
// проекта. Тумблер пришёл не на тот канал — прошивка подстраивается под
// пульт, а не пилот копается в меню пульта.

import { t } from "../i18n";
import { Manifest } from "./manifest";
import { effectiveParam, PlaneProject } from "./project";
import { setParamValue } from "./params";

/** ARM и SwA — один тумблер под двумя именами: двигаются вместе. */
function group(name: string): string[] {
  return name === "ARM" || name === "SWA" ? ["ARM", "SWA"] : [name];
}

function firmwareIndex(manifest: Manifest, name: string): number | undefined {
  return manifest.channels.list.find((c) => c.name === name)?.index;
}

/** Номер канала (0 = CH1) для имени из Channels.h с учётом правок проекта. */
export function channelIndex(manifest: Manifest, project: PlaneProject, name: string): number {
  return project.channels[name] ?? firmwareIndex(manifest, name) ?? -1;
}

function setIndex(manifest: Manifest, project: PlaneProject, name: string, index: number) {
  if (firmwareIndex(manifest, name) === index) delete project.channels[name];
  else project.channels[name] = index;
}

/** Поставить орган пульта на канал; кто там был — переезжает на освободившийся. */
export function assignChannel(manifest: Manifest, project: PlaneProject, name: string, index: number) {
  const moving = group(name);
  const old = channelIndex(manifest, project, moving[0]);
  if (old === index) return;
  for (const c of manifest.channels.list) {
    if (moving.includes(c.name)) continue;
    if (channelIndex(manifest, project, c.name) === index) setIndex(manifest, project, c.name, old);
  }
  for (const n of moving) setIndex(manifest, project, n, index);
}

/** Два органа пульта на одном канале (кроме пары ARM/SwA) — прошивка не соберётся. */
export function channelClashes(manifest: Manifest, project: PlaneProject): string[] {
  const seen = new Map<number, string>();
  const out: string[] = [];
  for (const c of manifest.channels.list) {
    if (c.name === "SWA") continue;
    const i = channelIndex(manifest, project, c.name);
    const prev = seen.get(i);
    if (prev) out.push(t("{a} и {b} — оба на CH{n}", { a: prev, b: c.name, n: i + 1 }));
    else seen.set(i, c.name);
  }
  return out;
}

export function channelReversed(manifest: Manifest, project: PlaneProject, index: number): boolean {
  const list = effectiveParam(manifest, project, "CHANNEL_REVERSED");
  return Array.isArray(list) ? list[index] === true : false;
}

/** Реверс канала на стороне платы (CHANNEL_REVERSED). Газ реверсировать нельзя. */
export function toggleChannelReversed(manifest: Manifest, project: PlaneProject, index: number) {
  const list = effectiveParam(manifest, project, "CHANNEL_REVERSED");
  if (!Array.isArray(list) || index < 0 || index >= list.length) return;
  if (index === channelIndex(manifest, project, "THROTTLE")) return;
  const next = list.slice();
  next[index] = !next[index];
  setParamValue(manifest, project, "CHANNEL_REVERSED", next);
}

/** Флаг реверса (AILERON_LEFT_REVERSED…): перевернуть. */
export function toggleFlag(manifest: Manifest, project: PlaneProject, name: string) {
  setParamValue(manifest, project, name, effectiveParam(manifest, project, name) !== true);
}
