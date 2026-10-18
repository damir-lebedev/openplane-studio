import { describe, expect, it } from "vitest";

import manifestJson from "./__fixtures__/manifest.json";
import { diffProjects, restoreConfig } from "./diff";
import { Manifest } from "./manifest";
import { setParamValue } from "./params";
import { importFromFirmware, PlaneProject } from "./project";

const manifest = manifestJson as unknown as Manifest;

function plane(): PlaneProject {
  return importFromFirmware(manifest, "Тест", "stm32h743-devebox");
}

describe("что изменилось", () => {
  it("одинаковые — пусто", () => {
    expect(diffProjects(manifest, plane(), plane())).toEqual([]);
  });

  it("словами: шасси, датчик, тумблер, параметр, канал", () => {
    const a = plane();
    const b = structuredClone(a);
    b.airframe.gear = "nose";
    b.sensors.gps = "SENSOR_GPS_UBLOX_M10";
    b.bindings = b.bindings.filter((x) => x.channel !== "SWB");
    setParamValue(manifest, b, "AILERON_RIGHT_REVERSED", false);
    b.channels = { SWC: 7, SWD: 6 };
    const changes = diffProjects(manifest, a, b);
    expect(changes).toContainEqual({ group: "Самолёт", what: "Шасси", from: "хвостовое колесо", to: "носовое колесо" });
    expect(changes.find((c) => c.what === "GPS")).toMatchObject({ from: "нет" });
    expect(changes.find((c) => c.group === "Тумблеры" && c.what === "SwB")).toMatchObject({ to: "не используется" });
    expect(changes).toContainEqual({ group: "Параметры", what: "Реверс: правый элерон", from: "да", to: "нет" });
    expect(changes).toContainEqual({ group: "Каналы", what: "SwC", from: "CH7", to: "CH8" });
  });

  it("каналы наоборот — номерами каналов", () => {
    const a = plane();
    const b = structuredClone(a);
    const list = Array(10).fill(false);
    list[0] = true;
    list[3] = true;
    setParamValue(manifest, b, "CHANNEL_REVERSED", list);
    expect(diffProjects(manifest, a, b)).toContainEqual({ group: "Параметры", what: "Каналы пульта наоборот", from: "нет", to: "CH1, CH4" });
  });

  it("правка, вернувшая значение прошивки, — не изменение", () => {
    const a = plane();
    const b = structuredClone(a);
    b.params.THROTTLE_LIMIT_PCT = 100;
    expect(diffProjects(manifest, a, b)).toEqual([]);
  });

  it("откат возвращает конфигурацию, но не имя, историю и наладку", () => {
    const old = plane();
    const now = structuredClone(old);
    now.name = "Новое имя";
    now.airframe.esc = "normal";
    now.params.THROTTLE_LIMIT_PCT = 30;
    now.setup = { tx: { at: "2026-10-18T10:00:00Z", config: "abc" } };
    restoreConfig(now, old);
    expect(diffProjects(manifest, old, now)).toEqual([]);
    expect(now.name).toBe("Новое имя");
    expect(now.setup?.tx?.config).toBe("abc");
  });
});
