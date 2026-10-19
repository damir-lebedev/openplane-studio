import { describe, expect, it } from "vitest";

import { LiveFrame } from "../api";
import manifestJson from "./__fixtures__/manifest.json";
import { assignChannel, channelClashes, channelIndex, channelReversed, toggleChannelReversed, toggleFlag } from "./channels";
import {
  armBlockHint,
  ChannelWatch,
  expectedAddresses,
  extraDevices,
  procLine,
  procStart,
  sensorRows,
  switchPosition,
} from "./live";
import { Manifest } from "./manifest";
import { effectiveParam, importFromFirmware, PlaneProject, toFirmwareConfig } from "./project";
import { validate } from "./rules";

const manifest = manifestJson as unknown as Manifest;

function plane(patch: (p: PlaneProject) => void = () => {}): PlaneProject {
  const p = importFromFirmware(manifest, "Тест", "stm32h743-devebox");
  patch(p);
  return p;
}

function frame(patch: Partial<LiveFrame> = {}): LiveFrame {
  return {
    t: 1000,
    arm: false,
    mode: "MANUAL",
    rx: "ok",
    ch: [1500, 1500, 1000, 1500, 1000, 1000, 1000, 1500, 1500, 1500],
    out: [1500, 1500, 1500, 1500, 1000, 1500, 1500],
    rev: false,
    imu: "ok",
    att: [0, 0, 0],
    mount: true,
    park: false,
    baro: "ok",
    alt: 0,
    vz: 0,
    mag: "ok",
    hdg: 0,
    magcal: false,
    gps: "none",
    pitot: "none",
    block: null,
    cal: null,
    feat: [],
    hz: 500,
    ...patch,
  };
}

const run = (kind: Parameters<typeof procStart>[0], lines: string[]) =>
  lines.reduce((p, l) => procLine(p, l), procStart(kind, 0));

describe("процедуры наладки по тексту консоли", () => {
  it("установка IMU: шаги и итог", () => {
    const p = procStart("mount", 0);
    const s2 = procLine(procLine(p, "MPU6050: калибровка установки — плата может стоять в самолёте как угодно."), "  Шаг 2/3: поднимите НОС на 30-60° (крылья ровно) и держите.");
    expect(s2.step).toBe(2);
    expect(s2.state).toBe("run");
    const done = procLine(s2, "MPU6050: установка сохранена: X->-Y, Y->X, Z->Z");
    expect(done.state).toBe("ok");
    expect(done.text).toBe("X->-Y, Y->X, Z->Z");
  });

  it("установка IMU: отказ и таймаут позы — с причиной", () => {
    expect(run("mount", ["MPU6050: калибровка установки отклонена — позы слишком близко"]).text).toBe("позы слишком близко");
    const late = run("mount", ["  Шаг 1/3: ...", "MPU6050: поза не дождалась за 30 с — калибровка установки отменена"]);
    expect(late.state).toBe("fail");
    expect(late.text).toMatch(/30 с/);
  });

  it("заармлено — любая калибровка отказ", () => {
    expect(run("compass", ["Консоль: команда недоступна, пока заармлено"])).toMatchObject({ state: "fail", text: "команда недоступна, пока заармлено" });
  });

  it("калибровка на земле: два шага, ошибка без хвоста «Ничего не сохранено»", () => {
    const ok = run("ground", [
      "Калибровка самолёта (консоль)",
      "  Шаг 1/2 — ГОРИЗОНТ: поставьте самолёт ровно",
      "  Шаг 1 засчитан: горизонт.",
      "  Шаг 2/2 — СТОЯНКА: поставьте самолёт на колёса на ровное место и уберите руки.",
      "  Стоянка: нос вверх на 11.5°, крен 0.3°",
      "Калибровка самолёта сохранена: горизонт и стоянка.",
    ]);
    expect(ok).toMatchObject({ state: "ok", step: 2 });
    const bad = run("ground", ["Калибровка самолёта: ОШИБКА — нос почти не задран. Ничего не сохранено."]);
    expect(bad).toMatchObject({ state: "fail", text: "нос почти не задран" });
  });

  it("гироскоп: итог по предполётной проверке", () => {
    expect(run("gyro", ["MPU6050: калибровка завершена, смещение гироскопа=1,2,3, шум=0.05 °/с", "MPU6050: предполётная проверка пройдена"]).state).toBe("ok");
    expect(run("gyro", ["MPU6050: ПРЕДПОЛЁТНАЯ ПРОВЕРКА НЕ ПРОЙДЕНА — IMU: самолёт двигали"])).toMatchObject({ state: "fail", text: "IMU: самолёт двигали" });
  });

  it("чужие строки процедуру не трогают", () => {
    const p = procStart("compass", 0);
    expect(procLine(p, "RX=OK alt=12.3")).toBe(p);
  });
});

describe("датчики на шине", () => {
  it("барометр BMP581 рядом с трубкой на BMP581 ищется только на 0x46", () => {
    const p = plane((p) => {
      p.sensors.baro = "SENSOR_BARO_BMP581";
      p.sensors.airspeed = "SENSOR_AIRSPEED_PITOT_BMP581";
    });
    expect(expectedAddresses(p, "baro")).toEqual([0x46]);
    expect(expectedAddresses(p, "airspeed")).toEqual([0x47]);
    expect(expectedAddresses(p, "gps")).toBeNull();
  });

  it("не отвечает — красный с адресами; отвечает — с адресом; лишние на шине видны", () => {
    const p = plane((p) => {
      p.sensors.imu = "SENSOR_IMU_MPU6050";
      p.sensors.baro = "SENSOR_BARO_BMP581";
      p.sensors.mag = "SENSOR_MAG_QMC5883P";
    });
    const scan = { sensor: [{ a: 0x68, g: "MPU" }, { a: 0x3c, g: "OLED SSD1306" }], screen: null };
    const rows = sensorRows(manifest, p, frame({ baro: "noresp", mag: "noresp" }), scan);
    const by = Object.fromEntries(rows.map((r) => [r.cat, r]));
    expect(by.imu.state).toBe("ok");
    expect(by.imu.text).toMatch(/0x68/);
    expect(by.baro.state).toBe("bad");
    expect(by.baro.text).toMatch(/0x46 \/ 0x47/);
    expect(by.gps.state).toBe("off");
    expect(extraDevices(p, scan)).toEqual([{ a: 0x3c, g: "OLED SSD1306" }]);
  });

  it("компас на внешнем разъёме (своя шина у Matek) — тоже находится", () => {
    const p = plane((p) => (p.sensors.mag = "SENSOR_MAG_QMC5883L"));
    const scan = { sensor: [{ a: 0x76, g: "DPS310" }], ext: [{ a: 0x0d, g: "QMC5883L" }, { a: 0x50, g: "?" }], screen: null };
    const rows = sensorRows(manifest, p, frame({ mag: "noresp" }), scan);
    expect(rows.find((r) => r.cat === "mag")!.state).toBe("warn");
    expect(extraDevices(p, scan).map((d) => d.a)).toContain(0x50);
    expect(extraDevices(p, scan).map((d) => d.a)).not.toContain(0x0d);
  });

  it("на шине есть, а прошивка не видит — другой чип с тем же адресом", () => {
    const p = plane((p) => (p.sensors.mag = "SENSOR_MAG_QMC5883P"));
    const rows = sensorRows(manifest, p, frame({ mag: "noresp" }), { sensor: [{ a: 0x2c, g: "QMC5883P" }] });
    expect(rows.find((r) => r.cat === "mag")!.state).toBe("warn");
  });
});

describe("пульт по живым кадрам", () => {
  it("положения тумблеров — как в прошивке", () => {
    expect([1000, 1500, 2000].map((v) => switchPosition(v, 3))).toEqual([0, 1, 2]);
    expect([1000, 2000].map((v) => switchPosition(v, 2))).toEqual([0, 1]);
  });

  it("сбитый триммер видно, когда стики отпущены; невыведенный канал — ровно 1500", () => {
    const w = new ChannelWatch();
    for (let i = 0; i < 25; i++) w.push(frame({ ch: [1530, 1500, 1000, 1500, 1000, 1000, 1000, 1500, 1500, 1500] }));
    expect(w.trimOffset(0)).toBe(30);
    expect(w.trimOffset(1)).toBeNull();
    expect(w.silent(8)).toBe(true);
    expect(w.silent(2)).toBe(false);
  });
});

describe("раскладка каналов", () => {
  it("тумблер пришёл на другой канал — меняются местами, ARM с SwA — вместе", () => {
    const p = plane();
    assignChannel(manifest, p, "SWB", 6);
    expect(channelIndex(manifest, p, "SWB")).toBe(6);
    expect(channelIndex(manifest, p, "SWC")).toBe(5);
    expect(channelClashes(manifest, p)).toEqual([]);
    assignChannel(manifest, p, "SWA", 7);
    expect(channelIndex(manifest, p, "ARM")).toBe(7);
    expect(channelIndex(manifest, p, "SWD")).toBe(4);
    expect(channelClashes(manifest, p)).toEqual([]);
    expect(toFirmwareConfig(manifest, p).channels).toEqual({ SWB: 6, SWC: 5, ARM: 7, SWA: 7, SWD: 4 });
  });

  it("вернули на место — правка убирается", () => {
    const p = plane();
    assignChannel(manifest, p, "SWB", 6);
    assignChannel(manifest, p, "SWB", 5);
    expect(p.channels).toEqual({});
  });

  it("два органа на одном канале — ошибка проверки", () => {
    const p = plane((p) => (p.channels = { SWB: 6 }));
    expect(validate(manifest, p).some((i) => i.level === "error" && i.text.includes("CH7"))).toBe(true);
  });

  it("реверс канала — на плате; газ не переворачивается", () => {
    const p = plane();
    toggleChannelReversed(manifest, p, 0);
    expect(channelReversed(manifest, p, 0)).toBe(true);
    toggleChannelReversed(manifest, p, 2);
    expect(channelReversed(manifest, p, 2)).toBe(false);
    toggleChannelReversed(manifest, p, 0);
    expect(p.params.CHANNEL_REVERSED).toBeUndefined();
  });

  it("«нет, наоборот» переворачивает ровно один флаг", () => {
    const p = plane();
    const before = effectiveParam(manifest, p, "AILERON_RIGHT_REVERSED");
    toggleFlag(manifest, p, "AILERON_RIGHT_REVERSED");
    expect(effectiveParam(manifest, p, "AILERON_RIGHT_REVERSED")).toBe(!before);
    expect(effectiveParam(manifest, p, "AILERON_LEFT_REVERSED")).toBe(false);
  });
});

describe("шасси для прошивки", () => {
  it("без шасси — как носовое колесо: стоянка ровно, калибровка на земле проходит", () => {
    const p = plane((p) => (p.airframe.gear = "none"));
    expect(toFirmwareConfig(manifest, p).params.LANDING_GEAR).toBe("NOSE_WHEEL");
    expect(effectiveParam(manifest, p, "LANDING_GEAR")).toBe("LandingGear::NOSE_WHEEL");
  });
});

describe("почему не армится", () => {
  it("каждой причине прошивки — что сделать", () => {
    expect(armBlockHint("газ не на минимуме").check).toBe("tx");
    expect(armBlockHint("нет калибровки шасси (горизонт и стоянка) — с пульта без ARM или 'c' в консоли").fix).toBe("ground");
    expect(armBlockHint("IMU: самолёт двигали во время калибровки гироскопа — поставьте неподвижно и перезагрузите (или 'i')").fix).toBe("gyro");
    expect(armBlockHint('IMU: "верх" не совпадает с калибровкой установки').fix).toBe("mount");
    const fc = armBlockHint("IMU на плате полётника: установка не откалибрована — три позы, 'o' (или «Наладка» в OpenPlane Studio)");
    expect(fc.fix).toBe("mount");
    expect(fc.what).toBe("установка IMU не откалибрована");
    expect(armBlockHint("барометр не отвечает, а выбранному режиму нужна высота").check).toBe("sensors");
  });
});
