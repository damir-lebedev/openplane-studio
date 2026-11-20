import { describe, expect, it } from "vitest";

import type { CopterBoard, CopterParam } from "./copterParams";
import { accZeroTiltDeg, boardRotated, dragText, gyroCalibration, mahonyActive, parseAccCalibration } from "./imuAlign";

function board(values: Record<string, string | number>): CopterBoard {
  const params: Record<string, CopterParam> = {};
  for (const [name, value] of Object.entries(values)) {
    params[name] = { name, type: typeof value === "number" ? "int" : "string", group: "other", scope: "master", default: 0, from: "table", units: "", text: "", value, set: true };
  }
  return { header: null, params, order: Object.keys(values), rc: null, modes: [], loading: false, loadedAt: 0, pending: {}, errors: {} } as unknown as CopterBoard;
}

describe("плата на раме", () => {
  it("acc_calibration — как в прошивке: четыре целых, x..z ±999, флаг 0/1", () => {
    expect(parseAccCalibration("41,-20,61,1")).toEqual({ zero: [41, -20, 61], done: true });
    expect(parseAccCalibration(" 0, 0, 0, 0 ")).toEqual({ zero: [0, 0, 0], done: false });
    expect(parseAccCalibration("")).toEqual({ zero: [0, 0, 0], done: false });
    expect(parseAccCalibration("1000,0,0,1")).toBeNull();
    expect(parseAccCalibration("1,2,3")).toBeNull();
    expect(parseAccCalibration("1,2,3,2")).toBeNull();
    expect(parseAccCalibration("1.5,2,3,1")).toBeNull();
  });

  it("нуль в градусах горизонта: 179/2048 g по X ≈ 5°", () => {
    expect(accZeroTiltDeg({ zero: [179, 0, 0], done: true })).toBeCloseTo(5.0, 1);
    expect(accZeroTiltDeg({ zero: [0, 0, 40], done: true })).toBe(0);
  });

  it("калибровка гироскопа: 125 → 1.25 с, 48 LSB ≈ 2.9 °/с, 0 — без проверки", () => {
    expect(gyroCalibration(board({ gyro_calib_duration: 125, gyro_calib_noise_limit: 48 }))).toEqual({ seconds: 1.25, noiseDps: 48 / 16.4 });
    expect(gyroCalibration(board({ gyro_calib_duration: 300, gyro_calib_noise_limit: 0 })).noiseDps).toBeNull();
  });

  it("поворот: 360 — то же, что 0; Махони — по attitude_filter", () => {
    expect(boardRotated(board({ align_board_yaw: 360 }))).toBe(false);
    expect(boardRotated(board({ align_board_yaw: 90 }))).toBe(true);
    expect(mahonyActive(board({ attitude_filter: "MAHONY" }))).toBe(true);
    expect(mahonyActive(board({ attitude_filter: "EKF" }))).toBe(false);
    expect(mahonyActive(board({}))).toBe(false);
  });

  it("сопротивление винтов из живого кадра", () => {
    expect(dragText([0.3124, 8.4])).toBe("0.312 1/с ±8%");
    expect(dragText([0, 50])).toBe("—");
    expect(dragText(undefined)).toBe("—");
  });
});
