// Геометрия самолёта из примитивов: фюзеляж — тело вращения, крылья и
// оперение — профиль NACA, вытянутый по размаху, рули — клин на шарнире.
//
// Оси сцены: нос — к −Z, правое крыло — к +X, верх — +Y (вид сзади: правое
// крыло справа). Размеры — в «метрах» модели, размах около 1,8.

import * as THREE from "three";

/** Профиль NACA 4-знакового семейства: хорда по x (0 — носок), толщина по y. */
export function airfoilShape(chord: number, thickness: number, camber = 0.02, camberPos = 0.4, points = 24): THREE.Shape {
  const upper: [number, number][] = [];
  const lower: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    // сгущение к носку
    const b = (i / points) * Math.PI;
    const xc = (1 - Math.cos(b)) / 2;
    const yt =
      5 * thickness * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
    const yc =
      camber === 0
        ? 0
        : xc < camberPos
          ? (camber / camberPos ** 2) * (2 * camberPos * xc - xc ** 2)
          : (camber / (1 - camberPos) ** 2) * (1 - 2 * camberPos + 2 * camberPos * xc - xc ** 2);
    upper.push([xc * chord, (yc + yt) * chord]);
    lower.push([xc * chord, (yc - yt) * chord]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(upper[0][0], upper[0][1]);
  for (const [x, y] of upper.slice(1)) shape.lineTo(x, y);
  for (const [x, y] of lower.slice(0, -1).reverse()) shape.lineTo(x, y);
  shape.closePath();
  return shape;
}

/**
 * Профиль, вытянутый по размаху вдоль X: носок — на z = 0, задняя кромка —
 * на z = chord (к хвосту), размах от −span/2 до +span/2.
 */
export function spanwise(shape: THREE.Shape, span: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, steps: 1, curveSegments: 4 });
  g.rotateY(-Math.PI / 2);
  g.translate(span / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Руль: клин от шарнира (z = 0) к задней кромке (z = depth), по размаху X. */
export function surfaceWedge(depth: number, hingeThickness: number, span: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, hingeThickness / 2);
  s.lineTo(depth, 0.0015);
  s.lineTo(depth, -0.0015);
  s.lineTo(0, -hingeThickness / 2);
  s.closePath();
  return spanwise(s, span);
}

/** Киль или руль направления: трапеция в плоскости ZY, толщина по X. */
export function finShape(rootChord: number, tipChord: number, height: number, sweep: number, thickness: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(rootChord, 0);
  s.lineTo(sweep + tipChord, height);
  s.lineTo(sweep, height);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false });
  g.rotateY(-Math.PI / 2);
  g.translate(thickness / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

/** Фюзеляж: тело вращения вдоль Z от носа (zNose < 0) к хвосту. */
export function fuselage(zNose: number, zTail: number, radius: number): THREE.BufferGeometry {
  const len = zTail - zNose;
  const pts: THREE.Vector2[] = [];
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // круглый нос, ровная кабина, сужение к хвосту
    const r =
      t < 0.18
        ? radius * Math.sqrt(Math.max(0, 1 - ((0.18 - t) / 0.18) ** 2)) * 0.96 + radius * 0.04
        : t < 0.5
          ? radius
          : radius * (1 - 0.72 * ((t - 0.5) / 0.5) ** 1.3);
    pts.push(new THREE.Vector2(Math.max(r, 0.001), zNose + t * len));
  }
  const g = new THREE.LatheGeometry(pts, 40);
  // ось вращения Y → Z (нос к −Z)
  g.rotateX(Math.PI / 2);
  g.scale(0.92, 1.08, 1);
  g.computeVertexNormals();
  return g;
}

/** Лопасть винта: тонкая скрученная пластина от втулки наружу по +Y. */
export function propBlade(length: number, width: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-width * 0.35, 0);
  s.quadraticCurveTo(-width * 0.6, length * 0.45, -width * 0.25, length);
  s.lineTo(width * 0.2, length);
  s.quadraticCurveTo(width * 0.55, length * 0.4, width * 0.35, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: false });
  g.translate(0, 0, -0.0015);
  g.rotateY(0.35); // шаг винта
  return g;
}
