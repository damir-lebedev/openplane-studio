// Самолёт в 3D: деталь, о которой сейчас речь в мастере, подсвечена и
// камера наезжает на неё; чего нет (нет трубки Пито) — растворяется, а при
// наведении видно пунктиром, где оно будет. Рули ходят от стиков настоящего
// пульта (живые данные) или покачиваются сами, когда о них речь.
//
// Самолёт — абстракция (решение 18.10): не копия Astro-Cargo, а красивый
// самолёт, на котором правдиво то, что настраивается: где Пито, где GPS,
// какие датчики, какое шасси, где мотор.

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { airfoilShape, finShape, fuselage, propBlade, spanwise, surfaceWedge } from "./geometry";

export interface PlaneLook {
  motor: "tractor" | "pusher";
  gear: "tail" | "nose" | "none";
  rudder: boolean;
  ailerons: "two" | "one";
  payload: boolean;
  camera: boolean;
  buzzer: boolean;
  sensors: { imu: string | null; baro: string | null; mag: string | null; gps: string | null; pitot: string | null };
}

export interface Controls {
  /** −1…1: крен вправо, тангаж «на себя», курс вправо, газ 0…1, закрылки 0…1 */
  roll: number;
  pitch: number;
  yaw: number;
  throttle: number;
  flaps: number;
}

type PartState = "normal" | "dim" | "focus" | "ghost" | "hidden";

const SceneCtx = createContext<{ focus: string[] }>({ focus: [] });
const PartCtx = createContext<PartState>("normal");

const ACCENT = "#39d0ff";
const BODY = "#e4eaf1";
const TRIM = "#9fb3c8";

/** Материал детали: плавно растворяется, подсвечивается, «призрак» — каркасом. */
function M({ color, metal = 0.08, rough = 0.55, clip }: { color: string; metal?: number; rough?: number; clip?: THREE.Plane[] }) {
  const state = useContext(PartCtx);
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  const target = state === "hidden" ? 0 : state === "ghost" ? 0.55 : state === "dim" ? 0.42 : 1;
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    m.opacity += (target - m.opacity) * Math.min(1, dt * 7);
    m.visible = m.opacity > 0.02;
    m.depthWrite = m.opacity > 0.9;
  });
  const focus = state === "focus";
  const ghost = state === "ghost";
  return (
    <meshStandardMaterial
      ref={ref}
      color={ghost ? ACCENT : color}
      emissive={focus || ghost ? "#1aa6db" : "#000000"}
      emissiveIntensity={focus ? 0.45 : ghost ? 0.6 : 0}
      metalness={metal}
      roughness={rough}
      transparent
      opacity={1}
      wireframe={ghost}
      clippingPlanes={clip}
      side={clip ? THREE.DoubleSide : THREE.FrontSide}
    />
  );
}

/** Деталь: id для подсветки; present = false — её нет на самолёте. */
function Part({ id, present = true, children }: { id: string | string[]; present?: boolean; children: ReactNode }) {
  const { focus } = useContext(SceneCtx);
  const ids = Array.isArray(id) ? id : [id];
  const focused = ids.some((x) => focus.includes(x));
  const state: PartState = !present ? (focused ? "ghost" : "hidden") : focused ? "focus" : focus.length ? "dim" : "normal";
  return <PartCtx.Provider value={state}>{children}</PartCtx.Provider>;
}

// --- размеры
const Z_NOSE = -0.6;
const Z_TAIL = 0.78;
const R_FUS = 0.075;
const WING = { span: 1.8, chord: 0.24, z: -0.2, y: 0.075 };
const STAB = { span: 0.56, chord: 0.12, z: 0.6, y: 0.035 };

function useLerped(target: number, speed = 10) {
  const v = useRef(target);
  useFrame((_, dt) => {
    v.current += (target - v.current) * Math.min(1, dt * speed);
  });
  return v;
}

function Airframe({ look, ctl, demo }: { look: PlaneLook; ctl: Controls | null; demo: string[] }) {
  const fus = useMemo(() => fuselage(Z_NOSE, Z_TAIL, R_FUS), []);
  const wing = useMemo(() => spanwise(airfoilShape(WING.chord, 0.13), WING.span), []);
  const stab = useMemo(() => spanwise(airfoilShape(STAB.chord, 0.09, 0), STAB.span), []);
  const fin = useMemo(() => finShape(0.16, 0.08, 0.2, 0.08, 0.012), []);
  const aileron = useMemo(() => surfaceWedge(0.06, 0.012, 0.36), []);
  const elevator = useMemo(() => surfaceWedge(0.05, 0.009, STAB.span - 0.04), []);
  const rudder = useMemo(() => finShape(0.055, 0.045, 0.19, 0.0, 0.009), []);

  const leftAil = useRef<THREE.Group>(null);
  const rightAil = useRef<THREE.Group>(null);
  const elev = useRef<THREE.Group>(null);
  const rud = useRef<THREE.Group>(null);

  const roll = useLerped(ctl?.roll ?? 0);
  const pitch = useLerped(ctl?.pitch ?? 0);
  const yaw = useLerped(ctl?.yaw ?? 0);
  const flaps = useLerped(ctl?.flaps ?? 0, 3);
  const t0 = useRef(0);

  useFrame((_, dt) => {
    t0.current += dt;
    // Когда о руле речь, а живых данных нет, — руль покачивается сам: «вот он».
    const wave = Math.sin(t0.current * 2.4);
    const r = ctl ? roll.current : demo.includes("ailerons") ? wave : 0;
    const p = ctl ? pitch.current : demo.includes("elevator") ? wave : 0;
    const y = ctl ? yaw.current : demo.includes("rudder") ? wave : 0;
    const f = ctl ? flaps.current : 0;
    const AIL = 0.38;
    // Крен вправо: правый элерон вверх (задняя кромка вверх — поворот −X), левый вниз.
    if (rightAil.current) rightAil.current.rotation.x = -AIL * r + 0.3 * f;
    if (leftAil.current) leftAil.current.rotation.x = AIL * r + 0.3 * f;
    if (elev.current) elev.current.rotation.x = -0.4 * p;
    if (rud.current) rud.current.rotation.y = 0.45 * y;
  });

  const wingTE = WING.z + WING.chord;
  const ailSpan = 0.36;
  return (
    <group>
      <Part id="fuselage">
        <mesh geometry={fus} castShadow>
          <M color={BODY} />
        </mesh>
      </Part>
      <Part id="wing">
        <mesh geometry={wing} position={[0, WING.y, WING.z]} castShadow>
          <M color={BODY} />
        </mesh>
      </Part>
      <Part id={["ailerons", "flaps"]}>
        <group ref={rightAil} position={[WING.span / 2 - ailSpan / 2 - 0.05, WING.y + 0.004, wingTE]}>
          <mesh geometry={aileron}>
            <M color={TRIM} />
          </mesh>
        </group>
        <group ref={leftAil} position={[-(WING.span / 2 - ailSpan / 2 - 0.05), WING.y + 0.004, wingTE]}>
          <mesh geometry={aileron}>
            <M color={TRIM} />
          </mesh>
        </group>
      </Part>
      <Part id="tail">
        <mesh geometry={stab} position={[0, STAB.y, STAB.z]}>
          <M color={BODY} />
        </mesh>
        <mesh geometry={fin} position={[0, 0.04, 0.58]}>
          <M color={BODY} />
        </mesh>
      </Part>
      <Part id="elevator">
        <group ref={elev} position={[0, STAB.y + 0.002, STAB.z + STAB.chord]}>
          <mesh geometry={elevator}>
            <M color={TRIM} />
          </mesh>
        </group>
      </Part>
      <Part id="rudder" present={look.rudder}>
        <group ref={rud} position={[0, 0.045, 0.74]}>
          <mesh geometry={rudder}>
            <M color={TRIM} />
          </mesh>
        </group>
      </Part>
    </group>
  );
}

function Motor({ look, ctl }: { look: PlaneLook; ctl: Controls | null }) {
  return (
    <>
      <MotorAt kind="tractor" look={look} ctl={ctl} />
      <MotorAt kind="pusher" look={look} ctl={ctl} />
    </>
  );
}

function MotorAt({ kind, look, ctl }: { kind: "tractor" | "pusher"; look: PlaneLook; ctl: Controls | null }) {
  const blade = useMemo(() => propBlade(0.12, 0.024), []);
  const prop = useRef<THREE.Group>(null);
  const thr = useLerped(ctl?.throttle ?? 0, 3);
  useFrame((_, dt) => {
    if (prop.current) prop.current.rotation.z += dt * (0.4 + thr.current * 60);
  });
  const present = look.motor === kind;
  const pusher = kind === "pusher";
  // Толкающий — на пилоне над фюзеляжем за крылом, винт смотрит назад.
  const pos: [number, number, number] = pusher ? [0, 0.17, 0.14] : [0, 0, Z_NOSE - 0.005];
  const dir = pusher ? 1 : -1;
  return (
    <Part id={present ? ["motor", `motor-${kind}`] : [`motor-${kind}`]} present={present}>
      <group position={pos}>
        {pusher && (
          <mesh position={[0, -0.05, -0.04]}>
            <boxGeometry args={[0.012, 0.09, 0.07]} />
            <M color={BODY} />
          </mesh>
        )}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, dir * 0.012]}>
          <cylinderGeometry args={[0.026, 0.028, 0.034, 24]} />
          <M color="#3b4654" metal={0.6} rough={0.35} />
        </mesh>
        <mesh rotation={[(dir * Math.PI) / 2, 0, 0]} position={[0, 0, dir * 0.045]}>
          <coneGeometry args={[0.022, 0.04, 24]} />
          <M color="#c9d3de" metal={0.4} rough={0.3} />
        </mesh>
        <group ref={prop} position={[0, 0, dir * 0.033]}>
          <mesh geometry={blade}>
            <M color="#2b3542" />
          </mesh>
          <mesh geometry={blade} rotation={[0, 0, Math.PI]}>
            <M color="#2b3542" />
          </mesh>
        </group>
      </group>
    </Part>
  );
}

function Wheel({ position, r = 0.042 }: { position: [number, number, number]; r?: number }) {
  return (
    <mesh position={position} rotation={[0, 0, Math.PI / 2]} castShadow>
      <cylinderGeometry args={[r, r, r * 0.45, 24]} />
      <M color="#1d242c" rough={0.9} />
    </mesh>
  );
}

function Strut({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return (
    <mesh position={mid} quaternion={q}>
      <cylinderGeometry args={[0.005, 0.005, len, 8]} />
      <M color="#7d8a99" metal={0.7} rough={0.3} />
    </mesh>
  );
}

function Gear({ look }: { look: PlaneLook }) {
  const y = -0.19;
  return (
    <>
      <Part id={look.gear === "tail" ? ["gear", "gear-tail"] : ["gear-tail"]} present={look.gear === "tail"}>
        <Strut from={[0.02, -0.06, -0.24]} to={[0.13, y, -0.24]} />
        <Strut from={[-0.02, -0.06, -0.24]} to={[-0.13, y, -0.24]} />
        <Wheel position={[0.14, y, -0.24]} />
        <Wheel position={[-0.14, y, -0.24]} />
        <Strut from={[0, -0.01, 0.7]} to={[0, -0.05, 0.72]} />
        <Wheel position={[0, -0.06, 0.72]} r={0.018} />
      </Part>
      <Part id={look.gear === "nose" ? ["gear", "gear-nose"] : ["gear-nose"]} present={look.gear === "nose"}>
        <Strut from={[0, -0.05, -0.47]} to={[0, y, -0.47]} />
        <Wheel position={[0, y, -0.47]} r={0.034} />
        <Strut from={[0.02, -0.06, 0.02]} to={[0.13, y, 0.02]} />
        <Strut from={[-0.02, -0.06, 0.02]} to={[-0.13, y, 0.02]} />
        <Wheel position={[0.14, y, 0.02]} />
        <Wheel position={[-0.14, y, 0.02]} />
      </Part>
    </>
  );
}

/** Цвет и размер платы датчика — по модели: другая модель — другая «платка». */
function breakout(model: string | null): { color: string; w: number; d: number } {
  const m = (model ?? "").toUpperCase();
  if (m.includes("MPU6050")) return { color: "#1f4fbf", w: 0.021, d: 0.016 }; // GY-521
  if (m.includes("LSM6DSV")) return { color: "#5b2a86", w: 0.018, d: 0.018 };
  if (m.includes("ICM45686")) return { color: "#8a1c2b", w: 0.016, d: 0.016 };
  if (m.includes("ICM42688")) return { color: "#202020", w: 0.016, d: 0.014 };
  if (m.includes("BMP581")) return { color: "#5b2a86", w: 0.014, d: 0.012 };
  if (m.includes("BME280") || m.includes("BMP388")) return { color: "#5b2a86", w: 0.015, d: 0.013 };
  if (m.includes("SPL06")) return { color: "#1f4fbf", w: 0.014, d: 0.012 };
  if (m.includes("QMC")) return { color: "#1f4fbf", w: 0.014, d: 0.013 };
  return { color: "#2c6e49", w: 0.016, d: 0.016 };
}

function Board({ look }: { look: PlaneLook }) {
  const imu = breakout(look.sensors.imu);
  const baro = breakout(look.sensors.baro);
  return (
    <>
      <Part id="board">
        <group position={[0, 0.0, -0.13]}>
          <mesh>
            <boxGeometry args={[0.07, 0.006, 0.05]} />
            <M color="#1f5f3c" rough={0.7} />
          </mesh>
          <mesh position={[-0.012, 0.005, 0]}>
            <boxGeometry args={[0.012, 0.004, 0.012]} />
            <M color="#151515" />
          </mesh>
        </group>
        <group position={[0.022, 0.012, -0.1]}>
          <mesh>
            <boxGeometry args={[imu.w, 0.002, imu.d]} />
            <M color={imu.color} />
          </mesh>
          <mesh position={[0, 0.002, 0]}>
            <boxGeometry args={[0.004, 0.0015, 0.004]} />
            <M color="#111" />
          </mesh>
        </group>
      </Part>
      <Part id="baro" present={!!look.sensors.baro}>
        <group position={[-0.024, 0.012, -0.1]}>
          <mesh>
            <boxGeometry args={[baro.w, 0.002, baro.d]} />
            <M color={baro.color} />
          </mesh>
          <mesh position={[0, 0.0025, 0]}>
            <boxGeometry args={[0.003, 0.002, 0.003]} />
            <M color="#c8ccd2" metal={0.8} rough={0.25} />
          </mesh>
        </group>
      </Part>
    </>
  );
}

/** Трубка Пито на левом крыле, вне потока от винта; в фокусе — в разрезе. */
function Pitot({ look }: { look: PlaneLook }) {
  const { focus } = useContext(SceneCtx);
  const cut = focus.includes("pitot") && !!look.sensors.pitot;
  const x = -0.52;
  const y = WING.y + 0.01;
  const z0 = WING.z - 0.005;
  const len = 0.2;
  // Разрез: отрезана верхняя половина трубки — видно внутреннюю трубку полного давления.
  const clip = useMemo(() => [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)], [y]);
  const box = breakout("BMP581");
  return (
    <Part id="pitot" present={!!look.sensors.pitot}>
      <group>
        {/* внешняя трубка — статическое давление через боковые отверстия */}
        <mesh position={[x, y, z0 - len / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.009, 0.009, len, 24, 1, cut]} />
          <M color="#c9d1da" metal={0.85} rough={0.25} clip={cut ? clip : undefined} />
        </mesh>
        {/* внутренняя — полное давление, открыта навстречу потоку */}
        <mesh position={[x, y, z0 - len / 2 - 0.003]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0036, 0.0036, len + 0.006, 16]} />
          <M color="#ff9f43" metal={0.3} rough={0.4} />
        </mesh>
        {/* шланг к датчику и сам датчик (BMP581 в герметичной камере) */}
        <mesh position={[x, y, z0 + 0.03]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0022, 0.0022, 0.06, 8]} />
          <M color="#ff9f43" />
        </mesh>
        <mesh position={[x, y, z0 + 0.065]}>
          <boxGeometry args={[box.w + 0.006, 0.008, box.d + 0.006]} />
          <M color={box.color} />
        </mesh>
      </group>
    </Part>
  );
}

function Extras({ look }: { look: PlaneLook }) {
  const gpsTop = R_FUS * 1.08 + 0.006;
  return (
    <>
      <Part id="gps" present={!!look.sensors.gps}>
        <group position={[0, gpsTop, 0.16]}>
          <mesh>
            <cylinderGeometry args={[0.03, 0.032, 0.012, 32]} />
            <M color="#2a313a" rough={0.6} />
          </mesh>
          <mesh position={[0, 0.0075, 0]}>
            <boxGeometry args={[0.02, 0.003, 0.02]} />
            <M color="#d6c7a1" rough={0.8} />
          </mesh>
        </group>
      </Part>
      {/* компас — подальше от мотора и проводов, на мачте у хвоста */}
      <Part id="mag" present={!!look.sensors.mag}>
        <group position={[0, 0.06, 0.38]}>
          <mesh position={[0, 0.025, 0]}>
            <boxGeometry args={[0.014, 0.002, 0.013]} />
            <M color={breakout(look.sensors.mag).color} />
          </mesh>
          <mesh>
            <cylinderGeometry args={[0.0025, 0.0025, 0.05, 6]} />
            <M color="#7d8a99" />
          </mesh>
        </group>
      </Part>
      <Part id="payload" present={look.payload}>
        <mesh position={[0, -0.105, -0.02]} castShadow>
          <boxGeometry args={[0.07, 0.045, 0.13]} />
          <M color="#e08e3c" rough={0.7} />
        </mesh>
      </Part>
      <Part id="camera" present={look.camera}>
        <group position={[0, -0.075, -0.42]}>
          <mesh>
            <sphereGeometry args={[0.024, 24, 16]} />
            <M color="#2a313a" />
          </mesh>
          <mesh position={[0, -0.004, -0.022]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.009, 0.009, 0.01, 16]} />
            <M color="#0c1118" metal={0.5} rough={0.2} />
          </mesh>
        </group>
      </Part>
      <Part id="buzzer" present={look.buzzer}>
        <mesh position={[0, 0.0, 0.3]}>
          <cylinderGeometry args={[0.009, 0.009, 0.008, 16]} />
          <M color="#111" />
        </mesh>
      </Part>
    </>
  );
}

// --- камера-режиссёр

const VIEWS: Record<string, { pos: [number, number, number]; target: [number, number, number] }> = {
  default: { pos: [1.3, 0.62, -1.35], target: [0, -0.02, 0.02] },
  board: { pos: [0.36, 0.06, -0.3], target: [0, 0, -0.12] },
  baro: { pos: [0.28, 0.28, -0.26], target: [-0.02, 0.01, -0.1] },
  imu: { pos: [0.36, 0.06, -0.3], target: [0, 0, -0.12] },
  mag: { pos: [0.35, 0.3, 0.6], target: [0, 0.07, 0.38] },
  gps: { pos: [0.4, 0.38, 0.45], target: [0, 0.09, 0.16] },
  pitot: { pos: [-0.36, 0.205, -0.51], target: [-0.52, 0.085, -0.31] },
  motor: { pos: [0.55, 0.3, -1.05], target: [0, 0, -0.55] },
  "motor-tractor": { pos: [0.55, 0.3, -1.05], target: [0, 0, -0.55] },
  "motor-pusher": { pos: [0.6, 0.5, 0.75], target: [0, 0.15, 0.15] },
  gear: { pos: [0.9, -0.05, -0.6], target: [0, -0.12, -0.15] },
  ailerons: { pos: [1.25, 0.65, 0.75], target: [0.55, 0.07, 0.02] },
  flaps: { pos: [1.25, 0.65, 0.75], target: [0.55, 0.07, 0.02] },
  elevator: { pos: [0.55, 0.45, 1.25], target: [0, 0.03, 0.68] },
  rudder: { pos: [0.6, 0.4, 1.25], target: [0, 0.12, 0.74] },
  tail: { pos: [0.6, 0.45, 1.3], target: [0, 0.08, 0.66] },
  payload: { pos: [0.55, -0.25, -0.35], target: [0, -0.1, -0.02] },
  camera: { pos: [0.4, -0.15, -0.85], target: [0, -0.07, -0.42] },
  buzzer: { pos: [0.4, 0.25, 0.55], target: [0, 0, 0.3] },
  wing: { pos: [1.3, 1.1, 0.6], target: [0, 0.07, -0.08] },
  fuselage: { pos: [1.2, 0.6, 0.3], target: [0, 0, 0.05] },
};

function Director({ focus, live, pusher }: { focus: string[]; live: boolean; pusher: boolean }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; autoRotate: boolean } | null;
  const known = focus.map((f) => (VIEWS[f] ? f : f.replace(/-(tail|nose|tractor|pusher)$/, ""))).filter((f) => VIEWS[f]);
  const one = known.length === 1 ? known[0] : "default";
  // «Мотор» — там, где он стоит на этом самолёте.
  const key = one === "motor" && pusher ? "motor-pusher" : one;
  const left = useRef(1.6);
  useEffect(() => {
    left.current = 1.6; // после смены фокуса — 1,6 с плавного наезда, дальше камера в руках пилота
  }, [key]);
  useFrame((_, dt) => {
    if (controls) controls.autoRotate = key === "default" && !live;
    if (left.current <= 0 || !controls) return;
    left.current -= dt;
    const v = VIEWS[key];
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(new THREE.Vector3(...v.pos), k);
    controls.target.lerp(new THREE.Vector3(...v.target), k);
    controls.update();
  });
  return null;
}

/** Живое положение: крен и тангаж с платы (курс не крутим — самолёт не уезжает из кадра). */
function Attitude({ attitude, children }: { attitude?: [number, number] | null; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!g.current) return;
    const roll = attitude ? (attitude[0] * Math.PI) / 180 : 0;
    const pitch = attitude ? (attitude[1] * Math.PI) / 180 : 0;
    const k = Math.min(1, dt * 12);
    g.current.rotation.z += (-roll - g.current.rotation.z) * k;
    g.current.rotation.x += (pitch - g.current.rotation.x) * k;
  });
  return <group ref={g}>{children}</group>;
}

export function Plane3D({
  look,
  focus = [],
  ctl = null,
  attitude = null,
  labels = {},
}: {
  look: PlaneLook;
  focus?: string[];
  ctl?: Controls | null;
  attitude?: [number, number] | null;
  /** подписи к деталям в фокусе: id → текст */
  labels?: Record<string, string>;
}) {
  const caption = focus.map((f) => labels[f]).find(Boolean);
  return (
    <>
    <Canvas
      dpr={[1, 2]}
      camera={{ position: VIEWS.default.pos, fov: 38, near: 0.01, far: 50 }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
      shadows
    >
      <SceneCtx.Provider value={{ focus }}>
        <hemisphereLight args={["#e8f4ff", "#26394d", 1.35]} />
        <directionalLight position={[2.5, 4, 2]} intensity={2.1} castShadow />
        <directionalLight position={[-3, 2, -2]} intensity={0.7} color="#9fd4ff" />
        <Attitude attitude={attitude}>
          <Airframe look={look} ctl={ctl} demo={focus} />
          <Motor look={look} ctl={ctl} />
          <Gear look={look} />
          <Board look={look} />
          <Pitot look={look} />
          <Extras look={look} />
        </Attitude>
        <ContactShadows position={[0, -0.24, 0]} opacity={0.45} scale={3} blur={2.4} far={1} />
        <OrbitControls makeDefault enablePan={false} minDistance={0.35} maxDistance={4} autoRotateSpeed={0.6} />
        <Director focus={focus} live={!!attitude} pusher={look.motor === "pusher"} />
      </SceneCtx.Provider>
    </Canvas>
    {caption && <div className="plane3d-caption">{caption}</div>}
    </>
  );
}
