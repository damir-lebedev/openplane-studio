// Дрон анкеты первого запуска: собирается по ответам. Сначала одна плата
// полётника, потом рама нужного размера (вуп, 5", 7", сине с защитой
// винтов) или крыло, потом то, что нужно для выбранных дел: GPS на мачте,
// антенны дальней связи, камера для съёмки, груз. Детали выпрыгивают и
// растворяются пружиной; дрон медленно кружится.

import { ContactShadows } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { ReactNode, useMemo, useRef } from "react";
import * as THREE from "three";

import type { DroneLook } from "../../core/pilot";

const ACCENT = "#39d0ff";
const CARBON = "#1d2733";
const BODY = "#e4eaf1";
const TRIM = "#9fb3c8";

/** Деталь появляется пружиной из точки и так же уходит. */
function Pop({ show, delay = 0, children, position }: { show: boolean; delay?: number; children: ReactNode; position?: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  const v = useRef(0);
  const wait = useRef(delay);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (show && wait.current > 0) {
      wait.current -= dt;
      return;
    }
    if (!show) wait.current = delay;
    const target = show ? 1 : 0;
    const s = g.scale.x;
    // пружина с лёгким перелётом
    v.current += ((target - s) * 160 - v.current * 14) * Math.min(dt, 0.05);
    const next = Math.max(0, s + v.current * Math.min(dt, 0.05));
    g.scale.setScalar(next);
    g.visible = next > 0.01;
  });
  return (
    <group ref={ref} position={position} scale={0} visible={false}>
      {children}
    </group>
  );
}

function Prop({ spin, radius, dir }: { spin: boolean; radius: number; dir: 1 | -1 }) {
  const ref = useRef<THREE.Group>(null);
  const speed = useRef(0);
  useFrame((_, dt) => {
    speed.current += ((spin ? 28 : 1.2) - speed.current) * Math.min(1, dt * 2);
    if (ref.current) ref.current.rotation.y += dir * speed.current * dt;
  });
  return (
    <group ref={ref}>
      {[0, Math.PI].map((a) => (
        <mesh key={a} rotation={[0.12, a, 0]} position={[Math.cos(a) * radius * 0.5, 0, -Math.sin(a) * radius * 0.5]}>
          <boxGeometry args={[radius, 0.008, 0.07 * radius + 0.02]} />
          <meshStandardMaterial color={ACCENT} transparent opacity={0.55} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Quad({ look }: { look: DroneLook }) {
  const s = look.size;
  const arm = 0.62 * s;
  const prop = 0.42 * s;
  const corners: [number, number, 1 | -1][] = [
    [1, 1, 1],
    [-1, 1, -1],
    [1, -1, -1],
    [-1, -1, 1],
  ];
  return (
    <group>
      {/* рама */}
      <Pop show={look.quad}>
        <mesh castShadow>
          <boxGeometry args={[0.34, 0.07, 0.5]} />
          <meshStandardMaterial color={CARBON} roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.07, 0]} castShadow>
          <boxGeometry args={[0.24, 0.07, 0.36]} />
          <meshStandardMaterial color={BODY} roughness={0.45} />
        </mesh>
        {corners.map(([x, z], i) => (
          <mesh key={i} position={[(x * arm) / 2 / Math.SQRT2, -0.01, (z * arm) / 2 / Math.SQRT2]} rotation={[0, Math.atan2(x, z), 0]} castShadow>
            <boxGeometry args={[0.07, 0.03, arm]} />
            <meshStandardMaterial color={CARBON} roughness={0.5} metalness={0.3} />
          </mesh>
        ))}
      </Pop>
      {/* моторы, винты, защита */}
      {corners.map(([x, z, dir], i) => (
        <Pop key={i} show={look.quad} delay={0.08 * (i + 1)} position={[(x * arm) / Math.SQRT2, 0.03, (z * arm) / Math.SQRT2]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.055, 0.055, 0.07, 24]} />
            <meshStandardMaterial color={TRIM} metalness={0.7} roughness={0.3} />
          </mesh>
          <group position={[0, 0.05, 0]}>
            <Prop spin={look.spin} radius={prop} dir={dir} />
          </group>
          <Pop show={look.ducts}>
            <mesh position={[0, 0.04, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[prop * 1.06, 0.022, 10, 48]} />
              <meshStandardMaterial color={BODY} roughness={0.5} />
            </mesh>
          </Pop>
        </Pop>
      ))}
      {/* камера спереди */}
      <Pop show={look.camera} position={[0, 0.06, 0.29]}>
        <mesh>
          <boxGeometry args={[0.13, 0.11, 0.1]} />
          <meshStandardMaterial color="#2a3442" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0, 0.06]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.035, 0.04, 0.05, 20]} />
          <meshStandardMaterial color="#0b1118" emissive={ACCENT} emissiveIntensity={0.25} metalness={0.6} roughness={0.2} />
        </mesh>
      </Pop>
      {/* GPS на мачте сзади */}
      <Pop show={look.gps} position={[0, 0.1, -0.22]} delay={0.05}>
        <mesh position={[0, 0.07, 0]}>
          <cylinderGeometry args={[0.008, 0.008, 0.14, 8]} />
          <meshStandardMaterial color={TRIM} />
        </mesh>
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.025, 28]} />
          <meshStandardMaterial color={BODY} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.165, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.006, 20]} />
          <meshStandardMaterial color="#3fb950" emissive="#3fb950" emissiveIntensity={0.8} />
        </mesh>
      </Pop>
      {/* антенны дальней связи */}
      {[-1, 1].map((k) => (
        <Pop key={k} show={look.antennas} position={[k * 0.1, 0.1, -0.24]} delay={0.12}>
          <mesh rotation={[-0.5, 0, k * 0.35]} position={[k * 0.03, 0.08, -0.04]}>
            <cylinderGeometry args={[0.009, 0.006, 0.2, 8]} />
            <meshStandardMaterial color="#f0a030" roughness={0.6} />
          </mesh>
        </Pop>
      ))}
      {/* груз снизу */}
      <Pop show={look.payload} position={[0, -0.13, 0]} delay={0.1}>
        <mesh castShadow>
          <boxGeometry args={[0.2, 0.14, 0.24]} />
          <meshStandardMaterial color="#c8873a" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.071, 0]}>
          <boxGeometry args={[0.21, 0.004, 0.04]} />
          <meshStandardMaterial color="#e9d9b8" />
        </mesh>
      </Pop>
    </group>
  );
}

function Wing({ look }: { look: DroneLook }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.32);
    s.lineTo(0.95, -0.18);
    s.lineTo(0.95, -0.36);
    s.lineTo(0, -0.12);
    s.lineTo(-0.95, -0.36);
    s.lineTo(-0.95, -0.18);
    s.closePath();
    return s;
  }, []);
  return (
    <group>
      <Pop show={look.wing}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow>
          <extrudeGeometry args={[shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }]} />
          <meshStandardMaterial color={BODY} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.05, 0.02]} castShadow>
          <boxGeometry args={[0.18, 0.08, 0.42]} />
          <meshStandardMaterial color={TRIM} roughness={0.45} />
        </mesh>
        {[-1, 1].map((k) => (
          <mesh key={k} position={[k * 0.95, 0.07, 0.27]} castShadow>
            <boxGeometry args={[0.012, 0.14, 0.16]} />
            <meshStandardMaterial color={ACCENT} roughness={0.4} />
          </mesh>
        ))}
      </Pop>
      <Pop show={look.wing} delay={0.15} position={[0, 0.04, 0.2]}>
        <group rotation={[Math.PI / 2, 0, 0]}>
          <Prop spin={look.spin} radius={0.36} dir={1} />
        </group>
      </Pop>
      <Pop show={look.wing && look.gps} position={[0, 0.1, -0.05]} delay={0.05}>
        <mesh>
          <cylinderGeometry args={[0.06, 0.06, 0.02, 28]} />
          <meshStandardMaterial color={BODY} />
        </mesh>
      </Pop>
      <Pop show={look.wing && look.camera} position={[0, 0.03, -0.25]}>
        <mesh>
          <sphereGeometry args={[0.05, 20, 16]} />
          <meshStandardMaterial color="#0b1118" emissive={ACCENT} emissiveIntensity={0.25} metalness={0.6} roughness={0.2} />
        </mesh>
      </Pop>
    </group>
  );
}

/** Плата полётника — с неё всё начинается; потом прячется в раму. */
function Board({ alone }: { alone: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current?.material as THREE.MeshStandardMaterial | undefined;
    if (m) m.emissiveIntensity = 0.25 + 0.2 * Math.sin(clock.elapsedTime * 3);
  });
  return (
    <Pop show={alone}>
      <mesh ref={ref} castShadow>
        <boxGeometry args={[0.3, 0.025, 0.3]} />
        <meshStandardMaterial color="#1f6f4a" emissive="#3fb950" emissiveIntensity={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <boxGeometry args={[0.1, 0.03, 0.1]} />
        <meshStandardMaterial color="#0b1118" metalness={0.5} />
      </mesh>
    </Pop>
  );
}

/** Радиус того, что собрано (с вращением): по нему сцена подгоняет масштаб. */
function radius(look: DroneLook, both: boolean): number {
  const quad = 1.04 * look.size;
  if (both) return Math.max(0.83 + quad, 0.87 + 0.7);
  if (look.quad) return quad;
  if (look.wing) return 1;
  return 0.25;
}

/** Кружится, покачивается и плавно подгоняет масштаб, чтобы дрон помещался в кадр. */
function Turntable({ fit, children }: { fit: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y += dt * 0.35;
    g.position.y = 0.05 * Math.sin(clock.elapsedTime * 1.3);
    g.scale.setScalar(g.scale.x + (fit - g.scale.x) * Math.min(1, dt * 3));
  });
  return (
    <group ref={ref} scale={fit}>
      {children}
    </group>
  );
}

export function Drone3D({ look }: { look: DroneLook }) {
  const both = look.quad && look.wing;
  const fit = Math.min(1.6, 0.7 / radius(look, both));
  return (
    <Canvas dpr={[1, 2]} camera={{ position: [0, 1.5, 3.2], fov: 38 }} gl={{ antialias: true, alpha: true }} shadows>
      <hemisphereLight args={["#e8f4ff", "#26394d", 1.35]} />
      <directionalLight position={[2.5, 4, 2]} intensity={2.1} castShadow />
      <directionalLight position={[-3, 2, -2]} intensity={0.7} color="#9fd4ff" />
      <group position={[0, 0.1, 0]}>
        <Turntable fit={fit}>
          <Board alone={!look.quad && !look.wing} />
          <group position={[both ? -0.75 : 0, 0, both ? 0.35 : 0]}>
            <Quad look={look} />
          </group>
          <group position={[both ? 0.75 : 0, both ? 0.3 : 0, both ? -0.45 : 0]} scale={both ? 0.7 : 1}>
            <Wing look={look} />
          </group>
        </Turntable>
      </group>
      <ContactShadows position={[0, -0.25, 0]} opacity={0.45} scale={4} blur={2.6} far={1.2} />
    </Canvas>
  );
}
