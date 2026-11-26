// «Настройка» (072): 3D-коптер по живой ориентации с платы. Сверху — сама
// плата, повёрнутая на align_board_* относительно рамы; диски винтов светятся
// и крутятся по командам моторов. Курс — от «нос от себя» (кнопка), чтобы без
// компаса модель не смотрела вбок.

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { MutableRefObject, useRef } from "react";
import * as THREE from "three";

import { CopterLive } from "../../api";
import { boardEuler, discGlow, relYaw, sceneEuler } from "../../core/attitude3d";
import { QuadMesh } from "../three/QuadMesh";

export type BoardAlign = { roll: number; pitch: number; yaw: number };

function Body({ live, yaw0, align }: { live: MutableRefObject<CopterLive | null>; yaw0: MutableRefObject<number | null>; align: BoardAlign }) {
  const body = useRef<THREE.Group>(null);
  const discs = useRef<(THREE.Mesh | null)[]>([]);
  const target = useRef(new THREE.Quaternion());
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  useFrame((_, delta) => {
    const g = body.current;
    const l = live.current;
    if (!g) return;
    const dt = Math.min(0.05, delta);
    if (l) {
      if (yaw0.current === null) yaw0.current = l.att[2];
      const [x, y, z] = sceneEuler(l.att[0], l.att[1], relYaw(l.att[2], yaw0.current));
      euler.current.set(x, y, z, "YXZ");
      target.current.setFromEuler(euler.current);
      // кадры идут ~20 Гц, сцена — 60: догоняем плавно, но без заметной задержки
      g.quaternion.slerp(target.current, Math.min(1, dt * 18));
    }
    discs.current.forEach((d, k) => {
      if (!d) return;
      const glow = discGlow(l?.motors?.[k]);
      d.rotation.y += (l?.turtle ? -1 : 1) * (0.05 + glow * 0.9);
      const m = d.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.2 + glow * 1.6;
      m.opacity = 0.3 + glow * 0.4;
    });
  });
  const [bx, by, bz] = boardEuler(align.roll, align.pitch, align.yaw);
  return (
    <group ref={body}>
      <QuadMesh discs={discs} />
      {/* полётник на раме: стрелка — куда у него «вперёд» */}
      <group position={[0, 0.062, 0]} rotation={new THREE.Euler(bx, by, bz, "YXZ")}>
        <mesh>
          <boxGeometry args={[0.07, 0.005, 0.07]} />
          <meshStandardMaterial color="#1f6b45" roughness={0.6} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.006, -0.012]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.012, 0.03, 3]} />
          <meshStandardMaterial color="#39d0ff" emissive="#39d0ff" emissiveIntensity={0.6} />
        </mesh>
      </group>
    </group>
  );
}

export function LiveQuad3D({ live, yaw0, align }: { live: MutableRefObject<CopterLive | null>; yaw0: MutableRefObject<number | null>; align: BoardAlign }) {
  return (
    <div className="rates-3d live-3d">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.42, 0.62], fov: 40, near: 0.01, far: 20 }} gl={{ antialias: true, alpha: true }}>
        <hemisphereLight args={["#e8f4ff", "#26394d", 1.3]} />
        <directionalLight position={[2.5, 4, 2]} intensity={2} />
        <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#9fd4ff" />
        <Body live={live} yaw0={yaw0} align={align} />
        <gridHelper args={[2, 20, "#2b3f56", "#172331"]} position={[0, -0.22, 0]} />
        <ContactShadows position={[0, -0.22, 0]} opacity={0.35} scale={1.6} blur={2.2} far={0.6} />
        <OrbitControls makeDefault enablePan={false} enableZoom={false} />
      </Canvas>
    </div>
  );
}
