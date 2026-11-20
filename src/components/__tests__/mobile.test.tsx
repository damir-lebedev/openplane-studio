// @vitest-environment jsdom
// Studio на телефоне (Android, P46): то, что требует ПК — сборка из исходников,
// подготовка компьютера, драйвер DFU, симулятор, обновление установщиком .exe — не видно.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const api = new Proxy({}, { get: () => () => Promise.resolve(undefined) });
  return { ...real, api };
});

const { isMobile } = await import("../../api");
const { useApp } = await import("../../store");
const { Rail } = await import("../Rail");
const { Settings, versionLine } = await import("../Settings");

const DESKTOP_UA = navigator.userAgent;
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const setUa = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

beforeEach(() => {
  useApp.setState({
    section: "hangar",
    // без анкеты: видны все разделы — «Симулятор» скрывает только телефон
    settings: {},
    info: { version: "0.5.0", platform: "android", hangar_dir: "", cache_dir: "", pio: null, python: null, firmware_guess: null },
  } as never);
});
afterEach(() => {
  cleanup();
  setUa(DESKTOP_UA);
});

describe("Studio на телефоне", () => {
  it("isMobile — по Android в User-Agent", () => {
    expect(isMobile()).toBe(false);
    setUa(ANDROID_UA);
    expect(isMobile()).toBe(true);
  });

  it("на ПК симулятор есть, на телефоне — нет", () => {
    render(<Rail />);
    const hasSim = !!screen.queryByText("Симулятор");
    cleanup();
    setUa(ANDROID_UA);
    render(<Rail />);
    expect(screen.queryByText("Симулятор")).toBeNull();
    expect(screen.getByText("Ангар")).toBeTruthy();
    // на ПК с этим профилем он виден — значит, скрыл именно телефон
    expect(hasSim).toBe(true);
  });

  it("«Настройки» на телефоне: язык и профиль, без исходников, подготовки и обновлений", () => {
    setUa(ANDROID_UA);
    render(<Settings />);
    expect(screen.getByText("Язык")).toBeTruthy();
    expect(screen.getByText("Профиль пилота")).toBeTruthy();
    for (const pc of ["Исходники прошивки", "Подготовка компьютера", "Сборка и прошивка", "Обновления"]) {
      expect(screen.queryByText(pc)).toBeNull();
    }
  });

  it("«Настройки» на ПК — всё на месте", () => {
    render(<Settings />);
    for (const pc of ["Исходники прошивки", "Подготовка компьютера", "Сборка и прошивка", "Обновления"]) {
      expect(screen.getAllByText(pc).length).toBeGreaterThan(0);
    }
  });
});

describe("строка версии для отчётов (P53)", () => {
  it("телефон: ABI как в CPU-Z и версия Android из User-Agent", () => {
    const base = { version: "0.6.1", platform: "android" };
    expect(versionLine({ ...base, arch: "arm" }, ANDROID_UA)).toBe("OpenPlane Studio 0.6.1 · android armeabi-v7a · Android 14");
    expect(versionLine({ ...base, arch: "aarch64" }, ANDROID_UA)).toBe("OpenPlane Studio 0.6.1 · android arm64-v8a · Android 14");
    expect(versionLine({ version: "0.6.1", platform: "windows", arch: "x86_64" }, DESKTOP_UA)).toBe("OpenPlane Studio 0.6.1 · windows x86_64");
    // старая сборка без arch
    expect(versionLine({ version: "0.5.0", platform: "windows" }, DESKTOP_UA)).toBe("OpenPlane Studio 0.5.0 · windows");
    expect(versionLine(null)).toBe("OpenPlane Studio");
  });

  it("в «Настройках» — строка и кнопка «Скопировать»", () => {
    useApp.setState({ info: { version: "0.6.1", platform: "android", arch: "arm", hangar_dir: "", cache_dir: "", pio: null, python: null, firmware_guess: null } } as never);
    setUa(ANDROID_UA);
    render(<Settings />);
    expect(screen.getByText("OpenPlane Studio 0.6.1 · android armeabi-v7a · Android 14")).toBeTruthy();
    expect(screen.getByText("Скопировать")).toBeTruthy();
  });
});
