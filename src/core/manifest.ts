// Описание прошивки — то, что отдаёт tools/opconfig.py describe из
// репозитория прошивки. Приложение ничего о прошивке не выдумывает: платы,
// параметры, режимы и что им нужно — отсюда.

export type SensorCategory = "imu" | "baro" | "mag" | "airspeed" | "gps";
export const SENSOR_CATEGORIES: SensorCategory[] = ["imu", "baro", "mag", "airspeed", "gps"];

export interface BoardOutputs {
  rudder: boolean;
  aux1: boolean;
  aux2: boolean;
  buzzer: boolean;
  screen: boolean;
  battery: boolean;
  gpsTx: boolean;
}

export interface ManifestBoard {
  env: string;
  title: string;
  macro: string | null;
  board: string | null;
  platform: string | null;
  uploadProtocol: string | null;
  default: boolean;
  blackbox: "flash" | "sd" | "none";
  telemetry: "wifi" | "mavlink" | "none";
  outputs: BoardOutputs;
}

export type ParamKind = "bool" | "float" | "int" | "pin" | "string" | "enum" | "channel" | "array" | "other";

export interface ManifestParam {
  name: string;
  type: string;
  kind: ParamKind;
  value: unknown;
  expr: string | null;
  valueKind: string;
  board: string | null;
  group: string | null;
  doc: string;
  note: string;
  fixed: boolean;
  line: number;
  unit: string | null;
  needs: string[];
  range?: [number, number];
  min?: number;
  max?: number;
  options?: string[];
  size?: string;
  itemNotes?: string[];
}

export interface ManifestChannel {
  name: string;
  index: number;
  doc: string;
  positions: 2 | 3 | "knob" | null;
  stick: boolean;
  bindable: boolean;
}

export interface ManifestItem {
  id: string;
  value: number;
  doc: string;
  name: string;
  short?: string;
  needs: string[] | null;
  better: string[];
}

export interface SensorOption {
  id: string;
  value: number;
  chip: string;
  title: string;
  bus: "i2c" | "spi" | "uart" | "none";
  doc: string;
  note: string;
}

export interface SensorKit {
  id: string;
  value: number;
  doc: string;
  sensors: Partial<Record<SensorCategory, string>>;
}

export type Binding =
  | { kind: "modes"; channel: string; modes: string[] }
  | { kind: "mode"; channel: string; mode: string }
  | { kind: "feature"; channel: string; feature: string }
  | { kind: "knob"; channel: string; knob: string };

export interface Manifest {
  schema: number;
  generator: string;
  sourceHash: string;
  needTokens: Record<string, string>;
  boards: ManifestBoard[];
  params: ManifestParam[];
  enums: Record<string, string[]>;
  channels: { count: number; list: ManifestChannel[] };
  modes: ManifestItem[];
  features: ManifestItem[];
  knobs: ManifestItem[];
  sensors: { options: Record<SensorCategory, SensorOption[]>; kits: SensorKit[] };
  current: { sensorKit: string | null; sensors: Record<SensorCategory, string>; bindings: Binding[] };
  suggestions: (Binding & { doc: string })[];
}

export function findBoard(manifest: Manifest, env: string): ManifestBoard | undefined {
  return manifest.boards.find((b) => b.env === env);
}

export function defaultBoard(manifest: Manifest): ManifestBoard {
  return manifest.boards.find((b) => b.default) ?? manifest.boards[0];
}

/** Параметр Config.h для платы: свой блок пинов или общий. */
export function findParam(manifest: Manifest, name: string, boardMacro: string | null): ManifestParam | undefined {
  return (
    manifest.params.find((p) => p.name === name && p.board !== null && p.board === boardMacro) ??
    manifest.params.find((p) => p.name === name && p.board === null)
  );
}

/** Параметры, которые видны для этой платы: общие + её блок пинов. */
export function paramsForBoard(manifest: Manifest, boardMacro: string | null): ManifestParam[] {
  return manifest.params.filter((p) => p.board === null || p.board === boardMacro);
}

export function isNone(sensorId: string | undefined): boolean {
  return !sensorId || sensorId === "none" || sensorId.endsWith("_NONE");
}
