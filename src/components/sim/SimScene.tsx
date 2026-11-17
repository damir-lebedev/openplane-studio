// 3D-сцена симулятора: поле, деревья, ворота, коптер по кадрам "@sim" и
// камеры (сзади, FPV, с земли). Кадры приходят ~30 раз в секунду — между
// ними положение продолжается по скорости, ориентация догоняет плавно.
import { Sky } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { MutableRefObject, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { SimFrame } from "../../api";
import { nedToScene, quatToScene } from "../../core/sim";

export type SimCamera = "chase" | "fpv" | "ground";

export interface FrameRef {
  frame: SimFrame | null;
  /** performance.now() прихода кадра */
  at: number;
  /** счётчик «на старт»: след стирается */
  resets: number;
}

const ARM_M = 0.11; // центр — мотор, 5"
const PROP_R = 0.064;
const MODEL_LIFT = 0.035; // низ рамы ниже центра масс
const PILOT: [number, number, number] = [0, 1.7, 7]; // пилот в 7 м южнее площадки

// ---------------- мир ----------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function useGrassTexture() {
  return useMemo(() => {
    const size = 512;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d")!;
    g.fillStyle = "#4f7a3a";
    g.fillRect(0, 0, size, size);
    const r = rng(7);
    for (let i = 0; i < 9000; i++) {
      const shade = 60 + Math.floor(r() * 60);
      g.fillStyle = `rgba(${shade - 20},${shade + 50},${shade - 30},${0.25 + r() * 0.35})`;
      const w = 1 + r() * 4;
      g.fillRect(r() * size, r() * size, w, w);
    }
    // тропинки покошенной травы — глазу есть за что зацепиться на скорости
    g.strokeStyle = "rgba(170,200,120,0.07)";
    g.lineWidth = 6;
    for (let i = 0; i <= size; i += size / 4) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, size);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(size, i);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1000, 1000); // плитка 20 м
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);
}

function Ground() {
  const grass = useGrassTexture();
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[20000, 20000]} />
      <meshStandardMaterial map={grass} roughness={1} />
    </mesh>
  );
}

function Pad() {
  return (
    <group position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh receiveShadow>
        <circleGeometry args={[1.1, 48]} />
        <meshStandardMaterial color="#2a2f36" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0, 0.002]}>
        <ringGeometry args={[0.85, 0.95, 48]} />
        <meshStandardMaterial color="#f0c040" />
      </mesh>
      {[
        [-0.25, 0, 0.08, 0.7],
        [0.25, 0, 0.08, 0.7],
        [0, 0, 0.5, 0.08],
      ].map(([x, y, w, h], i) => (
        <mesh key={i} position={[x, y, 0.003]}>
          <planeGeometry args={[w, h]} />
          <meshStandardMaterial color="#e8eef4" />
        </mesh>
      ))}
    </group>
  );
}

function Trees() {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const COUNT = 320;
  useEffect(() => {
    const r = rng(42);
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const a = r() * Math.PI * 2;
      const d = 14 + Math.pow(r(), 0.7) * 260;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const h = 4 + r() * 8;
      m.compose(new THREE.Vector3(x, h * 0.25, z), new THREE.Quaternion(), new THREE.Vector3(0.25 + h * 0.02, h * 0.5, 0.25 + h * 0.02));
      trunks.current?.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, h * 0.6, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)), new THREE.Vector3(h * 0.32, h * 0.8, h * 0.32));
      crowns.current?.setMatrixAt(i, m);
      crowns.current?.setColorAt(i, color.setHSL(0.27 + r() * 0.08, 0.45, 0.18 + r() * 0.12));
    }
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
    if (crowns.current) {
      crowns.current.instanceMatrix.needsUpdate = true;
      if (crowns.current.instanceColor) crowns.current.instanceColor.needsUpdate = true;
    }
  }, []);
  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, COUNT]} castShadow>
        <cylinderGeometry args={[0.5, 0.7, 1, 6]} />
        <meshStandardMaterial color="#5a4030" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[undefined, undefined, COUNT]} castShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
    </>
  );
}

/** Гоночные ворота по кругу ~25 м: есть куда пролететь. */
function Gates() {
  const gates = useMemo(() => {
    const out: { pos: [number, number, number]; rot: number; color: string }[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const d = 22 + (i % 2) * 6;
      out.push({ pos: [Math.sin(a) * d, 0, -Math.cos(a) * d], rot: -a, color: i % 2 ? "#ff7a1a" : "#22c7f0" });
    }
    return out;
  }, []);
  const W = 1.8, H = 1.8, T = 0.12, LEG = 0.6;
  return (
    <>
      {gates.map((g, i) => (
        <group key={i} position={g.pos} rotation={[0, g.rot, 0]}>
          {[
            [0, LEG + H, W + T, T],
            [-W / 2, LEG + H / 2, T, H],
            [W / 2, LEG + H / 2, T, H],
            [0, LEG, W + T, T],
          ].map(([x, y, w, h], k) => (
            <mesh key={k} position={[x, y, 0]} castShadow>
              <boxGeometry args={[w, h, T]} />
              <meshStandardMaterial color={g.color} emissive={g.color} emissiveIntensity={0.15} roughness={0.6} />
            </mesh>
          ))}
          {[-W / 2, W / 2].map((x) => (
            <mesh key={x} position={[x, LEG / 2, 0]}>
              <boxGeometry args={[0.06, LEG, 0.06]} />
              <meshStandardMaterial color="#9aa4ae" />
            </mesh>
          ))}
        </group>
      ))}
    </>
  );
}

// ---------------- коптер ----------------

const MOTORS: [number, number, 1 | -1][] = [
  // порядок Betaflight Quad X: 1 зад-право, 2 перед-право, 3 зад-лево, 4 перед-лево (нос −z)
  [1, 1, -1],
  [1, -1, 1],
  [-1, 1, 1],
  [-1, -1, -1],
];

function Prop({ index, frameRef, dir }: { index: number; frameRef: MutableRefObject<FrameRef>; dir: 1 | -1 }) {
  const blades = useRef<THREE.Group>(null);
  const disc = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    const hz = frameRef.current.frame?.hz[index] ?? 0;
    if (blades.current) {
      // как видит камера: быстрые винты «стоят» и размываются в диск
      blades.current.rotation.y += dir * Math.min(hz, 9) * Math.PI * 2 * dt;
      blades.current.visible = hz < 60;
    }
    if (disc.current) {
      const m = disc.current.material as THREE.MeshBasicMaterial;
      m.opacity = Math.min(0.35, hz / 300);
      disc.current.visible = hz > 5;
    }
  });
  return (
    <group position={[0, 0.03, 0]}>
      <group ref={blades}>
        {[0, Math.PI].map((a) => (
          <mesh key={a} rotation={[0.15 * dir, a, 0]} position={[Math.cos(a) * PROP_R * 0.5, 0, -Math.sin(a) * PROP_R * 0.5]}>
            <boxGeometry args={[PROP_R, 0.003, 0.014]} />
            <meshStandardMaterial color="#39d0ff" transparent opacity={0.85} />
          </mesh>
        ))}
      </group>
      <mesh ref={disc} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[PROP_R, 32]} />
        <meshBasicMaterial color="#9fe8ff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Quad({ frameRef }: { frameRef: MutableRefObject<FrameRef> }) {
  const led = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    const arm = frameRef.current.frame?.arm;
    if (led.current) {
      led.current.color.set(arm ? "#ff3030" : "#30ff60");
      led.current.emissive.set(arm ? "#ff2020" : "#20ff50");
      led.current.emissiveIntensity = arm ? 2 : 0.6 + 0.6 * Math.sin(clock.elapsedTime * 4);
    }
  });
  const d = ARM_M / Math.SQRT2;
  return (
    <group>
      {/* рама */}
      <mesh castShadow>
        <boxGeometry args={[0.04, 0.012, 0.11]} />
        <meshStandardMaterial color="#1b1f24" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.02, 0.005]} castShadow>
        <boxGeometry args={[0.036, 0.026, 0.07]} />
        <meshStandardMaterial color="#2c3440" roughness={0.45} />
      </mesh>
      {/* батарея сверху */}
      <mesh position={[0, 0.048, 0.008]} castShadow>
        <boxGeometry args={[0.035, 0.028, 0.075]} />
        <meshStandardMaterial color="#d8a020" roughness={0.6} />
      </mesh>
      {MOTORS.map(([x, z], i) => (
        <mesh key={i} position={[(x * d) / 2, 0, (z * d) / 2]} rotation={[0, Math.atan2(x, z), 0]} castShadow>
          <boxGeometry args={[0.014, 0.006, ARM_M]} />
          <meshStandardMaterial color="#1b1f24" roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      {MOTORS.map(([x, z, dir], i) => (
        <group key={i} position={[x * d, 0.008, z * d]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.012, 0.012, 0.016, 16]} />
            <meshStandardMaterial color="#8a96a4" metalness={0.8} roughness={0.25} />
          </mesh>
          <Prop index={i} frameRef={frameRef} dir={dir} />
        </group>
      ))}
      {/* камера FPV спереди */}
      <mesh position={[0, 0.02, -0.045]} rotation={[0.45, 0, 0]}>
        <boxGeometry args={[0.02, 0.02, 0.015]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      {/* светодиод сзади: зелёный мигает — DISARM, красный — ARM */}
      <mesh position={[0, 0.012, 0.058]}>
        <boxGeometry args={[0.018, 0.006, 0.006]} />
        <meshStandardMaterial ref={led} color="#30ff60" emissive="#20ff50" />
      </mesh>
    </group>
  );
}

// ---------------- движение, камеры, след ----------------

const TRAIL = 900;

function Rig({ frameRef, camera }: { frameRef: MutableRefObject<FrameRef>; camera: SimCamera }) {
  const quad = useRef<THREE.Group>(null);
  const shadowBlob = useRef<THREE.Mesh>(null);
  const sun = useRef<THREE.DirectionalLight>(null);
  const { camera: cam } = useThree();
  const trail = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);
  const trailLine = useMemo(() => {
    const line = new THREE.Line(trail, new THREE.LineBasicMaterial({ color: "#39d0ff", transparent: true, opacity: 0.55 }));
    line.frustumCulled = false; // границы геометрии растут с каждым кадром
    return line;
  }, [trail]);
  const trailState = useRef({ count: 0, last: new THREE.Vector3(1e9, 0, 0), resets: 0 });
  const target = useMemo(() => new THREE.Quaternion(), []);
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3(), q: new THREE.Quaternion(), tilt: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (25 * Math.PI) / 180) }), []);

  useFrame((_, dt) => {
    const ref = frameRef.current;
    const f = ref.frame;
    const g = quad.current;
    if (!g) return;
    if (f) {
      const age = Math.min(0.1, Math.max(0, (performance.now() - ref.at) / 1000));
      const moving = !f.gnd;
      const p = nedToScene([f.pos[0] + (moving ? f.vel[0] * age : 0), f.pos[1] + (moving ? f.vel[1] * age : 0), f.pos[2] + (moving ? f.vel[2] * age : 0)]);
      g.position.set(p[0], p[1] + MODEL_LIFT, p[2]);
      const [x, y, z, w] = quatToScene(f.q);
      target.set(x, y, z, w);
      g.quaternion.slerp(target, 1 - Math.exp(-dt * 30));
    }

    // тень-пятно и солнце с тенью — за коптером
    const h = Math.max(0, g.position.y - MODEL_LIFT);
    if (shadowBlob.current) {
      shadowBlob.current.position.set(g.position.x, 0.01, g.position.z);
      const s = 1 + h * 0.15;
      shadowBlob.current.scale.set(s, s, s);
      (shadowBlob.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.45 - h * 0.02);
    }
    if (sun.current) {
      sun.current.position.set(g.position.x + 30, g.position.y + 60, g.position.z + 20);
      sun.current.target.position.copy(g.position);
      sun.current.target.updateMatrixWorld();
    }

    // след полёта
    const tr = trailState.current;
    if (ref.resets !== tr.resets) {
      tr.resets = ref.resets;
      tr.count = 0;
      tr.last.set(1e9, 0, 0);
    }
    if (f && !f.gnd && g.position.distanceTo(tr.last) > 0.25) {
      const arr = trail.attributes.position.array as Float32Array;
      if (tr.count >= TRAIL) {
        arr.copyWithin(0, 3);
        tr.count = TRAIL - 1;
      }
      arr.set([g.position.x, g.position.y, g.position.z], tr.count * 3);
      tr.count++;
      tr.last.copy(g.position);
      trail.setDrawRange(0, tr.count);
      trail.attributes.position.needsUpdate = true;
    }

    // камера
    const pc = cam as THREE.PerspectiveCamera;
    let fov = 70;
    if (camera === "fpv") {
      tmp.q.copy(g.quaternion).multiply(tmp.tilt);
      pc.quaternion.copy(tmp.q);
      tmp.v.set(0, 0.03, -0.05).applyQuaternion(g.quaternion).add(g.position);
      pc.position.copy(tmp.v);
      fov = 105;
    } else if (camera === "chase") {
      // за хвостом по курсу, плавно; на земле курс тоже виден
      const nose = tmp.w.set(0, 0, -1).applyQuaternion(g.quaternion);
      nose.y = 0;
      if (nose.lengthSq() < 1e-4) nose.set(0, 0, -1);
      nose.normalize();
      const want = tmp.v.copy(g.position).addScaledVector(nose, -1.3);
      want.y = Math.max(0.25, g.position.y + 0.45);
      pc.position.lerp(want, 1 - Math.exp(-dt * 5));
      if (pc.position.y < 0.2) pc.position.y = 0.2;
      pc.lookAt(g.position.x + nose.x * 0.6, g.position.y + 0.1, g.position.z + nose.z * 0.6);
      fov = 68;
    } else {
      pc.position.set(...PILOT);
      pc.lookAt(g.position);
      const dist = pc.position.distanceTo(g.position);
      fov = Math.min(55, Math.max(8, ((2 * Math.atan(1.6 / Math.max(dist, 0.1))) * 180) / Math.PI));
    }
    if (Math.abs(pc.fov - fov) > 0.05) {
      pc.fov += (fov - pc.fov) * (camera === "ground" ? 1 - Math.exp(-dt * 3) : 1);
      pc.updateProjectionMatrix();
    }
    pc.near = camera === "fpv" ? 0.01 : 0.05;
  });

  return (
    <>
      <group ref={quad} visible={camera !== "fpv"}>
        <Quad frameRef={frameRef} />
      </group>
      <mesh ref={shadowBlob} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 24]} />
        <meshBasicMaterial color="#000" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      <directionalLight
        ref={sun}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0005}
      />
      <primitive object={trailLine} />
    </>
  );
}

export function SimScene({ frameRef, camera }: { frameRef: MutableRefObject<FrameRef>; camera: SimCamera }) {
  return (
    <Canvas
      className="sim-canvas"
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 1.2, 3], fov: 68, near: 0.05, far: 15000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={["#a9cbe6"]} />
      <fog attach="fog" args={["#c4d9ea", 80, 1400]} />
      <Sky sunPosition={[60, 40, 30]} turbidity={6} rayleigh={1.4} mieCoefficient={0.004} mieDirectionalG={0.85} distance={12000} />
      <hemisphereLight args={["#dfefff", "#4a6b3a", 0.9]} />
      <Ground />
      <Pad />
      <Trees />
      <Gates />
      <Rig frameRef={frameRef} camera={camera} />
    </Canvas>
  );
}
