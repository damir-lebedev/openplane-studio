// P63 · Порты: что на каком UART полётника. Прошивка держит роли
// настройками serial_*_uart (номер UART, 0 — нет), список разведённых UART
// присылает в заголовке "@params" (uarts: [номер, есть RX, есть TX]).
// Здесь — карта ролей, команды переназначения (сначала освободить, потом
// занять: прошивка не даёт двух ролей на одном UART) и строки `serial`
// как у Betaflight — для тех, кто переносит diff.

import { N_ } from "../i18n";
import type { CopterBoard } from "./copterParams";

export const PORT_ROLES = ["rx", "gps", "msp", "esc", "vtx"] as const;
export type PortRole = (typeof PORT_ROLES)[number];

export interface PortRoleInfo {
  param: string;
  title: string;
  hint: string;
  needRx: boolean;
  needTx: boolean;
  /** бит функции в `serial` Betaflight */
  bit: number;
}

export const ROLE_INFO: Record<PortRole, PortRoleInfo> = {
  rx: { param: "serial_rx_uart", title: N_("Приёмник"), hint: N_("CRSF, SBUS или iBUS: провод TX приёмника — на RX порта"), needRx: true, needTx: false, bit: 64 },
  gps: { param: "serial_gps_uart", title: N_("GPS"), hint: N_("TX модуля — на RX порта, RX модуля — на TX"), needRx: true, needTx: false, bit: 2 },
  msp: { param: "serial_msp_uart", title: N_("MSP: цифровые очки"), hint: N_("DJI, Walksnail, HDZero: OSD и ответы на их опрос, оба провода"), needRx: true, needTx: true, bit: 1 },
  esc: { param: "serial_esc_uart", title: N_("Телеметрия ESC"), hint: N_("провод TLM регуляторов: порт занят, данные прошивка пока не читает"), needRx: true, needTx: false, bit: 1024 },
  vtx: { param: "serial_vtx_uart", title: N_("SmartAudio / Tramp"), hint: N_("провод управления видеопередатчиком — на TX порта"), needRx: false, needTx: true, bit: 2048 },
};

const TRAMP_BIT = 8192;

export interface BoardUart {
  n: number;
  rx: boolean;
  tx: boolean;
}

/** UART платы из заголовка; пусто — старая прошивка или сборка без портов. */
export function boardUarts(b: CopterBoard): BoardUart[] {
  const list = b.header?.uarts ?? [];
  return list.map(([n, rx, tx]) => ({ n, rx: !!rx, tx: !!tx }));
}

/** Роль → номер UART (0 — нет) по настройкам платы. */
export function portMap(b: CopterBoard, pick: "value" | "default" = "value"): Record<PortRole, number> {
  const m = {} as Record<PortRole, number>;
  for (const r of PORT_ROLES) m[r] = Number(b.params[ROLE_INFO[r].param]?.[pick] ?? 0);
  return m;
}

export function roleOn(map: Record<PortRole, number>, n: number): PortRole | null {
  return PORT_ROLES.find((r) => map[r] === n) ?? null;
}

/** Почему роль не встанет на этот UART (нет ножки); null — встанет. */
export function roleProblem(u: BoardUart, role: PortRole): string | null {
  const info = ROLE_INFO[role];
  if (info.needRx && !u.rx) return N_("у этого UART не разведён RX");
  if (info.needTx && !u.tx) return N_("у этого UART не разведён TX");
  return null;
}

/**
 * Команды set, чтобы на UART n стояла роль role (null — освободить).
 * Порядок важен: сначала снять то, что мешает, потом занять.
 */
export function assignCommands(map: Record<PortRole, number>, n: number, role: PortRole | null): [string, number][] {
  const out: [string, number][] = [];
  const current = roleOn(map, n);
  if (current === role) return out;
  if (current) out.push([ROLE_INFO[current].param, 0]);
  if (role) out.push([ROLE_INFO[role].param, n]);
  return out;
}

/** Строки `serial` как в CLI Betaflight (id 0 = UART1); vtx_protocol TRAMP — бит Tramp. */
export function serialLines(b: CopterBoard): string[] {
  const map = portMap(b);
  const tramp = String(b.params.vtx_protocol?.value ?? "") === "TRAMP";
  return boardUarts(b).map((u) => {
    let mask = 0;
    for (const r of PORT_ROLES) if (map[r] === u.n) mask |= r === "vtx" && tramp ? TRAMP_BIT : ROLE_INFO[r].bit;
    return `serial ${u.n - 1} ${mask} 115200 57600 0 115200`;
  });
}

/** Роли не на своих местах по умолчанию (для подсказки «как в прошивке платы»). */
export function movedRoles(b: CopterBoard): PortRole[] {
  const now = portMap(b);
  const def = portMap(b, "default");
  return PORT_ROLES.filter((r) => now[r] !== def[r]);
}
