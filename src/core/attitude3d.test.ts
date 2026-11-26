import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { discGlow, relYaw, sceneEuler } from "./attitude3d";

function turn(v: [number, number, number], roll: number, pitch: number, yaw: number) {
  const [x, y, z] = sceneEuler(roll, pitch, yaw);
  return new THREE.Vector3(...v).applyEuler(new THREE.Euler(x, y, z, "YXZ"));
}

const NOSE: [number, number, number] = [0, 0, -1];
const RIGHT: [number, number, number] = [1, 0, 0];

describe("attitude3d", () => {
  it("нос вверх — тангаж больше нуля", () => {
    expect(turn(NOSE, 0, 30, 0).y).toBeCloseTo(0.5);
  });
  it("правый край вниз — крен больше нуля", () => {
    expect(turn(RIGHT, 30, 0, 0).y).toBeCloseTo(-0.5);
  });
  it("курс по часовой — нос уходит вправо", () => {
    expect(turn(NOSE, 0, 0, 90).x).toBeCloseTo(1);
  });
  it("крен в осях коптера: развёрнутый на 90° креном опускает правый край", () => {
    const r = turn(RIGHT, 30, 0, 90);
    expect(r.y).toBeCloseTo(-0.5);
  });
  it("курс относительно нуля через 360", () => {
    expect(relYaw(10, 350)).toBe(20);
    expect(relYaw(350, 10)).toBe(-20);
    expect(relYaw(190, 0)).toBe(-170);
  });
  it("свечение винта", () => {
    expect(discGlow(undefined)).toBe(0);
    expect(discGlow(0.4)).toBe(0.4);
    expect(discGlow(-1)).toBe(1);
    expect(discGlow(3)).toBe(1);
  });
});
