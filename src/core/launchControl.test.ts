import { describe, expect, it } from "vitest";
import { launchMotors, launchPictureAngle, launchPitchRate } from "./launchControl";

describe("launch control (037)", () => {
  it("стик: 100 °/с на половине хода, дальше не быстрее", () => {
    expect(launchPitchRate(-0.5, 0, "NORMAL", 0)).toBeCloseTo(-100);
    expect(launchPitchRate(-1, 0, "NORMAL", 0)).toBeCloseTo(-100);
    expect(launchPitchRate(0.25, 0, "NORMAL", 0)).toBeCloseTo(50);
  });

  it("PITCHONLY — только нос вниз, задними моторами", () => {
    expect(launchPitchRate(0.5, 0, "PITCHONLY", 0)).toBe(0);
    expect(launchMotors("PITCHONLY")).toEqual({ front: false, rear: true });
    expect(launchMotors("NORMAL").front).toBe(true);
  });

  it("предел наклона: у предела медленнее, за ним — назад (как прошивка)", () => {
    expect(launchPitchRate(-0.5, -25, "NORMAL", 30)).toBeCloseTo(-(5 + 0.5 * 95));
    expect(launchPitchRate(-0.5, -35, "NORMAL", 30)).toBeCloseTo(20);
    expect(launchPitchRate(0, -30, "NORMAL", 30)).toBe(0);
  });

  it("картинка: предел или пример без предела", () => {
    expect(launchPictureAngle(30)).toEqual({ deg: 30, limited: true });
    expect(launchPictureAngle(0)).toEqual({ deg: 45, limited: false });
  });
});
