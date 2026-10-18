import { describe, expect, it } from "vitest";

import manifestJson from "./__fixtures__/manifest.json";
import { isNone, Manifest } from "./manifest";
import { effectiveParam } from "./project";
import { validate } from "./rules";
import { fromTemplate, TEMPLATES } from "./templates";

const manifest = manifestJson as unknown as Manifest;

describe("шаблоны самолётов", () => {
  for (const tpl of TEMPLATES) {
    it(`«${tpl.title}» — без ошибок, все тумблеры на месте`, () => {
      const p = fromTemplate(manifest, tpl, tpl.title);
      const errors = validate(manifest, p).filter((i) => i.level === "error");
      expect(errors.map((e) => e.text)).toEqual([]);
      expect(p.bindings.length).toBe(tpl.bindings.length);
      expect(p.airframe.template).toBe(tpl.id);
    });
  }

  it("«Термик»: без шасси, автовзлёт с руки на тумблере, Пито есть", () => {
    const p = fromTemplate(manifest, TEMPLATES.find((t) => t.id === "thermal")!, "Т");
    expect(p.airframe.gear).toBe("none");
    expect(p.bindings).toContainEqual({ kind: "mode", channel: "SWD", mode: "MODE_LAUNCH" });
    expect(isNone(p.sensors.airspeed)).toBe(false);
  });

  it("«Ученик»: крен ограничен, геозабор и домой при потере связи — с GPS", () => {
    const p = fromTemplate(manifest, TEMPLATES.find((t) => t.id === "student")!, "У");
    expect(effectiveParam(manifest, p, "MAX_BANK_DEG")).toBe(35);
    expect(effectiveParam(manifest, p, "GEOFENCE_ALWAYS_ON")).toBe(true);
    expect(isNone(p.sensors.gps)).toBe(false);
  });

  it("чего нет в прошивке — пропускается молча", () => {
    const tpl = { ...TEMPLATES[0], bindings: [...TEMPLATES[0].bindings, { kind: "feature" as const, channel: "SWA", feature: "FLAPS" }], params: { NO_SUCH_PARAM: 1 } };
    const p = fromTemplate(manifest, tpl, "X");
    expect(p.bindings.some((b) => b.channel === "SWA")).toBe(false);
    expect("NO_SUCH_PARAM" in p.params).toBe(false);
  });
});
