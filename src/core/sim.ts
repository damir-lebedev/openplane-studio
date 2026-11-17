// Симулятор (SITL): каналы пульта из того, что есть у пилота, и перевод
// положения модели в сцену three.js.
//
// Каналы — как у прошивки по умолчанию (AETR1234, мкс): 0 крен, 1 тангаж,
// 2 газ, 3 рысканье, 4 ARM (CH5), 5 SwB, 6 режим (CH7: ANGLE / ALTHOLD /
// ACRO), 7 SwD, 8–9 крутилки. Источники:
//   • пульт в режиме USB-джойстика (EdgeTX/OpenTX): ось k — канал k, как
//     в микшере пульта; у каждого канала можно выбрать ось/кнопку и реверс;
//   • геймпад (раскладка "standard", Xbox): Mode 2 — левый стик газ/рысканье,
//     правый — тангаж/крен; A — ARM, X/Y/B — ANGLE/ALTHOLD/ACRO;
//   • клавиатура: W/S газ (держится), A/D рысканье, стрелки — крен/тангаж,
//     пробел — ARM, 1/2/3 — режим.

export const SIM_CHANNELS = 10;
export const MODE_US = { ANGLE: 1000, ALTHOLD: 1500, ACRO: 2000 } as const;
export type SimMode = keyof typeof MODE_US;

export type InputKind = "radio" | "gamepad" | "keyboard";

export interface ChannelSource {
  kind: "axis" | "button" | "none";
  index: number;
  invert: boolean;
}

/** Пульт как джойстик: источник каждого канала. */
export type RadioMap = ChannelSource[];

export function defaultRadioMap(): RadioMap {
  return Array.from({ length: SIM_CHANNELS }, (_, i) => ({ kind: i < 8 ? "axis" : "none", index: i, invert: false }) as ChannelSource);
}

/** Пульт или геймпад: геймпад браузер узнаёт по раскладке "standard" или имени. */
export function padKind(pad: { id: string; mapping: string }): "radio" | "gamepad" {
  if (/xbox|xinput|dualshock|dualsense|playstation|wireless controller|gamepad/i.test(pad.id)) return "gamepad";
  if (pad.mapping === "standard") return "gamepad";
  return "radio";
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** −1..1 → 1000..2000 мкс. */
export function toUs(v: number): number {
  return Math.round(1500 + 500 * clamp(v, -1, 1));
}

export function neutral(): number[] {
  const ch = new Array(SIM_CHANNELS).fill(1500);
  ch[2] = 1000;
  ch[4] = 1000;
  ch[5] = 1000;
  ch[6] = MODE_US.ANGLE;
  ch[7] = 1000;
  return ch;
}

export interface PadState {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export function radioChannels(pad: PadState, map: RadioMap): number[] {
  const ch = neutral();
  map.forEach((src, i) => {
    if (i >= SIM_CHANNELS || src.kind === "none") return;
    let v: number;
    if (src.kind === "axis") {
      if (src.index >= pad.axes.length) return;
      v = pad.axes[src.index];
    } else {
      const b = pad.buttons[src.index];
      if (!b) return;
      v = b.pressed ? 1 : -1;
    }
    ch[i] = toUs(src.invert ? -v : v);
  });
  return ch;
}

/** Тумблеры геймпада и клавиатуры: ARM и режим — состояние, а не положение. */
export interface Toggles {
  arm: boolean;
  mode: SimMode;
}

const DEAD = 0.06;
const dead = (v: number) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));

/** Нажатия кнопок с прошлого опроса (фронт). */
export function pressedEdges(now: readonly boolean[], before: readonly boolean[]): number[] {
  const out: number[] = [];
  now.forEach((p, i) => p && !before[i] && out.push(i));
  return out;
}

export function gamepadToggles(t: Toggles, edges: number[]): Toggles {
  let { arm, mode } = t;
  for (const b of edges) {
    if (b === 0 || b === 9) arm = !arm; // A или Start
    else if (b === 2) mode = "ANGLE"; // X
    else if (b === 3) mode = "ALTHOLD"; // Y
    else if (b === 1) mode = "ACRO"; // B
  }
  return { arm, mode };
}

export function gamepadChannels(pad: PadState, t: Toggles): number[] {
  const ch = neutral();
  const ax = (i: number) => dead(pad.axes[i] ?? 0);
  ch[0] = toUs(ax(2));
  ch[1] = toUs(-ax(3));
  ch[2] = toUs(-(pad.axes[1] ?? 0)); // газ без мёртвой зоны: стик вниз — 1000
  ch[3] = toUs(ax(0));
  ch[4] = t.arm ? 2000 : 1000;
  ch[6] = MODE_US[t.mode];
  return ch;
}

/** Клавиатура: газ держится там, где отпустили; остальное — к центру. */
export interface KeyState {
  throttle: number; // 0..1
  toggles: Toggles;
}

export function keyboardStep(k: KeyState, down: ReadonlySet<string>, dt: number): KeyState {
  let throttle = k.throttle;
  if (down.has("KeyW")) throttle += 0.5 * dt;
  if (down.has("KeyS")) throttle -= 0.5 * dt;
  return { ...k, throttle: clamp(throttle, 0, 1) };
}

export function keyboardToggle(k: KeyState, code: string): KeyState {
  const t = { ...k.toggles };
  if (code === "Space") t.arm = !t.arm;
  else if (code === "Digit1") t.mode = "ANGLE";
  else if (code === "Digit2") t.mode = "ALTHOLD";
  else if (code === "Digit3") t.mode = "ACRO";
  else return k;
  // ARM — только с газом внизу, как требует прошивка: пробел сам сбрасывает газ
  return { throttle: t.arm && !k.toggles.arm ? 0 : k.throttle, toggles: t };
}

export function keyboardChannels(k: KeyState, down: ReadonlySet<string>): number[] {
  const ch = neutral();
  const axis = (minus: string, plus: string) => (down.has(plus) ? 1 : 0) - (down.has(minus) ? 1 : 0);
  ch[0] = toUs(0.6 * axis("ArrowLeft", "ArrowRight"));
  ch[1] = toUs(0.6 * axis("ArrowDown", "ArrowUp"));
  ch[2] = toUs(k.throttle * 2 - 1);
  ch[3] = toUs(0.7 * axis("KeyA", "KeyD"));
  ch[4] = k.toggles.arm ? 2000 : 1000;
  ch[6] = MODE_US[k.toggles.mode];
  return ch;
}

/** Строка симулятору (src/sitl/main.cpp): каналы пульта. */
export function rcCommand(ch: number[]): string {
  return `sim rc ${ch.map((v) => Math.round(v)).join(",")}`;
}

export function modeOf(us: number): SimMode {
  return us < 1300 ? "ANGLE" : us < 1700 ? "ALTHOLD" : "ACRO";
}

// ---------------- сцена ----------------

/** NED (север, восток, вниз) → three.js (x восток, y вверх, z юг). */
export function nedToScene(p: readonly number[]): [number, number, number] {
  return [p[1], -p[2], -p[0]];
}

/**
 * Кватернион рамы FRD→NED → three.js (модель: нос −z, право +x, верх +y).
 * Обе системы переводятся одним поворотом M (x=E, y=−D, z=−N; у рамы
 * x=право, y=−низ, z=−нос), так что R' = M·R·Mᵀ: векторная часть
 * поворачивается тем же M, скаляр остаётся. Возвращает x, y, z, w (порядок three).
 */
export function quatToScene(q: readonly number[]): [number, number, number, number] {
  const [w, x, y, z] = q;
  return [y, -z, -x, w];
}

/** Скорость над землёй и вертикальная, м/с. */
export function speeds(vel: readonly number[]): { ground: number; climb: number } {
  return { ground: Math.hypot(vel[0], vel[1]), climb: -vel[2] };
}
