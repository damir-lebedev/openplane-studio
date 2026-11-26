// Коптер в 3D в момент курсора: крен, тангаж и курс из журнала, диски
// винтов светятся по команде мотора. Нос — красные лучи, как у FPV-рам.
// Самолётный журнал — тот же коптер не к месту: показывается стрелка.

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";

import { Flight, valueAt } from "../../core/blackbox";
import { useBb } from "./bbstore";
import { QuadMesh } from "../three/QuadMesh";

const DEG = Math.PI / 180;

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
      <QuadMesh discs={discs} />
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
