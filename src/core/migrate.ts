// Прошивка обновилась — что это значит для самолёта. При каждой прошивке
// в снимок кладётся отпечаток прошивки (значения по умолчанию, режимы,
// функции, датчики); при следующем открытии проекта новая прошивка
// сравнивается с ним: что появилось, что убрали, у каких чисел поменялось
// значение по умолчанию — а самолёт его не задаёт, значит, полетит иначе.

import { Manifest, SENSOR_CATEGORIES } from "./manifest";
import { sameValue } from "./params";
import { PlaneProject } from "./project";

export interface FirmwareFingerprint {
  sourceHash: string;
  /** общие параметры (не пины): имя → значение по умолчанию */
  defaults: Record<string, unknown>;
  modes: string[];
  features: string[];
  knobs: string[];
  sensors: string[];
}

export function fingerprint(manifest: Manifest): FirmwareFingerprint {
  const defaults: Record<string, unknown> = {};
  for (const p of manifest.params) if (p.board === null && !p.fixed) defaults[p.name] = p.value;
  return {
    sourceHash: manifest.sourceHash,
    defaults,
    modes: manifest.modes.map((m) => m.id),
    features: manifest.features.map((m) => m.id),
    knobs: manifest.knobs.map((m) => m.id),
    sensors: SENSOR_CATEGORIES.flatMap((c) => manifest.sensors.options[c].map((o) => o.id)),
  };
}

export interface DefaultChange {
  name: string;
  from: unknown;
  to: unknown;
  /** самолёт задаёт это число сам — новое значение по умолчанию его не трогает */
  overridden: boolean;
  unit: string | null;
}

export interface MigrationReport {
  addedModes: string[];
  addedFeatures: string[];
  addedKnobs: string[];
  addedSensors: string[];
  addedParams: string[];
  removedModes: string[];
  removedFeatures: string[];
  removedKnobs: string[];
  removedSensors: string[];
  removedParams: string[];
  changedDefaults: DefaultChange[];
}

const diff = (a: string[], b: string[]) => b.filter((x) => !a.includes(x));

/** Что поменялось в прошивке с отпечатка old до нынешней (manifest) — для этого самолёта. */
export function migrationReport(old: FirmwareFingerprint, manifest: Manifest, plane: PlaneProject): MigrationReport {
  const now = fingerprint(manifest);
  const oldParams = Object.keys(old.defaults);
  const newParams = Object.keys(now.defaults);
  const changedDefaults: DefaultChange[] = [];
  for (const name of newParams) {
    if (!(name in old.defaults) || sameValue(old.defaults[name], now.defaults[name])) continue;
    changedDefaults.push({
      name,
      from: old.defaults[name],
      to: now.defaults[name],
      overridden: name in plane.params,
      unit: manifest.params.find((p) => p.name === name && p.board === null)?.unit ?? null,
    });
  }
  return {
    addedModes: diff(old.modes, now.modes),
    addedFeatures: diff(old.features, now.features),
    addedKnobs: diff(old.knobs, now.knobs),
    addedSensors: diff(old.sensors, now.sensors),
    addedParams: diff(oldParams, newParams),
    removedModes: diff(now.modes, old.modes),
    removedFeatures: diff(now.features, old.features),
    removedKnobs: diff(now.knobs, old.knobs),
    removedSensors: diff(now.sensors, old.sensors),
    removedParams: diff(newParams, oldParams),
    changedDefaults,
  };
}

export function isEmptyReport(r: MigrationReport): boolean {
  return Object.values(r).every((v) => (Array.isArray(v) ? v.length === 0 : true));
}
