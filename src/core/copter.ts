// Коптер в ангаре. Настройки самого коптера (PID, тумблеры, видеопередатчик)
// живут на плате и меняются в её CLI, как в Betaflight (docs/COPTER.md
// прошивки), — проект хранит то, что нужно для прошивки (сборка = env
// platformio.ini), список комплектующих и первую настройку: строки CLI,
// которые приложение может записать в плату по связи.

import { N_, t } from "../i18n";
import { Manifest } from "./manifest";
import { FlashRecord } from "./project";

/** Сборка коптера из platformio.ini (VEHICLE_MULTIROTOR) — от tools/opconfig.py. */
export interface CopterEnv {
  env: string;
  title: string;
  macro: string | null;
  /** заголовок платы из-под Betaflight (config/boards/…), если есть */
  boardFile: string | null;
  /** сборка из каталога (copter/Presets.h), вшитая в env */
  build: string | null;
  esc: string;
  board: string | null;
  uploadProtocol: string | null;
  /** заголовок платы — заглушка: распиновку надо снять с самой платы */
  needsBoardDump: boolean;
}

export interface CopterBuild {
  id: string;
  title: string;
  frame: string;
}

export interface CopterParts {
  fc: string;
  esc: string;
  motors: string;
  props: string;
  battery: string;
  gps: string;
  receiver: string;
  radio: string;
  camera: string;
  vtx: string;
  goggles: string;
}

export const PART_KEYS: (keyof CopterParts)[] = ["fc", "esc", "motors", "props", "battery", "gps", "receiver", "radio", "camera", "vtx", "goggles"];

export const PART_LABELS: Record<keyof CopterParts, string> = {
  fc: N_("Полётник"),
  esc: N_("Регуляторы"),
  motors: N_("Моторы"),
  props: N_("Пропеллеры"),
  battery: N_("Батарея"),
  gps: N_("GPS и компас"),
  receiver: N_("Приёмник"),
  radio: N_("Пульт"),
  camera: N_("Камера"),
  vtx: N_("Видеопередатчик"),
  goggles: N_("Шлем"),
};

/** AUX-каналы тумблеров: 0 — AUX1 (CH5), −1 — тумблера нет. */
export interface CopterSwitches {
  arm: number;
  /** трёхпозиционный: ANGLE / HORIZON / ACRO */
  modes: number;
  /** трёхпозиционный: слабо / средне / максимум в пределах потолка */
  vtxPower: number;
  beeper: number;
}

export interface CopterProject {
  schema: 1;
  vehicle: "copter";
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** env прошивки (сборка коптера в platformio.ini) */
  board: string;
  parts: CopterParts;
  /** потолок мощности видеопередатчика, мВт; 0 — без потолка */
  vtxMaxPowerMw: number;
  /** полоса 1…10 (A B E F R L X V G S) и канал 1…8 */
  vtxBand: number;
  vtxChannel: number;
  switches: CopterSwitches;
  /** когда первую настройку записали в плату */
  setupWrittenAt?: string;
  lastFlash?: FlashRecord;
  history: FlashRecord[];
}

export function isCopter(p: unknown): p is CopterProject {
  return !!p && typeof p === "object" && (p as { vehicle?: unknown }).vehicle === "copter";
}

export function newCopterId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `copter-${Date.now().toString(36)}-${rnd}`;
}

export function copterEnvs(manifest: Manifest | null): CopterEnv[] {
  return manifest?.copters?.envs ?? [];
}

export function findCopterEnv(manifest: Manifest | null, env: string): CopterEnv | undefined {
  return copterEnvs(manifest).find((e) => e.env === env);
}

export function findCopterBuild(manifest: Manifest | null, id: string | null | undefined): CopterBuild | undefined {
  return id ? manifest?.copters?.builds.find((b) => b.id === id) : undefined;
}

// ---------------- видеопередатчик ----------------

export const VTX_BANDS: { id: number; letter: string; mhz: number[] }[] = [
  { id: 1, letter: "A", mhz: [5865, 5845, 5825, 5805, 5785, 5765, 5745, 5725] },
  { id: 2, letter: "B", mhz: [5733, 5752, 5771, 5790, 5809, 5828, 5847, 5866] },
  { id: 3, letter: "E", mhz: [5705, 5685, 5665, 5645, 5885, 5905, 5925, 5945] },
  { id: 4, letter: "F", mhz: [5740, 5760, 5780, 5800, 5820, 5840, 5860, 5880] },
  { id: 5, letter: "R", mhz: [5658, 5695, 5732, 5769, 5806, 5843, 5880, 5917] },
  { id: 6, letter: "L", mhz: [5362, 5399, 5436, 5473, 5510, 5547, 5584, 5621] },
  { id: 7, letter: "X", mhz: [4990, 5020, 5050, 5080, 5110, 5140, 5170, 5200] },
  { id: 8, letter: "V", mhz: [4867, 4884, 4921, 4958, 4995, 5032, 5069, 5099] },
  { id: 9, letter: "G", mhz: [5960, 5980, 6000, 6020, 6040, 6060, 6080, 6100] },
  { id: 10, letter: "S", mhz: [5333, 5373, 5413, 5453, 5493, 5533, 5573, 5613] },
];

/** Полосы, которые принимают обычные аналоговые шлемы (Skyzone Cobra X — A B E F R L). */
export const GOGGLE_BANDS = ["A", "B", "E", "F", "R", "L"];

/** Полоса без разрешения: 5725–5875 МГц, до 25 мВт (ГКРЧ, устройства малого радиуса действия). */
export const FREE_BAND_MHZ = [5725, 5875] as const;
export const FREE_POWER_MW = 25;

export const VTX_CAPS_MW = [25, 200, 400, 600, 1000, 2000, 4000, 0];

export function vtxFrequency(band: number, channel: number): number {
  return VTX_BANDS.find((b) => b.id === band)?.mhz[channel - 1] ?? 0;
}

export function inFreeBand(mhz: number): boolean {
  return mhz >= FREE_BAND_MHZ[0] && mhz <= FREE_BAND_MHZ[1];
}

/** Уровень «максимум»: прошивка опустит его до самого сильного в пределах потолка. */
export const VTX_LEVEL_MAX = 12;

// ---------------- первая настройка ----------------

export interface CliLine {
  cmd: string;
  /** что строка делает — для показа рядом */
  note: string;
}

const AUX_LOW = [900, 1300];
const AUX_MID = [1300, 1700];
const AUX_HIGH = [1700, 2100];

export const auxName = (aux: number) => `AUX${aux + 1} (CH${aux + 5})`;

/**
 * Строки CLI коптера (BF-формат): приёмник ELRS, видеопередатчик с
 * потолком и тумблеры. Без "save" — его приложение шлёт последним.
 */
export function cliSetup(p: CopterProject): CliLine[] {
  const s = p.switches;
  const lines: CliLine[] = [
    { cmd: "set serialrx_provider = CRSF", note: N_("приёмник ExpressLRS (CRSF)") },
    { cmd: "set vtx_protocol = AUTO", note: N_("SmartAudio или Tramp — прошивка найдёт сама") },
    { cmd: `set vtx_band = ${p.vtxBand}`, note: N_("полоса") },
    { cmd: `set vtx_channel = ${p.vtxChannel}`, note: N_("канал") },
    { cmd: "set vtx_power = 1", note: N_("самый слабый уровень, если тумблера нет") },
    { cmd: `set vtx_max_power_mw = ${p.vtxMaxPowerMw}`, note: N_("потолок мощности") },
    { cmd: "set vtx_low_power_disarm = ON", note: N_("без ARM — самый слабый уровень") },
  ];
  let slot = 0;
  if (s.arm >= 0) lines.push({ cmd: `aux ${slot++} 0 ${s.arm} ${AUX_HIGH[0]} ${AUX_HIGH[1]} 0 0`, note: N_("ARM — тумблер вверх") });
  if (s.modes >= 0) {
    lines.push({ cmd: `aux ${slot++} 1 ${s.modes} ${AUX_LOW[0]} ${AUX_LOW[1]} 0 0`, note: N_("ANGLE — тумблер вниз") });
    lines.push({ cmd: `aux ${slot++} 2 ${s.modes} ${AUX_MID[0]} ${AUX_MID[1]} 0 0`, note: N_("HORIZON — посередине (вверху — ACRO)") });
  }
  if (s.beeper >= 0) lines.push({ cmd: `aux ${slot++} 13 ${s.beeper} ${AUX_HIGH[0]} ${AUX_HIGH[1]} 0 0`, note: N_("BEEPER — найти упавший коптер") });
  if (s.vtxPower >= 0) {
    lines.push({ cmd: `vtx 0 ${s.vtxPower} 0 0 1 ${AUX_LOW[0]} ${AUX_LOW[1]}`, note: N_("мощность: вниз — самая слабая") });
    lines.push({ cmd: `vtx 1 ${s.vtxPower} 0 0 2 ${AUX_MID[0]} ${AUX_MID[1]}`, note: N_("посередине — второй уровень") });
    lines.push({ cmd: `vtx 2 ${s.vtxPower} 0 0 ${VTX_LEVEL_MAX} ${AUX_HIGH[0]} ${AUX_HIGH[1]}`, note: N_("вверх — максимум в пределах потолка") });
  }
  return lines;
}

export const SWITCHES: { key: keyof CopterSwitches; title: string; hint: string }[] = [
  { key: "arm", title: N_("ARM"), hint: N_("двухпозиционный: вверх — моторы включены") },
  { key: "modes", title: N_("Режимы"), hint: N_("трёхпозиционный: ANGLE / HORIZON / ACRO") },
  { key: "vtxPower", title: N_("Мощность видео"), hint: N_("трёхпозиционный: слабо / средне / максимум ≤ потолка") },
  { key: "beeper", title: N_("Пищалка"), hint: N_("найти упавший коптер") },
];

export function switchIssues(s: CopterSwitches): string[] {
  const out: string[] = [];
  if (s.arm < 0) out.push(t("ARM без тумблера — коптер не заармится."));
  else if (s.arm !== 0) out.push(t("ExpressLRS передаёт без задержки только AUX1 (CH5) — ARM ставьте на него."));
  const used = new Map<number, string>();
  for (const sw of SWITCHES) {
    const ch = s[sw.key];
    if (ch < 0) continue;
    const other = used.get(ch);
    if (other) out.push(t("{a} и {b} на одном канале {ch}.", { a: t(other), b: t(sw.title), ch: auxName(ch) }));
    else used.set(ch, sw.title);
  }
  return out;
}

/** Заглушка заголовка платы → три команды tools/bf_board.py (docs/COPTER.md прошивки). */
export function boardDumpCommands(boardFile: string | null): string[] {
  const file = boardFile ?? "config/boards/BOARD.h";
  const name = file.split("/").pop()!.replace(/\.h$/, "");
  return [
    `python tools/bf_board.py read --port COMx --out stack/${name}_bf.txt`,
    `python tools/bf_board.py backup --out stack/${name}_original.bin`,
    `python tools/bf_board.py header stack/${name}_bf.txt --baro SPL06 --out include/${file}`,
  ];
}

/** Ответ платы на строку настройки (@set / @rc / @save) с ошибкой — её текст. */
export function setupError(line: string): string | null {
  const m = line.match(/^@(set|rc|save|error)\s+(\{.*\})\s*$/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[2]) as { ok?: boolean; error?: string; name?: string; cmd?: string };
    if (v.ok === false || (m[1] === "error" && v.error)) return [v.name ?? v.cmd, v.error].filter(Boolean).join(": ") || "ошибка";
  } catch {
    /* не JSON — не ответ */
  }
  return null;
}

// ---------------- проекты ----------------

function emptyParts(): CopterParts {
  return { fc: "", esc: "", motors: "", props: "", battery: "", gps: "", receiver: "", radio: "", camera: "", vtx: "", goggles: "" };
}

export function blankCopter(manifest: Manifest | null, name: string): CopterProject {
  const now = new Date().toISOString();
  return {
    schema: 1,
    vehicle: "copter",
    id: newCopterId(),
    name,
    createdAt: now,
    updatedAt: now,
    board: copterEnvs(manifest)[0]?.env ?? "",
    parts: emptyParts(),
    vtxMaxPowerMw: FREE_POWER_MW,
    vtxBand: 5,
    vtxChannel: 4,
    switches: { arm: 0, modes: 1, vtxPower: 2, beeper: 3 },
    history: [],
  };
}

/** Готовые наборы: сборка прошивки + комплектующие, из которых она рассчитана. */
export const COPTER_KITS: { id: string; title: string; desc: string; env: string; parts: CopterParts }[] = [
  {
    id: "getfun7li",
    title: N_("7\" на Li-ion: GETFUN F405V3"),
    desc: N_("GETFUN F405V3 + 100A, 2810 1300KV, 7040, 6S Li-ion, ELRS 915, аналог 4 Вт, Cobra X V4"),
    env: "getfun-f405v3-quad",
    parts: {
      fc: "GETFUN F405V3 (STM32F405, ICM42688P, SPL06)",
      esc: "GETFUN 100A 4in1 (BLHeli_S), Multishot",
      motors: "Surpass Hobby BAT B2810 1300KV",
      props: "7040, 2 лопасти",
      battery: "6S Li-ion 3000–4500 мА·ч",
      gps: "HGLRC M100-5883 (M10 + QMC5883)",
      receiver: "Happymodel ES900RX (ELRS 868/915)",
      radio: "RadioMaster TX12 + ES900 MAX TX 2 Вт",
      camera: "Caddx Ratel 2 V2",
      vtx: "4 Вт, 80 каналов 4.9–6.1 ГГц",
      goggles: "Skyzone Cobra X V4",
    },
  },
];

export function copterFromKit(manifest: Manifest | null, kitId: string, name: string): CopterProject {
  const p = blankCopter(manifest, name);
  const kit = COPTER_KITS.find((k) => k.id === kitId);
  if (kit) {
    p.parts = { ...kit.parts };
    if (findCopterEnv(manifest, kit.env) || !manifest) p.board = kit.env;
  }
  return p;
}

// ---------------- прошивка ----------------

/** То, что приложение вшивает в прошивку коптера (opconfig apply): только паспорт. */
export interface CopterFirmwareConfig {
  vehicle: "copter";
  board: string;
  project?: { plane: string; configHash: string; commit: string | null; boardEnv: string };
}

export function copterConfig(p: CopterProject): CopterFirmwareConfig {
  return { vehicle: "copter", board: p.board };
}

/** Хэш прошивки коптера: сборка, проект и коммит исходников — для паспорта и «изменён». */
export async function copterHash(p: CopterProject, commit: string | null): Promise<string> {
  const text = JSON.stringify({ vehicle: "copter", board: p.board, id: p.id, commit });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
