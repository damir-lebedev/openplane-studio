// @vitest-environment jsdom
// P48: телефон прошивает готовым .bin (кнопка «Прошить файлом»), ПК делает
// этот файл кнопкой «Экспорт для телефона». Плата и Rust — фейки.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { name: string; args: unknown[] }[] = [];
const replies: Record<string, unknown> = {};
let progress: ((p: { phase: string; fraction: number }) => void) | null = null;

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const lists = new Set(["hangarHistory", "devicesList", "portHolders", "firmwareVersions", "hangarList"]);
  const api = new Proxy(
    {},
    {
      get: (_, prop: string) =>
        (...args: unknown[]) => {
          calls.push({ name: prop, args });
          if (prop === "flashBin") {
            for (const phase of ["bootloader", "erase", "write", "verify", "done"]) progress?.({ phase, fraction: 1 });
          }
          const r = replies[prop];
          if (r instanceof Error) return Promise.reject(r.message);
          if (prop in replies) return Promise.resolve(r);
          return Promise.resolve(lists.has(prop) ? [] : undefined);
        },
    },
  );
  return {
    ...real,
    api,
    inTauri: () => false,
    onTaskLog: () => Promise.resolve(() => {}),
    onFlashProgress: (h: typeof progress) => {
      progress = h;
      return Promise.resolve(() => (progress = null));
    },
  };
});

const { useApp } = await import("../../store");
const { CopterView } = await import("../CopterView");
const { runBinFlash, explainBinError } = await import("../../flash");
const { blankCopter } = await import("../../core/copter");

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; 2409BRN2CG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const DESKTOP_UA = navigator.userAgent;
const setUa = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

const ID = { fw: "openplane", proto: 3, board: "matek-h743-quad", commit: "abc1234", config: "", plane: "", armed: false, vehicle: "copter" };
const PORT = "usb:/dev/bus/usb/001/002";

function phone(identity = ID) {
  const copter = blankCopter(null, "Квадрик");
  copter.board = "matek-h743-quad";
  useApp.setState({
    copters: [copter],
    copterId: copter.id,
    flash: null,
    link: { port: PORT, state: "open", attemptAt: 0 },
    ports: { [PORT]: { identity, at: 0 } },
    devices: [{ port: PORT, kind: "stm32-cdc" }],
    settings: { copterMode: "pro" },
  } as never);
  return copter;
}

const bin = (name: string, size = 1024) => new File([new Uint8Array(size)], name);
const names = () => calls.map((c) => c.name);

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(replies)) delete replies[k];
  replies.flashBin = { chip: "h743", bytes: 1024, seconds: 3.2 };
  replies.devicesList = [{ port: PORT, kind: "stm32-cdc" }];
  replies.boardIdentity = { ...ID, commit: "def5678" };
});
afterEach(() => {
  cleanup();
  setUa(DESKTOP_UA);
});

describe("телефон: прошивка готовым .bin", () => {
  it("подходящий файл: 'D' по порту платы, чип h743, сверка, плата снова на связи", async () => {
    const copter = phone();
    await runBinFlash(copter.id, bin("firmware-matek-h743-quad.bin"));
    const flash = calls.find((c) => c.name === "flashBin")!;
    expect((flash.args[0] as Uint8Array).length).toBe(1024);
    expect(flash.args.slice(1)).toEqual([PORT, "h743"]);
    const state = useApp.getState();
    expect(state.flash?.error).toBeUndefined();
    expect(state.flash?.steps.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(state.flash?.done?.verified).toBe(true);
    expect(state.flash?.done?.text).toContain("def5678");
    expect(state.copters[0].lastFlash).toMatchObject({ board: "matek-h743-quad", commit: "def5678", ok: true, note: "firmware-matek-h743-quad.bin" });
  }, 15000);

  it("файл другой платы — отказ до загрузчика, flashBin не зовётся", async () => {
    const copter = phone();
    await runBinFlash(copter.id, bin("firmware-aocodarc-f405v3-quad.bin"));
    expect(names()).not.toContain("flashBin");
    const err = useApp.getState().flash?.error;
    expect(err?.title).toBe("Этот файл не подойдёт");
    expect(err?.text).toContain("aocodarc-f405v3-quad");
  });

  it("заармленная плата — отказ сразу; ответ Rust ARMED — понятная фраза", async () => {
    const copter = phone({ ...ID, armed: true });
    await runBinFlash(copter.id, bin("firmware-matek-h743-quad.bin"));
    expect(names()).not.toContain("flashBin");
    expect(useApp.getState().flash?.error?.title).toBe("Плата заармлена");

    const again = phone();
    replies.flashBin = new Error("ARMED: плата заармлена — снимите ARM и повторите");
    await runBinFlash(again.id, bin("firmware-matek-h743-quad.bin"));
    expect(useApp.getState().flash?.error?.title).toBe("Плата заармлена");
    expect(explainBinError("NO_DFU: …").action).toBe("bootloader");
    expect(explainBinError("WRONG_CHIP: прошивка для F405, а на столе H743").text).toBe("прошивка для F405, а на столе H743");
  });

  it("плата уже в DFU: порт не нужен (null), чип — по файлу", async () => {
    const copter = phone();
    useApp.setState({ link: { port: null, state: "idle", attemptAt: 0 }, ports: {}, devices: [{ port: null, kind: "stm32-dfu" }] } as never);
    await runBinFlash(copter.id, bin("firmware-matek-h743-quad.bin"));
    expect(calls.find((c) => c.name === "flashBin")!.args.slice(1)).toEqual([null, "h743"]);
  }, 15000);

  it("на телефоне вместо «Прошить» — «Прошить файлом», выбор файла запускает прошивку", async () => {
    setUa(ANDROID_UA);
    phone();
    render(<CopterView />);
    expect(screen.queryByText("Экспорт для телефона")).toBeNull();
    expect(screen.getByText("Прошить файлом")).toBeTruthy();
    const input = screen.getByTestId("bin-file") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [bin("firmware-aocodarc-f405v3-quad.bin")] } });
    await vi.waitFor(() => expect(useApp.getState().flash?.error?.title).toBe("Этот файл не подойдёт"));
  });
});

describe("телефон: «Скачать и прошить» из релиза (P49)", () => {
  it("скачивает firmware-<env>.bin по @id платы и шьёт его", async () => {
    const copter = phone();
    replies.releaseBin = new Uint8Array(2048).buffer;
    await runBinFlash(copter.id, { release: true });
    expect(calls.find((c) => c.name === "releaseBin")!.args).toEqual(["matek-h743-quad"]);
    expect((calls.find((c) => c.name === "flashBin")!.args[0] as Uint8Array).length).toBe(2048);
    expect(useApp.getState().copters[0].lastFlash).toMatchObject({ ok: true, note: "firmware-matek-h743-quad.bin" });
  }, 15000);

  it("сборки нет в релизе — понятный отказ без скачивания", async () => {
    const copter = phone({ ...ID, board: "getfun-f405v3-quad" });
    await runBinFlash(copter.id, { release: true });
    expect(names()).not.toContain("releaseBin");
    expect(useApp.getState().flash?.error?.title).toBe("Готовой прошивки нет");
  });

  it("файла в релизе нет (404) — совет «Экспорт для телефона»; нет сети — повтор", async () => {
    const copter = phone();
    replies.releaseBin = new Error("NOT_FOUND: в релизе нет файла");
    await runBinFlash(copter.id, { release: true });
    expect(useApp.getState().flash?.error?.title).toBe("В релизе нет файла");
    expect(names()).not.toContain("flashBin");
    replies.releaseBin = new Error("Unable to resolve host github.com");
    await runBinFlash(copter.id, { release: true });
    expect(useApp.getState().flash?.error).toMatchObject({ title: "Не скачалось", action: "retry" });
  });

  it("кнопка видна только для сборок из релиза", () => {
    setUa(ANDROID_UA);
    phone();
    render(<CopterView />);
    expect(screen.getByText("Скачать и прошить")).toBeTruthy();
    cleanup();
    phone({ ...ID, board: "getfun-f405v3-quad" });
    useApp.setState((s) => ({ copters: s.copters.map((c) => ({ ...c, board: "getfun-f405v3-quad" })) }));
    render(<CopterView />);
    expect(screen.queryByText("Скачать и прошить")).toBeNull();
    expect(screen.getByText("Прошить файлом")).toBeTruthy();
  });
});

describe("ПК: экспорт для телефона", () => {
  it("кнопка есть рядом с «Прошить»", () => {
    phone();
    render(<CopterView />);
    expect(screen.getByText("Экспорт для телефона")).toBeTruthy();
    expect(screen.getByText("Прошить")).toBeTruthy();
    expect(screen.queryByText("Прошить файлом")).toBeNull();
  });
});
