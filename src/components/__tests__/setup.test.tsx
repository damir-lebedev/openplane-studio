// @vitest-environment jsdom
// Мастер наладки на фейковой плате: живые кадры подаются в состояние, как их
// прислала бы прошивка (@live), вызовы Rust подменены. Проверяется то, что
// видит и нажимает пилот.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveFrame } from "../../api";
import manifestJson from "../../core/__fixtures__/manifest.json";
import type { Manifest } from "../../core/manifest";
import { effectiveParam, importFromFirmware, PlaneProject } from "../../core/project";

const sent: string[] = [];

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const lists = new Set(["hangarHistory", "devicesList", "portHolders", "firmwareVersions", "hangarList"]);
  const api = new Proxy(
    {},
    {
      get: (_, prop: string) =>
        (...args: unknown[]) => {
          if (prop === "linkCommand" || prop === "linkSend") sent.push(String(args[0]));
          return Promise.resolve(lists.has(prop) ? [] : undefined);
        },
    },
  );
  return { ...real, api, inTauri: () => false };
});

const { useApp } = await import("../../store");
const { SetupStep } = await import("../board/setup/SetupStep");

const manifest = manifestJson as unknown as Manifest;

function frame(patch: Partial<LiveFrame> = {}): LiveFrame {
  return {
    t: 1,
    arm: false,
    mode: "MANUAL",
    rx: "ok",
    ch: [1500, 1500, 1000, 1500, 1000, 1000, 1000, 1500, 1500, 1500],
    out: [1500, 1500, 1500, 1500, 1000, 1500, 1500],
    rev: false,
    imu: "ok",
    att: [0, 0, 0],
    mount: false,
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

function live(patch: Partial<LiveFrame> = {}) {
  act(() => {
    useApp.setState({ live: frame(patch), liveAt: Date.now() });
  });
}

const plane = () => useApp.getState().current()!;

beforeEach(() => {
  sent.length = 0;
  const p: PlaneProject = importFromFirmware(manifest, "Тест", "stm32h743-devebox");
  useApp.setState({
    ready: true,
    manifest,
    planes: [p],
    currentId: p.id,
    step: "setup",
    mode: "simple",
    link: { port: "COM13", state: "open", attemptAt: 0 },
    ports: {},
    scan: { sensor: [{ a: 0x68, g: "MPU" }, { a: 0x46, g: "BMP581" }], screen: null },
    scanAt: 1,
    proc: null,
  });
  live();
});

afterEach(() => cleanup());

const open = (title: string) => fireEvent.click(screen.getByText(title));

describe("мастер наладки на фейковой плате", () => {
  it("почему ARM не включится — словами и что сделать", () => {
    render(<SetupStep />);
    live({ block: "газ не на минимуме" });
    expect(screen.getByText("ARM не включится:")).toBeTruthy();
    expect(screen.getByText(/Опустите газ до упора/)).toBeTruthy();
  });

  it("датчик на месте и датчик, что молчит, — с адресами", () => {
    render(<SetupStep />);
    live({ mag: "noresp" });
    open("Датчики на месте");
    expect(screen.getByText("работает, на 0x68")).toBeTruthy();
    expect(screen.getByText(/не отвечает на 0x2C/)).toBeTruthy();
  });

  it("потеря связи: пульт выключили — плата увидела — включили — пройдено", () => {
    render(<SetupStep />);
    open("Потеря связи");
    fireEvent.click(screen.getByText("Выключаю пульт"));
    live({ rx: "fs", ch: [1500, 1500, 900, 1500, 1000, 1000, 1000, 1500, 1500, 1500] });
    expect(screen.getByText(/приёмник прислал газ 900 мкс/)).toBeTruthy();
    live({ rx: "ok" });
    expect(screen.getByText(/Failsafe работает/)).toBeTruthy();
    expect(plane().setup?.failsafe?.note).toContain("900");
  });

  it("пульт: канал крена наоборот — одна кнопка переворачивает его в прошивке", () => {
    render(<SetupStep />);
    open("Пульт");
    fireEvent.click(screen.getByText("Начать проверку"));
    expect(screen.getByText("Правый стик ВПРАВО до упора")).toBeTruthy();
    live({ ch: [1000, 1500, 1000, 1500, 1000, 1000, 1000, 1500, 1500, 1500] });
    expect(screen.getByText(/CH1 работает наоборот/)).toBeTruthy();
    fireEvent.click(screen.getByText("Перевернуть канал в прошивке"));
    expect((effectiveParam(manifest, plane(), "CHANNEL_REVERSED") as boolean[])[0]).toBe(true);
    expect(screen.getByText("Правый стик ОТ СЕБЯ (вверх) до упора")).toBeTruthy();
  });

  it("рули: «нет, наоборот» переворачивает ровно этот руль", () => {
    render(<SetupStep />);
    const before = effectiveParam(manifest, plane(), "AILERON_RIGHT_REVERSED");
    open("Рули");
    fireEvent.click(screen.getByText("Начать"));
    live({ ch: [2000, 1500, 1000, 1500, 1000, 1000, 1000, 1500, 1500, 1500] });
    fireEvent.click(screen.getByText("Да, так")); // левый элерон вниз — так
    fireEvent.click(screen.getByText("Нет, наоборот")); // правый — наоборот
    expect(effectiveParam(manifest, plane(), "AILERON_RIGHT_REVERSED")).toBe(!before);
    expect(effectiveParam(manifest, plane(), "AILERON_LEFT_REVERSED")).toBe(false);
  });

  it("калибровка на земле из приложения — команда «act c» и шаги по кадрам платы", () => {
    render(<SetupStep />);
    open("Калибровка на земле");
    fireEvent.click(screen.getAllByText("Начать")[0]);
    expect(sent).toContain("act c");
    live({ cal: "PARK" });
    expect(screen.getByText("Шаг 2 из 2")).toBeTruthy();
  });
});
