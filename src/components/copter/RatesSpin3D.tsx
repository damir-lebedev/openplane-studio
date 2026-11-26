// «Расходы» (053): 3D-коптер крутится со скоростью из кривой расходов, как в
// акро: стик держат — вращается, отпустили — стоит. Чтобы модель не висела
// вверх ногами, после секунды без стиков она плавно встаёт в горизонт.

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { MutableRefObject, useEffect, useRef } from "react";
import * as THREE from "three";

import { bodyOmega, Sticks } from "../../core/ratesSpin";
import { QuadMesh } from "../three/QuadMesh";

const IDENTITY = new THREE.Quaternion();

function Spinner({ rates, reset }: { rates: MutableRefObject<Sticks>; reset: number }) {
  const body = useRef<THREE.Group>(null);
  const discs = useRef<(THREE.Mesh | null)[]>([]);
  const idle = useRef(0);
  const axis = useRef(new THREE.Vector3());
  const dq = useRef(new THREE.Quaternion());
  useEffect(() => {
    body.current?.quaternion.identity();
  }, [reset]);
  useFrame((_, delta) => {
    const g = body.current;
    if (!g) return;
    const dt = Math.min(0.05, delta);
    const [x, y, z] = bodyOmega(rates.current);
    const w = Math.hypot(x, y, z);
    if (w > 0.02) {
      idle.current = 0;
      axis.current.set(x / w, y / w, z / w);
      dq.current.setFromAxisAngle(axis.current, w * dt);
      g.quaternion.multiply(dq.current);   // в осях самого коптера, как гироскоп
    } else {
      idle.current += dt;
      if (idle.current > 1) g.quaternion.slerp(IDENTITY, Math.min(1, dt * 3));
    }
    for (const d of discs.current) if (d) d.rotation.y += 0.7;
  });
  return (
    <group ref={body}>
      <QuadMesh discs={discs} />
    </group>
  );
}

export function RatesSpin3D({ rates, reset }: { rates: MutableRefObject<Sticks>; reset: number }) {
  return (
    <div className="rates-3d">
      <Canvas dpr={[1, 2]} camera={{ position: [0.5, 0.38, 0.58], fov: 40, near: 0.01, far: 20 }} gl={{ antialias: true, alpha: true }}>
        <hemisphereLight args={["#e8f4ff", "#26394d", 1.3]} />
        <directionalLight position={[2.5, 4, 2]} intensity={2} />
        <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#9fd4ff" />
        <Spinner rates={rates} reset={reset} />
        <gridHelper args={[2, 20, "#2b3f56", "#172331"]} position={[0, -0.22, 0]} />
        <ContactShadows position={[0, -0.22, 0]} opacity={0.35} scale={1.6} blur={2.2} far={0.6} />
        <OrbitControls makeDefault enablePan={false} enableZoom={false} />
      </Canvas>
    </div>
  );
}
