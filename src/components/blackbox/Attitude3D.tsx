// Коптер в 3D в момент курсора: крен, тангаж и курс из журнала, диски
// винтов светятся по команде мотора. Нос — красные лучи, как у FPV-рам.
// Самолётный журнал — тот же коптер не к месту: показывается стрелка.

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import { Flight, valueAt } from "../../core/blackbox";
import { useBb } from "./bbstore";

const DEG = Math.PI / 180;
// места моторов квадро X по порядку Betaflight: 1 — задний правый, 2 — передний правый,
// 3 — задний левый, 4 — передний левый (вид сверху, нос — от себя)
const QUAD = [
  [0.21, 0.21],
  [0.21, -0.21],
  [-0.21, 0.21],
  [-0.21, -0.21],
];

function attitudeAt(flight: Flight, t: number): [number, number, number] {
  const q = flight.series.QSTATE;
  if (q) return [valueAt(q, "roll", t) ?? 0, valueAt(q, "pitch", t) ?? 0, valueAt(q, "yaw", t) ?? 0];
  const c = flight.series.CTRL;
  return [valueAt(c, "roll", t) ?? 0, valueAt(c, "pitch", t) ?? 0, valueAt(c, "yaw", t) ?? 0];
}

function Copter({ flight }: { flight: Flight }) {
  const body = useRef<THREE.Group>(null);
  const discs = useRef<(THREE.Mesh | null)[]>([]);
  const yaw0 = useRef<number | null>(null);
  useFrame(() => {
    const t = useBb.getState().cursor;
    const [roll, pitch, yaw] = attitudeAt(flight, t);
    if (yaw0.current === null) yaw0.current = yaw;
    const g = body.current;
    if (g) {
      // FRD → three (x вправо, y вверх, нос — к −z): курс вокруг y, тангаж вокруг x, крен вокруг −z
      g.rotation.set(pitch * DEG, -(yaw - yaw0.current) * DEG, -roll * DEG, "YXZ");
    }
    for (let m = 0; m < 4; m++) {
      const mesh = discs.current[m];
      if (!mesh) continue;
      const v = valueAt(flight.series.QCTRL, `motor${m + 1}`, t) ?? 0;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.15 + v * 2.2;
      mat.opacity = 0.25 + v * 0.55;
      mesh.rotation.y += v * 0.9;
    }
  });
  return (
    <group ref={body}>
      {/* рама: два луча крестом и корпус */}
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
            <mesh ref={(el) => (discs.current[k] = el)} position={[x, 0.04, z]}>
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
    </group>
  );
}

export function Attitude3D({ flight }: { flight: Flight }) {
  return (
    <div className="bb-3d">
      <Canvas dpr={[1, 2]} camera={{ position: [0.55, 0.42, 0.62], fov: 38, near: 0.01, far: 20 }} gl={{ antialias: true, alpha: true }}>
        <hemisphereLight args={["#e8f4ff", "#26394d", 1.3]} />
        <directionalLight position={[2.5, 4, 2]} intensity={2} />
        <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#9fd4ff" />
        <Copter flight={flight} />
        <gridHelper args={[2, 20, "#2b3f56", "#172331"]} position={[0, -0.18, 0]} />
        <ContactShadows position={[0, -0.18, 0]} opacity={0.4} scale={1.6} blur={2.2} far={0.6} />
        <OrbitControls makeDefault enablePan={false} minDistance={0.4} maxDistance={2.5} />
      </Canvas>
    </div>
  );
}
