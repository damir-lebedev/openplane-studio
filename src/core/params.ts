// Правка параметров Config.h из мастера и таблицы «Все параметры».

import { findBoard, findParam, Manifest, ManifestParam } from "./manifest";
import { effectiveParam, PlaneProject } from "./project";

export interface ParamState {
  param: ManifestParam;
  value: unknown;
  firmware: unknown;
  changed: boolean;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (typeof a === "string" && typeof b === "string") return a.split("::").pop() === b.split("::").pop();
  return a === b;
}

export function paramState(manifest: Manifest, project: PlaneProject, name: string): ParamState | null {
  const board = findBoard(manifest, project.board);
  const param = findParam(manifest, name, board?.macro ?? null);
  if (!param) return null;
  const value = effectiveParam(manifest, project, name);
  return { param, value, firmware: param.value, changed: !sameValue(value, param.value) };
}

/** Записать значение в самолёт; равно значению прошивки — правка убирается. */
export function setParamValue(manifest: Manifest, project: PlaneProject, name: string, value: unknown) {
  const board = findBoard(manifest, project.board);
  const param = findParam(manifest, name, board?.macro ?? null);
  if (!param || param.fixed) return;
  if (name === "ESC_BIDIRECTIONAL") {
    project.airframe.esc = value === true ? "bidirectional" : "normal";
    return;
  }
  if (name === "LANDING_GEAR") {
    project.airframe.gear = String(value).endsWith("NOSE_WHEEL") ? "nose" : "tail";
    return;
  }
  const same = sameValue(value, param.value);
  if (param.board) {
    const own = { ...(project.boardParams[param.board] ?? {}) };
    if (same) delete own[name];
    else own[name] = value;
    project.boardParams[param.board] = own;
  } else if (same) {
    delete project.params[name];
  } else {
    project.params[name] = value;
  }
}

/** Текст из поля ввода → значение параметра или ошибка. */
export function parseInput(param: ManifestParam, text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const s = text.trim().replace(",", ".");
  switch (param.kind) {
    case "float": {
      const v = Number(s);
      if (s === "" || !Number.isFinite(v)) return { ok: false, error: "нужно число" };
      return { ok: true, value: v };
    }
    case "int": {
      const v = Number(s);
      if (!Number.isInteger(v)) return { ok: false, error: "нужно целое число" };
      if (param.min !== undefined && v < param.min) return { ok: false, error: `не меньше ${param.min}` };
      if (param.max !== undefined && v > param.max) return { ok: false, error: `не больше ${param.max}` };
      return { ok: true, value: v };
    }
    case "pin": {
      if (/^P[A-K](?:[0-9]|1[0-5])$/i.test(s)) return { ok: true, value: s.toUpperCase() };
      const v = Number(s);
      if (!Number.isInteger(v)) return { ok: false, error: "номер GPIO, −1 (нет) или пин вида PA3" };
      if (param.min !== undefined && v < param.min) return { ok: false, error: `не меньше ${param.min}` };
      if (param.max !== undefined && v > param.max) return { ok: false, error: `не больше ${param.max}` };
      return { ok: true, value: v };
    }
    case "string":
      if (/[\u0000-\u001f]/.test(text)) return { ok: false, error: "без управляющих символов" };
      return { ok: true, value: text };
    default:
      return { ok: false, error: "этот параметр меняется не здесь" };
  }
}

export function formatValue(value: unknown): string {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(+value.toPrecision(6));
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (Array.isArray(value)) return value.map(formatValue).join(" ");
  if (typeof value === "string") return value.split("::").pop() ?? value;
  return String(value ?? "—");
}
