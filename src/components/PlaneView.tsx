// Самолёт для боковой панели мастера: 3D (грузится отдельным куском), а
// пока грузится или если WebGL нет — прежний вид сверху. Рули ходят от
// стиков настоящего пульта, самолёт наклоняется по IMU платы.

import { Component, lazy, ReactNode, Suspense } from "react";

import { channelIndex } from "../core/channels";
import { expectedAddresses, hex } from "../core/live";
import { findBoard, isNone, Manifest } from "../core/manifest";
import { PlaneProject, sensorLabel } from "../core/project";
import { useApp } from "../store";
import { useLive } from "./live/LiveWidgets";
import { PlanePreview } from "./PlanePreview";
import type { Controls, PlaneLook } from "./plane3d/Plane3D";

const Plane3D = lazy(() => import("./plane3d/Plane3D").then((m) => ({ default: m.Plane3D })));

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function lookOf(manifest: Manifest, plane: PlaneProject): PlaneLook {
  const a = plane.airframe;
  const board = findBoard(manifest, plane.board);
  const sensor = (cat: "imu" | "baro" | "mag" | "gps" | "airspeed") =>
    isNone(plane.sensors[cat]) ? null : sensorLabel(manifest, cat, plane.sensors[cat]);
  return {
    motor: a.motorPosition,
    gear: a.gear,
    rudder: a.rudder && !!board?.outputs.rudder,
    ailerons: a.ailerons,
    payload: a.payload,
    camera: a.camera,
    buzzer: a.buzzer,
    sensors: { imu: sensor("imu"), baro: sensor("baro"), mag: sensor("mag"), gps: sensor("gps"), pitot: sensor("airspeed") },
  };
}

function labelsOf(manifest: Manifest, plane: PlaneProject): Record<string, string> {
  const at = (cat: "imu" | "baro" | "mag" | "airspeed") => {
    const addrs = expectedAddresses(plane, cat);
    return addrs ? ` · I2C ${addrs.map(hex).join("/")}` : "";
  };
  const name = (cat: "imu" | "baro" | "mag" | "gps" | "airspeed") => sensorLabel(manifest, cat, plane.sensors[cat]);
  const a = plane.airframe;
  const out: Record<string, string> = {
    board: `${findBoard(manifest, plane.board)?.title.split(" — ")[0] ?? plane.board} · IMU ${name("imu")}${at("imu")}`,
    baro: isNone(plane.sensors.baro) ? "Барометр: нет" : `Барометр ${name("baro")}${at("baro")}`,
    mag: isNone(plane.sensors.mag) ? "Компас: нет" : `Компас ${name("mag")}${at("mag")} — подальше от мотора`,
    gps: isNone(plane.sensors.gps) ? "GPS: нет" : `GPS ${name("gps")} — антенной в небо`,
    pitot: isNone(plane.sensors.airspeed)
      ? "Трубка Пито: нет"
      : `${name("airspeed")}${at("airspeed")}: внутренняя трубка — полное давление, статику меряет барометр`,
    motor: `Мотор ${a.motorPosition === "pusher" ? "толкающий" : "тянущий"}, регулятор ${a.esc === "bidirectional" ? "двунаправленный" : "обычный"}`,
    gear: a.gear === "tail" ? "Хвостовое колесо" : a.gear === "nose" ? "Носовое колесо" : "Без шасси — запуск с руки",
    payload: "Сброс груза — серво AUX1",
    camera: "Камера — серво наклона AUX2",
  };
  return out;
}

export function PlaneView({ plane, focus }: { plane: PlaneProject; focus: string[] }) {
  const manifest = useApp((s) => s.manifest);
  const live = useLive();
  if (!manifest) return <PlanePreview plane={plane} focus={focus} />;
  const idx = (n: string) => channelIndex(manifest, plane, n);
  const ctl: Controls | null =
    live && live.rx === "ok"
      ? {
          roll: (live.ch[idx("AILERON")] - 1500) / 500,
          // CH2 = 2000 — стик от себя; «на себя» — руль высоты вверх
          pitch: -(live.ch[idx("ELEVATOR")] - 1500) / 500,
          yaw: (live.ch[idx("RUDDER")] - 1500) / 500,
          throttle: live.arm ? Math.max(0, (live.out[4] - 1000) / 1000) : 0,
          flaps: live.feat.includes("FLAPS") ? 1 : 0,
        }
      : null;
  const attitude: [number, number] | null = live?.att ? [live.att[0], live.att[1]] : null;
  const flat = <PlanePreview plane={plane} focus={focus} />;
  return (
    <Fallback fallback={flat}>
      <Suspense fallback={flat}>
        <div className="plane3d">
          <Plane3D look={lookOf(manifest, plane)} focus={focus} ctl={ctl} attitude={attitude} labels={labelsOf(manifest, plane)} />
        </div>
      </Suspense>
    </Fallback>
  );
}
