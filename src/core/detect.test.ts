import { describe, expect, it } from "vitest";

import type { Device, Identity } from "../api";
import type { CopterEnv } from "./copter";
import { detectFcs, matchCopterEnv, mavVehicle, notMoved, parseBoardDump } from "./detect";

const env = (name: string, boardFile: string | null = null): CopterEnv => ({
  env: name,
  title: name,
  macro: null,
  boardFile,
  build: null,
  esc: "DSHOT600",
  board: null,
  uploadProtocol: "dfu",
  needsBoardDump: false,
});
const ENVS = [env("matek-h743-quad"), env("aocodarc-f405v3-quad", "config/boards/AOCODARCF405V3.h"), env("getfun-f405v3-quad", "config/boards/GETFUNF405V3.h")];

const dev = (port: string | null, kind: Device["kind"] = "stm32-cdc"): Device => ({
  kind,
  port,
  vid: 0x0483,
  pid: 0x5740,
  product: null,
  manufacturer: null,
  serial: null,
  title: "",
});

const DUMP = `### version
# Betaflight / STM32F405 (S405) 4.5.1 Nov 18 2024 / 09:06:46 (77d01ba3b) MSP API: 1.46
### status
MCU F405 Clock=168MHz, Vref=3.31V, Core temp=41degC
GYRO=ICM42688P, ACC=ICM42688P, BARO=DPS310, MAG=NONE
OSD: MAX7456 (30 x 16)
Flash: JEDEC ID=0xef4018 16M
### diff all
# diff all
board_name GETFUNF405V3
manufacturer_id GETF
feature GPS
feature -RX_PARALLEL_PWM
serial 1 64 115200 57600 0 115200
serial 3 2048 115200 57600 0 115200
serial 5 2 115200 57600 0 115200
set serialrx_provider = CRSF
set motor_pwm_protocol = DSHOT300
set dshot_bidir = ON
`;

describe("что за полётник", () => {
  it("плата по имени BF: board_name, заголовок платы, env без -quad", () => {
    expect(matchCopterEnv(ENVS, "GETFUNF405V3")?.env).toBe("getfun-f405v3-quad");
    expect(matchCopterEnv(ENVS, "MATEKH743")?.env).toBe("matek-h743-quad");
    expect(matchCopterEnv(ENVS, "aocodarc-f405v3-quad")?.env).toBe("aocodarc-f405v3-quad");
    expect(matchCopterEnv(ENVS, "SPEEDYBEEF405V4")).toBeUndefined();
    expect(matchCopterEnv(ENVS, undefined)).toBeUndefined();
  });

  it("наш паспорт главнее MSP; BF, INAV, ArduPilot, DFU и молчащий порт", () => {
    const identity = { fw: "op", proto: 1, board: "matek-h743-quad", commit: "abcdef123", config: "", plane: "7\"", armed: false, vehicle: "copter" } as Identity;
    const got = detectFcs(
      [dev("COM3"), dev("COM4"), dev("COM5"), dev("COM6"), dev("COM7"), dev(null, "stm32-dfu")],
      { COM3: { identity }, COM7: { identity: null } },
      {
        COM3: { variant: "BTFL" },
        COM4: { variant: "BTFL", version: "4.5.1", board: "GETFUNF405V3" },
        COM5: { variant: "INAV", target: "MATEKH743" },
        COM6: { variant: "ARDU", vehicle: 1 },
      },
      ENVS,
    );
    expect(got.map((f) => f.firmware)).toEqual(["openplane", "betaflight", "inav", "ardupilot", "unknown", "dfu"]);
    expect(got[0]).toMatchObject({ vehicle: "copter", version: "abcdef1", env: { env: "matek-h743-quad" } });
    expect(got[1]).toMatchObject({ name: "Betaflight", version: "4.5.1", env: { env: "getfun-f405v3-quad" } });
    expect(got[1].vehicle).toBeUndefined();
    expect(got[2].env?.env).toBe("matek-h743-quad");
    expect(got[3]).toMatchObject({ name: "ArduPilot", vehicle: "plane" });
  });

  it("MAV_TYPE → на чём летает", () => {
    expect(mavVehicle(2)).toBe("copter");
    expect(mavVehicle(13)).toBe("copter");
    expect(mavVehicle(1)).toBe("plane");
    expect(mavVehicle(20)).toBe("vtol");
    expect(mavVehicle(10)).toBe("other");
    expect(mavVehicle(undefined)).toBeUndefined();
  });
});

describe("что на борту по дампу", () => {
  it("датчики, OSD, флеш, приёмник, GPS, VTX и регуляторы", () => {
    const b = parseBoardDump(DUMP);
    expect(b).toMatchObject({
      firmware: "Betaflight",
      version: "4.5.1",
      mcu: "STM32F405",
      board: "GETFUNF405V3",
      manufacturer: "GETF",
      gyro: "ICM42688P",
      baro: "DPS310",
      osd: "MAX7456",
      storage: "flash 16M",
      rx: { protocol: "CRSF", uart: 2 },
      gps: { uart: 6 },
      vtx: { protocol: "SmartAudio", uart: 4 },
      esc: { protocol: "DSHOT300", bidir: true },
    });
    expect(b.mag).toBeUndefined();
    expect(b.features).toEqual(["GPS"]);
  });

  it("пустой файл — пусто, без падения", () => {
    expect(parseBoardDump("")).toEqual({ features: [] });
  });
});

describe("что не переносится", () => {
  it("группами со смыслом, set — именами", () => {
    const g = notMoved(["resource MOTOR 1 B00", "timer B00 AF2", "serial 1 64 115200 57600 0 115200", "feature GPS", "set osd_warn_bitmask = 1", "set foo_bar = 3", "led 0 0,0::C:0", "whatever 1"]);
    expect(g.map((x) => x.key)).toEqual(["pins", "serial", "feature", "set", "led", "other"]);
    expect(g[0].lines).toHaveLength(2);
    expect(g[3].lines).toEqual(["osd_warn_bitmask", "foo_bar"]);
  });
});
