// @vitest-environment jsdom
// Подбор дрона в Ангаре (P07): виден, пока в знакомстве «дрона нет»;
// бюджет и «готовый/собрать» меняют список; «Дрон уже есть» прячет карточку.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const api = new Proxy({}, { get: () => () => Promise.resolve(undefined) });
  return { ...real, api, inTauri: () => false };
});

const { useApp } = await import("../../store");
const { DronePicker } = await import("../DronePicker");
const { makeProfile } = await import("../../core/pilot");

const pilot = (hasDrone: boolean | null) => makeProfile({ experience: "sim", craft: "quad", classes: [], goals: ["longrange"], hasDrone });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("подбор дрона (P07)", () => {
  beforeEach(() => useApp.setState({ settings: { pilot: pilot(false) }, manifest: null }));
  afterEach(cleanup);

  it("есть дрон или не отвечал — карточки нет", () => {
    useApp.setState({ settings: { pilot: pilot(true) } });
    const { container } = render(<DronePicker />);
    expect(container.textContent).toBe("");
    cleanup();
    useApp.setState({ settings: { pilot: pilot(null) } });
    expect(render(<DronePicker />).container.textContent).toBe("");
  });

  it("новичок на дальние: 7\", сначала вуп, симуляторы; сборка — детали и оценка", () => {
    render(<DronePicker />);
    expect(screen.getByText(/7" лонг-рейндж/)).toBeTruthy();
    expect(screen.getByText(/сначала симулятор и вуп/)).toBeTruthy();
    expect(screen.getByText("Liftoff")).toBeTruthy();
    expect(screen.queryByText("Детали")).toBeNull();
    click("Собрать");
    expect(screen.getByText("Детали")).toBeTruthy();
    expect(screen.getByText("2806.5 1300KV")).toBeTruthy();
    expect(screen.getByText("Тяговооружённость")).toBeTruthy();
  });

  it("«немного» на 7\" — уже 5\" и без цифры; «не жалко» — цифровые очки", () => {
    render(<DronePicker />);
    click("Немного");
    expect(screen.getByText(/5" фристайл/)).toBeTruthy();
    expect(screen.getByText("Аналоговые очки-коробка")).toBeTruthy();
    click("Не жалко");
    expect(screen.getByText(/Цифровые очки/)).toBeTruthy();
  });

  it("«Дрон уже есть» сохраняет ответ", async () => {
    render(<DronePicker />);
    click(/Дрон уже есть/);
    await vi.waitFor(() => expect(useApp.getState().settings.pilot?.hasDrone).toBe(true));
  });
});
