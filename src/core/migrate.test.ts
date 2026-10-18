import { describe, expect, it } from "vitest";

import manifestJson from "./__fixtures__/manifest.json";
import { Manifest } from "./manifest";
import { fingerprint, isEmptyReport, migrationReport } from "./migrate";
import { importFromFirmware } from "./project";

const manifest = manifestJson as unknown as Manifest;

describe("прошивка обновилась", () => {
  it("та же прошивка — отчёт пустой", () => {
    const p = importFromFirmware(manifest, "Т", "stm32h743-devebox");
    expect(isEmptyReport(migrationReport(fingerprint(manifest), manifest, p))).toBe(true);
  });

  it("новый режим, убранная функция, поменявшееся число — и чьё значение не тронуто", () => {
    const old = fingerprint(manifest);
    old.modes = old.modes.filter((m) => m !== "MODE_SOARING");
    old.features = [...old.features, "OLD_FEATURE"];
    old.defaults = { ...old.defaults, RTH_ALTITUDE_M: 60, MAX_BANK_DEG: 30 };
    const p = importFromFirmware(manifest, "Т", "stm32h743-devebox");
    p.params.MAX_BANK_DEG = 40;
    const r = migrationReport(old, manifest, p);
    expect(r.addedModes).toEqual(["MODE_SOARING"]);
    expect(r.removedFeatures).toEqual(["OLD_FEATURE"]);
    expect(r.changedDefaults).toContainEqual({ name: "RTH_ALTITUDE_M", from: 60, to: 40, overridden: false, unit: "м" });
    expect(r.changedDefaults.find((c) => c.name === "MAX_BANK_DEG")?.overridden).toBe(true);
  });
});
