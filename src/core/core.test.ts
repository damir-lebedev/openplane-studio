import { describe, expect, it } from "vitest";

import manifestJson from "./__fixtures__/manifest.json";
import { Manifest } from "./manifest";
import { setParamValue } from "./params";
import { blankProject, configHash, effectiveParam, importFromFirmware, PlaneProject, receiverProtocol, setGear, toFirmwareConfig } from "./project";
import { availability, haveTokens, itemById, needText, validate } from "./rules";

// Описание прошивки из репозитория plane: npm run fixture.
const manifest = manifestJson as unknown as Manifest;

function plane(patch: (p: PlaneProject) => void = () => {}): PlaneProject {
  const p = importFromFirmware(manifest, "Тест", "stm32h743-devebox");
  patch(p);
  return p;
}

const errors = (p: PlaneProject) => validate(manifest, p).filter((i) => i.level === "error");

describe("что чему нужно", () => {
  it("RTH без GPS недоступен, и надпись — как в мастере", () => {
    const p = plane((p) => (p.sensors.gps = "SENSOR_GPS_NONE"));
    const rth = itemById(manifest, "mode", "MODE_RTH")!;
    const av = availability(rth, haveTokens(manifest, p));
    expect(av.state).toBe("unavailable");
    expect(av.missing).toEqual(["gps"]);
    expect(needText(manifest, "mode", rth.name, av.missing)).toBe("Для работы режима RTH нужны датчики: GPS");
  });

  it("закрылкам нужны две сервы — не датчик, поэтому «нужно:»", () => {
    const p = plane((p) => (p.airframe.ailerons = "one"));
    const flaps = itemById(manifest, "feature", "FLAPS")!;
    const av = availability(flaps, haveTokens(manifest, p));
    expect(needText(manifest, "feature", flaps.name, av.missing)).toBe("Для работы функции FLAPS нужно: элероны на двух сервах");
  });

  it("CRUISE без GPS и компаса работает, но хуже", () => {
    const p = plane((p) => {
      p.sensors.gps = "SENSOR_GPS_NONE";
      p.sensors.mag = "SENSOR_MAG_NONE";
    });
    const av = availability(itemById(manifest, "mode", "MODE_CRUISE")!, haveTokens(manifest, p));
    expect(av.state).toBe("degraded");
    expect(av.better).toEqual(expect.arrayContaining(["gps", "mag"]));
  });

  it("автовзлёт с полосы — только с шасси, автовзлёт с руки — и без него", () => {
    const p = plane((p) => (p.airframe.gear = "none"));
    const av = availability(itemById(manifest, "mode", "MODE_AUTO_TAKEOFF")!, haveTokens(manifest, p));
    expect(av.missing).toContain("wheels");
    expect(availability(itemById(manifest, "mode", "MODE_LAUNCH")!, haveTokens(manifest, p)).state).not.toBe("unavailable");
  });

  it("без шасси автовзлёт с полосы на тумблере сам меняется на автовзлёт с руки", () => {
    const p = plane();
    expect(p.bindings.some((b) => b.kind === "modes" && b.modes.includes("MODE_AUTO_TAKEOFF"))).toBe(true);
    expect(setGear(p, "none")).toContain("автовзлёт с руки");
    const modes = p.bindings.find((b) => b.kind === "modes");
    expect(modes && modes.kind === "modes" && modes.modes).toContain("MODE_LAUNCH");
    expect(errors(p)).toEqual([]);
    expect(setGear(p, "tail")).toBeNull(); // с колёсами взлёт с руки тоже работает — не трогаем
  });
});

describe("проверки перед прошивкой", () => {
  it("прошивка как есть — без ошибок", () => {
    expect(errors(plane())).toEqual([]);
  });

  it("убрал GPS, а RTH на тумблере — ошибка на шаге тумблеров", () => {
    const p = plane((p) => {
      p.sensors.gps = "SENSOR_GPS_NONE";
      p.bindings = [
        { kind: "modes", channel: "SWC", modes: ["MODE_MANUAL", "MODE_STABILIZE", "MODE_ALT_HOLD"] },
        { kind: "mode", channel: "SWD", mode: "MODE_RTH" },
      ];
    });
    const errs = errors(p);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ step: "switches", target: "SWD", text: "Для работы режима RTH нужны датчики: GPS" });
  });

  it("правила привязок — как static_assert в Controls.h", () => {
    const texts = (bindings: PlaneProject["bindings"]) => errors(plane((p) => (p.bindings = bindings))).map((e) => e.text);
    expect(texts([{ kind: "feature", channel: "SWA", feature: "FLAPS" }])[0]).toContain("занимать нельзя");
    expect(
      texts([
        { kind: "feature", channel: "SWB", feature: "FLAPS" },
        { kind: "knob", channel: "SWB", knob: "RATES" },
      ]).join(),
    ).toContain("уже есть назначение");
    expect(
      texts([
        { kind: "modes", channel: "SWC", modes: ["MODE_MANUAL", "MODE_STABILIZE"] },
        { kind: "modes", channel: "SWD", modes: ["MODE_MANUAL", "MODE_ACRO"] },
      ]).join(),
    ).toContain("только один");
    expect(texts([{ kind: "modes", channel: "SWB", modes: ["MODE_MANUAL", "MODE_STABILIZE", "MODE_ACRO"] }]).join()).toContain(
      "три режима на нём не поместятся",
    );
    expect(texts([]).join()).toContain("хотя бы один");
  });

  it("плата без выхода руля — ошибка, GPS на C3 — предупреждение про TX", () => {
    const p = plane((p) => {
      p.board = "esp32-c3";
      p.airframe.rudder = true;
      p.airframe.payload = false;
      p.airframe.camera = false;
      p.airframe.buzzer = false;
      p.sensors.gps = "SENSOR_GPS_UBLOX_M10";
    });
    const issues = validate(manifest, p);
    expect(issues.some((i) => i.level === "error" && i.target === "rudder")).toBe(true);
    expect(issues.some((i) => i.level === "warning" && i.target === "gps")).toBe(true);
  });

  it("предел газа ниже 100 % — напоминание про стенд", () => {
    const p = plane((p) => (p.params.THROTTLE_LIMIT_PCT = 50));
    expect(validate(manifest, p).some((i) => i.target === "THROTTLE_LIMIT_PCT" && i.level === "warning")).toBe(true);
  });

  it("новый самолёт с нуля проходит проверку", () => {
    expect(errors(blankProject(manifest, "Новый"))).toEqual([]);
  });
});

describe("конфигурация для прошивки", () => {
  it("самолёт → параметры Config.h", () => {
    const p = plane((p) => {
      p.airframe.esc = "normal";
      p.airframe.gear = "nose";
      p.params.RTH_ALTITUDE_M = 60;
    });
    const cfg = toFirmwareConfig(manifest, p);
    expect(cfg.params).toMatchObject({ ESC_BIDIRECTIONAL: false, LANDING_GEAR: "NOSE_WHEEL", RTH_ALTITUDE_M: 60 });
    expect(effectiveParam(manifest, p, "RTH_ALTITUDE_M")).toBe(60);
  });

  it("приёмник: iBUS по умолчанию, выбор уходит в RX_PROTOCOL прошивки", () => {
    const p = plane();
    expect(receiverProtocol(manifest, p)).toBe("IBUS");
    setParamValue(manifest, p, "RX_PROTOCOL", "CRSF");
    expect(receiverProtocol(manifest, p)).toBe("CRSF");
    expect(toFirmwareConfig(manifest, p).params.RX_PROTOCOL).toBe("CRSF");
    setParamValue(manifest, p, "RX_PROTOCOL", "IBUS");
    expect(p.params.RX_PROTOCOL).toBeUndefined();   // как в прошивке — правки нет
  });

  it("барометра «нет» — в прошивке остаётся драйвер по умолчанию", () => {
    const p = plane((p) => (p.sensors.baro = "none"));
    const cfg = toFirmwareConfig(manifest, p);
    expect(manifest.sensors.options.baro.map((o) => o.id)).toContain(cfg.sensors.baro);
    expect(haveTokens(manifest, p).baro).toBe(false);
  });

  it("пины — только для своей платы", () => {
    const p = plane((p) => {
      p.boardParams.BOARD_STM32H743 = { PIN_AUX1: "PE10" };
      p.boardParams.BOARD_ESP32_S3 = { PIN_AUX1: 14 };
    });
    expect(toFirmwareConfig(manifest, p).params.PIN_AUX1).toBe("PE10");
    p.board = "esp32-s3";
    expect(toFirmwareConfig(manifest, p).params.PIN_AUX1).toBe(14);
  });

  it("хэш конфигурации не зависит от порядка ключей и меняется с конфигурацией", async () => {
    const a = plane((p) => (p.params = { RTH_ALTITUDE_M: 50, MAX_BANK_DEG: 40 }));
    const b = plane((p) => (p.params = { MAX_BANK_DEG: 40, RTH_ALTITUDE_M: 50 }));
    const c = plane((p) => (p.params = { MAX_BANK_DEG: 40, RTH_ALTITUDE_M: 51 }));
    const h = (p: PlaneProject) => configHash(toFirmwareConfig(manifest, p), "75d8784");
    expect(await h(a)).toBe(await h(b));
    expect(await h(a)).not.toBe(await h(c));
    expect(await h(a)).toMatch(/^[0-9a-f]{12}$/);
  });
});
