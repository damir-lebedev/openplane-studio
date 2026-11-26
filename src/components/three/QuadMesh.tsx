// Квадрокоптер X для сцен three.js: лучи крестом (нос — красные лучи, как у
// FPV-рам), корпус, камера, стрелка носа и диски винтов. Нос смотрит к −z.
// Диски отдаются через discs — сцена сама светит и крутит их по моторам.

import { MutableRefObject } from "react";
import * as THREE from "three";

// места моторов квадро X по порядку Betaflight: 1 — задний правый, 2 — передний правый,
// 3 — задний левый, 4 — передний левый (вид сверху, нос — от себя)
export const QUAD = [
  [0.21, 0.21],
  [0.21, -0.21],
  [-0.21, 0.21],
  [-0.21, -0.21],
];

export function QuadMesh({ discs }: { discs?: MutableRefObject<(THREE.Mesh | null)[]> }) {
  return (
    <>
      {QUAD.map(([x, z], k) => {
        const front = z < 0;
        const len = Math.hypot(x, z);
        return (
          <group key={k}>
            <mesh position={[x / 2, 0, z / 2]} rotation={[0, -Math.atan2(z, x), 0]}>
              <boxGeometry args={[len, 0.012, 0.03]} />
              <meshStandardMaterial color={front ? "#e5534b" : "#2b3f56"} roughness={0.6} metalness={0.2} />
            </mesh>
            <mesh position={[x, 0.018, z]}>
              <cylinderGeometry args={[0.022, 0.024, 0.032, 18]} />
              <meshStandardMaterial color="#1c2b3c" roughness={0.4} metalness={0.7} />
            </mesh>
            <mesh
              ref={(el) => {
                if (discs) discs.current[k] = el;
              }}
              position={[x, 0.04, z]}
            >
              <cylinderGeometry args={[0.105, 0.105, 0.004, 40]} />
              <meshStandardMaterial color="#39d0ff" emissive="#39d0ff" emissiveIntensity={0.2} transparent opacity={0.3} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.02, 0]}>
        <boxGeometry args={[0.1, 0.035, 0.16]} />
        <meshStandardMaterial color="#172331" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* камера спереди */}
      <mesh position={[0, 0.03, -0.09]}>
        <boxGeometry args={[0.035, 0.03, 0.03]} />
        <meshStandardMaterial color="#0e161f" />
      </mesh>
      {/* стрелка носа */}
      <mesh position={[0, 0.045, -0.04]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.018, 0.05, 3]} />
        <meshStandardMaterial color="#e5534b" emissive="#e5534b" emissiveIntensity={0.4} />
      </mesh>
    </>
  );
}
