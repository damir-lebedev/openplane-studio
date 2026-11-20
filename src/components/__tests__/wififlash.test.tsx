// @vitest-environment jsdom
// P50: самолёт на ESP32 прошивается по WiFi — с ПК (сборка → по сети платы) и с
// телефона (готовый файл, Studio сама подключается к точке самолёта). Плата и Rust — фейки.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifestJson from "../../core/__fixtures__/manifest.json";
import type { Manifest } from "../../core/manifest";
import { setParamValue } from "../../core/params";
import { importFromFirmware } from "../../core/project";
import { checkOtaStatus, checkWifiBin, explainWifiError, planeWifi, type OtaStatus } from "../../core/wifiFlash";

const calls: { name: string; args: unknown[] }[] = [];
const replies: Record<string, unknown> = {};
let progress: ((p: { phase: string; fraction: number }) => void) | null = null;

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const api = new Proxy(
    {},
    {
      get: (_, prop: string) =>
        (...args: unknown[]) => {
          calls.push({ name: prop, args });
          if (prop === "wifiFlash") for (const f of [0, 0.5, 1]) progress?.({ phase: "upload", fraction: f });
          const raw = replies[prop];
          const r = typeof raw === "function" ? (raw as () => unknown)() : raw;
          if (r instanceof Error) return Promise.reject(r.message);
          if (prop in replies) return Promise.resolve(r);
          return Promise.resolve(prop.endsWith("List") || prop === "hangarHistory" ? [] : undefined);
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
const { runWifiFlash } = await import("../../flash");
const { WifiFlashButton } = await import("../board/WifiFlashButton");

const manifest = manifestJson as unknown as Manifest;
const tr = (s: string, vars?: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? `{${k}}`));

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 15; 2409BRN2CG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
const DESKTOP_UA = navigator.userAgent;
const setUa = (ua: string) => Object.defineProperty(navigator, "userAgent", { value: ua, configurable: true });

const OPEN: OtaStatus = { board: "esp32-s3", commit: "abc1234", config: "old", open: true, left_ms: 240000, receiving: false, armed: false };

function plane(board = "esp32-s3") {
  const p = importFromFirmware(manifest, "Планер", board);
  useApp.setState({ manifest, planes: [p], currentId: p.id, flash: null, settings: { firmwareSource: "C:/fw" } } as never);
  return p;
}

const espBin = (name: string, size = 4096) => {
  const b = new Uint8Array(size);
  b[0] = 0xe9;
  return new File([b], name);
};
const names = () => calls.map((c) => c.name);
const done = () => useApp.getState().flash;

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(replies)) delete replies[k];
  replies.wifiJoin = false;
  replies.wifiStatus = OPEN;
  replies.wifiWait = { ...OPEN, commit: "def5678", config: "new", open: false };
  setUa(DESKTOP_UA);
});
afterEach(() => {
  cleanup();
  setUa(DESKTOP_UA);
});

describe("core/wifiFlash", () => {
  it("сеть платы — из проекта самолёта", () => {
    const p = plane();
    expect(planeWifi(manifest, p)).toEqual({ ssid: "OpenPlane-Debug", password: "12345678" });
    setParamValue(manifest, p, "WIFI_AP_SSID", "Борт-1");
    setParamValue(manifest, p, "WIFI_AP_PASSWORD", "secret-pass");
    expect(planeWifi(manifest, p)).toEqual({ ssid: "Борт-1", password: "secret-pass" });
  });

  it("файл: .bin, не больше 2 МБ, своей платы", () => {
    expect(checkWifiBin({ name: "plane-esp32-s3.bin", size: 900_000 }, "esp32-s3", tr)).toBeNull();
    expect(checkWifiBin({ name: "firmware.bin", size: 900_000 }, "esp32-s3", tr)).toBeNull(); // имя без сборки — плата проверит образ
    expect(checkWifiBin({ name: "plane-esp32-c3.bin", size: 900_000 }, "esp32-s3", tr)).toMatch(/esp32-c3.*esp32-s3/);
    expect(checkWifiBin({ name: "firmware-matek-h743.bin", size: 900_000 }, "esp32-s3", tr)).toMatch(/matek-h743/);
    expect(checkWifiBin({ name: "plane.elf", size: 10 }, "esp32-s3", tr)).toMatch(/\.bin/);
    expect(checkWifiBin({ name: "big-esp32-s3.bin", size: 3 * 1024 * 1024 }, "esp32-s3", tr)).toMatch(/2048/);
    expect(checkWifiBin({ name: "x-esp32-s3.bin", size: 0 }, "esp32-s3", tr)).toMatch(/пустой/);
  });

  it("паспорт платы: чужая плата, ARM, закрытое окно", () => {
    expect(checkOtaStatus(OPEN, "esp32-s3", tr)).toBeNull();
    expect(checkOtaStatus({ ...OPEN, board: "esp32-c3" }, "esp32-s3", tr)).toMatch(/esp32-c3/);
    expect(checkOtaStatus({ ...OPEN, armed: true }, "esp32-s3", tr)).toMatch(/ARM/);
    expect(checkOtaStatus({ ...OPEN, open: false }, "esp32-s3", tr)).toMatch(/рысканье вправо/);
  });

  it("коды платы и Rust — фразы", () => {
    expect(explainWifiError("NO_BOARD: 192.168.4.1 не отвечает", "Борт", tr).text).toMatch(/«Борт»/);
    expect(explainWifiError("CLOSED: плата ответила 403", "x", tr).title).toBe("Окно прошивки закрыто");
    expect(explainWifiError("NO_OTA: …", "x", tr).retry).toBe(false);
    expect(explainWifiError("IMAGE: Magic byte is wrong", "x", tr).text).toMatch(/Magic byte is wrong/);
    expect(explainWifiError("что-то странное", "x", tr).title).toBe("Прошивка не удалась");
  });
});

describe("runWifiFlash", () => {
  it("ПК: сборка → паспорт → образ путём → плата вернулась с хэшем проекта", async () => {
    const p = plane();
    replies.firmwareCommit = "abc1234";
    replies.firmwarePrepare = { dir: "C:/work/p", copied: 1 };
    replies.firmwareApply = { ok: true, changed: [] };
    replies.firmwareBuild = { ok: true, tail: "", firmware: "C:/work/p/.pio/build/esp32-s3/firmware.bin" };
    // хэш считает Studio — плата «возвращается» с тем, что ушло в config.project
    const applied = () => (calls.find((c) => c.name === "firmwareApply")!.args[2] as { project: { configHash: string } }).project.configHash;
    replies.wifiWait = () => ({ ...OPEN, config: applied(), open: false });
    await runWifiFlash(p.id, "build");
    const sentHash = applied();
    const f = done()!;
    expect(f.error).toBeUndefined();
    expect(f.done?.verified).toBe(true);
    expect(f.done?.text).toMatch(/По WiFi|по WiFi/);
    const sent = calls.find((c) => c.name === "wifiFlash")!;
    expect(sent.args[0]).toBeNull();
    expect(sent.args[1]).toMatchObject({ path: "C:/work/p/.pio/build/esp32-s3/firmware.bin", name: "Планер-esp32-s3.bin" });
    expect(names()).not.toContain("wifiRelease"); // ПК к сети не подключали
    expect(useApp.getState().planes[0].lastFlash).toMatchObject({ ok: true, configHash: sentHash, note: "wifi" });
  });

  it("телефон: файл → подключение к точке самолёта → образ байтами → отвязка от сети", async () => {
    setUa(ANDROID_UA);
    const p = plane();
    setParamValue(manifest, p, "WIFI_AP_SSID", "Борт-1");
    useApp.setState({ planes: [p] } as never);
    replies.wifiJoin = true;
    await runWifiFlash(p.id, espBin("Планер-esp32-s3.bin"));
    const f = done()!;
    expect(f.error).toBeUndefined();
    expect(f.done?.verified).toBe(true);
    expect(calls.find((c) => c.name === "wifiJoin")!.args).toEqual(["Борт-1", "12345678"]);
    const sent = calls.find((c) => c.name === "wifiFlash")!;
    expect((sent.args[0] as Uint8Array).length).toBe(4096);
    expect(names()).toContain("wifiRelease");
    expect(names()).not.toContain("firmwareBuild");
    expect(useApp.getState().planes[0].lastFlash?.note).toBe("wifi · Планер-esp32-s3.bin");
  });

  it("окно закрыто — не шлём, объясняем жест", async () => {
    const p = plane();
    replies.wifiStatus = { ...OPEN, open: false };
    await runWifiFlash(p.id, espBin("p-esp32-s3.bin"));
    expect(done()!.error?.text).toMatch(/рысканье вправо/);
    expect(names()).not.toContain("wifiFlash");
  });

  it("плата отказала посреди (ARM) — фраза, повтор той же кнопкой", async () => {
    setUa(ANDROID_UA);
    const p = plane();
    replies.wifiJoin = true;
    replies.wifiFlash = new Error("ARMED: плата ответила 403");
    await runWifiFlash(p.id, espBin("p-esp32-s3.bin"));
    expect(done()!.error).toMatchObject({ title: "Плата заармлена", action: "retry" });
    expect(names()).toContain("wifiRelease"); // и при ошибке отпускаем сеть
  });

  it("чужой файл не уходит в сеть", async () => {
    const p = plane();
    await runWifiFlash(p.id, espBin("firmware-matek-h743.bin"));
    expect(done()!.error?.title).toBe("Этот файл не подойдёт");
    expect(names()).not.toContain("wifiJoin");
  });

  it("ПК, экспорт для телефона: сборка → файл в «Загрузки», плата не нужна", async () => {
    const p = plane();
    replies.firmwareCommit = "abc1234";
    replies.firmwarePrepare = { dir: "C:/work/p", copied: 1 };
    replies.firmwareApply = { ok: true, changed: [] };
    replies.firmwareBuild = { ok: true, tail: "", firmware: "C:/work/p/.pio/build/esp32-s3/firmware.bin" };
    replies.firmwareExportBin = "C:/Users/u/Downloads/Планер-esp32-s3.bin";
    await runWifiFlash(p.id, "export");
    expect(done()!.done?.text).toMatch(/Прошить по WiFi/);
    expect(calls.find((c) => c.name === "firmwareExportBin")!.args).toEqual(["C:/work/p", "esp32-s3", "Планер-esp32-s3.bin"]);
    expect(names()).not.toContain("wifiStatus");
  });
});

describe("WifiFlashButton", () => {
  it("только у ESP32: на ПК «По WiFi» + экспорт, на телефоне — файлом", async () => {
    const stm = plane("stm32h743-devebox");
    const { container } = render(<WifiFlashButton plane={stm} />);
    expect(container.textContent).toBe("");
    cleanup();

    const esp = plane();
    render(<WifiFlashButton plane={esp} />);
    expect(screen.getByText("По WiFi")).toBeTruthy();
    expect(screen.getByText("Экспорт для телефона")).toBeTruthy();
    cleanup();

    setUa(ANDROID_UA);
    render(<WifiFlashButton plane={esp} />);
    expect(screen.queryByText("По WiFi")).toBeNull();
    replies.wifiJoin = true;
    fireEvent.change(screen.getByTestId("wifi-bin-file"), { target: { files: [espBin("Планер-esp32-s3.bin")] } });
    await vi.waitFor(() => expect(done()?.running).toBe(false));
    expect(names()).toContain("wifiFlash");
  });
});
