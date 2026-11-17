import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  defaultRadioMap,
  gamepadChannels,
  gamepadToggles,
  keyboardChannels,
  keyboardStep,
  keyboardToggle,
  modeOf,
  nedToScene,
  padKind,
  pressedEdges,
  quatToScene,
  radioChannels,
  rcCommand,
} from "./sim";

const pad = (axes: number[], pressed: number[] = []) => ({
  axes,
  buttons: Array.from({ length: 12 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

describe("каналы пульта для симулятора", () => {
  it("пульт-джойстик: ось k — канал k, реверс и кнопка вместо оси", () => {
    const map = defaultRadioMap();
    map[1] = { kind: "axis", index: 1, invert: true };
    map[5] = { kind: "button", index: 3, invert: false };
    const ch = radioChannels(pad([1, 0.5, -1, 0, 1, -1, 0, 1], [3]), map);
    expect(ch.slice(0, 8)).toEqual([2000, 1250, 1000, 1500, 2000, 2000, 1500, 2000]);
    expect(ch[8]).toBe(1500); // крутилка без источника — середина
  });

  it("пульт и геймпад различаются по имени и раскладке", () => {
    expect(padKind({ id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", mapping: "standard" })).toBe("gamepad");
    expect(padKind({ id: "RadioMaster TX12 Joystick (Vendor: 1209 Product: 4f54)", mapping: "" })).toBe("radio");
  });

  it("геймпад Mode 2: левый стик — газ и рысканье, A — ARM, кнопки — режимы", () => {
    let t = { arm: false, mode: "ANGLE" as const } as { arm: boolean; mode: "ANGLE" | "ALTHOLD" | "ACRO" };
    t = gamepadToggles(t, pressedEdges([true, false, false, true], [false, false, false, false]));
    expect(t).toEqual({ arm: true, mode: "ALTHOLD" });
    const ch = gamepadChannels(pad([0.03, 1, 0.5, -1]), t);
    expect(ch[2]).toBe(1000); // стик газа вниз
    expect(ch[3]).toBe(1500); // мёртвая зона рысканья
    expect(ch[0]).toBeGreaterThan(1700);
    expect(ch[1]).toBe(2000); // правый стик от себя — тангаж вперёд
    expect(ch[4]).toBe(2000);
    expect(modeOf(ch[6])).toBe("ALTHOLD");
  });

  it("клавиатура: газ держится, ARM сбрасывает газ, стрелки к центру", () => {
    let k = { throttle: 0.4, toggles: { arm: false, mode: "ANGLE" as const } } as Parameters<typeof keyboardStep>[0];
    k = keyboardToggle(k, "Space");
    expect(k.toggles.arm).toBe(true);
    expect(k.throttle).toBe(0);
    k = keyboardStep(k, new Set(["KeyW"]), 1);
    expect(k.throttle).toBeCloseTo(0.5);
    const ch = keyboardChannels(k, new Set(["ArrowUp"]));
    expect(ch[2]).toBe(1500);
    expect(ch[1]).toBe(1800);
    expect(keyboardChannels(k, new Set())[1]).toBe(1500);
    expect(rcCommand([1500, 1000.4])).toBe("sim rc 1500,1000");
  });
});

describe("сцена симулятора", () => {
  it("NED → three: север вглубь (−z), восток вправо, вверх — +y", () => {
    expect(nedToScene([10, 2, -5])).toEqual([2, 5, -10]);
  });

  it("кватернион: нос модели (−z) смотрит туда же, куда нос рамы в NED", () => {
    // рысканье 90° (нос на восток), затем тангаж 20° вверх
    const yaw = Math.PI / 4, pitch = (20 * Math.PI) / 360;
    const qYaw = [Math.cos(yaw), 0, 0, Math.sin(yaw)];
    const qPitch = [Math.cos(pitch), 0, Math.sin(pitch), 0];
    const mul = (a: number[], b: number[]) => [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
    const q = mul(qYaw, qPitch);
    const [x, y, z, w] = quatToScene(q);
    const nose = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(x, y, z, w));
    // на восток (+x) и вверх (+y) на 20°
    expect(nose.x).toBeCloseTo(Math.cos((20 * Math.PI) / 180), 5);
    expect(nose.y).toBeCloseTo(Math.sin((20 * Math.PI) / 180), 5);
    expect(nose.z).toBeCloseTo(0, 5);
    // правый борт после рысканья 90° — на юг (+z)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(x, y, z, w));
    expect(right.z).toBeCloseTo(1, 5);
  });
});
