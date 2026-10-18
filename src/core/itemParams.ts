// Числа режима, функции или крутилки: какие параметры Config.h их
// настраивают. По именам — у прошивки они сгруппированы префиксами
// (CRUISE_…, LOITER_…, TAKEOFF_…). Нового префикса здесь нет — у режима
// просто не будет кнопки «Числа», настроить можно в «Все параметры».

import { Manifest } from "./manifest";
import { ItemKind } from "./rules";

const PREFIXES: Record<string, string[]> = {
  "mode:MODE_STABILIZE": ["STAB_MAX_PITCH_DEG", "STAB_INTEGRATOR_ZONE_DEG", "MAX_BANK_DEG"],
  "mode:MODE_ALT_HOLD": ["NAV_ALT_GAIN", "NAV_MAX_CLIMB_MS", "NAV_MAX_SINK_MS", "NAV_CLIMB_", "NAV_MAX_CLIMB_PITCH_DEG", "NAV_MAX_DIVE_PITCH_DEG"],
  "mode:MODE_ACRO": ["ACRO_"],
  "mode:MODE_CRUISE": ["CRUISE_", "AIRSPEED_THROTTLE_", "THROTTLE_PER_CLIMB_PCT", "STALL_"],
  "mode:MODE_LOITER": ["LOITER_"],
  "mode:MODE_RTH": ["RTH_", "HOME_"],
  "mode:MODE_AUTO_TAKEOFF": ["TAKEOFF_", "TD_", "TRI_"],
  "mode:MODE_LAUNCH": ["LAUNCH_"],
  "mode:MODE_AUTO_LAND": ["LAND_"],
  "mode:MODE_SOARING": ["SOAR_"],
  "mode:MODE_RESCUE": ["RESCUE_"],
  "feature:FLAPS": ["FLAPS_DEPLOYED_US", "FLAPS_TRANSITION_MS"],
  "feature:AIRBRAKE": ["AIRBRAKE_US"],
  "feature:AUTO_TRIM": ["AUTOTRIM_"],
  "feature:TURN_COORDINATION": ["TURN_COORD_"],
  "feature:PAYLOAD_DROP": ["PAYLOAD_"],
  "feature:GEOFENCE": ["GEOFENCE_ALWAYS_ON", "FENCE_"],
  "feature:CAMERA_STAB": ["CAMERA_"],
  "feature:BEEPER": ["LOST_MODEL_"],
  "feature:MOTOR_REVERSE": ["REVERSE_"],
  "knob:STAB_GAIN": ["STAB_GAIN_"],
  "knob:MAX_BANK": ["MAX_BANK_MIN_DEG", "MAX_BANK_MAX_DEG"],
  "knob:CRUISE_SPEED": ["CRUISE_AIRSPEED_MIN_MS", "CRUISE_AIRSPEED_MAX_MS"],
  "knob:RATES": ["RATES_"],
  "knob:LOITER_RADIUS": ["LOITER_RADIUS_MIN_M", "LOITER_RADIUS_MAX_M"],
  "knob:THROTTLE_LIMIT": ["THROTTLE_KNOB_MIN_PCT"],
  "knob:CAMERA_TILT": ["CAMERA_TILT_", "CAMERA_US_PER_DEG"],
  "knob:FLAPS": ["FLAPS_DEPLOYED_US"],
};

/** Имена общих (не пины) настраиваемых параметров этого режима, функции или крутилки. */
export function itemParams(manifest: Manifest, kind: ItemKind, id: string): string[] {
  const prefixes = PREFIXES[`${kind}:${id}`];
  if (!prefixes) return [];
  return manifest.params
    .filter((p) => p.board === null && !p.fixed && prefixes.some((pre) => p.name === pre || (pre.endsWith("_") && p.name.startsWith(pre))))
    .map((p) => p.name);
}
