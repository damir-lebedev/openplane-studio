// @vitest-environment jsdom
// Анкета первого запуска: пилот отвечает карточками, в конце — его наборы;
// профиль уходит в настройки приложения. Вызовы Rust подменены.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const api = new Proxy({}, { get: () => () => Promise.resolve(undefined) });
  return { ...real, api, inTauri: () => false };
});

const { useApp } = await import("../../store");
const { Onboarding } = await import("../onboarding/Onboarding");

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const cards = () => [...screen.queryAllByRole("radio"), ...screen.queryAllByRole("checkbox")];
const pick = (name: RegExp) => fireEvent.click(cards().find((el) => name.test(el.textContent ?? ""))!);
const checked = (name: RegExp) => cards().find((el) => name.test(el.textContent ?? ""))?.getAttribute("aria-checked");

describe("анкета первого запуска", () => {
  beforeEach(() => useApp.setState({ settings: {}, onboarding: false, section: "board" }));
  afterEach(cleanup);

  it("без ответа дальше не пускает", () => {
    render(<Onboarding />);
    expect(screen.getByText("Привет! Ты начинающий пилот?")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Дальше/ }) as HTMLButtonElement).disabled).toBe(true);
    pick(/^Летаю в симуляторе/);
    expect((screen.getByRole("button", { name: /Дальше/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("симулятор → 7\" → съёмка → дрон есть: набор «Съёмка и дальние», профиль сохранён, дальше ангар", async () => {
    render(<Onboarding />);
    pick(/^Летаю в симуляторе/);
    click(/Дальше/);
    pick(/^Квадрокоптеры/);
    pick(/^7" и больше/);
    click(/Дальше/);
    pick(/^Съёмка и дальние полёты/);
    click(/Дальше/);
    pick(/^Есть/);
    click(/Дальше/);
    expect(screen.getByText("Твой набор")).toBeTruthy();
    const on = [...document.querySelectorAll(".onb-pack.on .onb-pack-title")].map((el) => el.textContent);
    expect(on).toEqual(["Основа", "Съёмка и дальние"]);
    click(/Поехали/);
    await vi.waitFor(() => expect(useApp.getState().settings.pilot?.packs).toEqual(["base", "longrange"]));
    expect(useApp.getState().settings.pilot).toMatchObject({ experience: "sim", craft: "quad", classes: ["quad7"], hasDrone: true });
    await vi.waitFor(() => expect(useApp.getState().section).toBe("hangar"));
  });

  it("«Назад» хранит ответы; смена «на чём» убирает чужие классы", () => {
    render(<Onboarding />);
    pick(/^Профи/);
    click(/Дальше/);
    pick(/^И то и то/);
    pick(/^Вуп/);
    pick(/^VTOL/);
    pick(/^Крылья и самолёты/);
    expect(checked(/^Вуп/)).toBeUndefined();
    expect(checked(/^VTOL/)).toBe("true");
    click(/Назад/);
    expect(checked(/^Профи/)).toBe("true");
  });

  it("пропустить: прежний «Профи» остаётся — видно всё", async () => {
    useApp.setState({ settings: { copterMode: "pro" } });
    render(<Onboarding />);
    click("Пропустить");
    await vi.waitFor(() => expect(useApp.getState().settings.pilot?.skipped).toBe(true));
    expect(useApp.getState().settings.pilot?.showAll).toBe(true);
  });

  it("открыта заново из «Настроек» — с прежними ответами", () => {
    useApp.setState({
      settings: { pilot: { experience: "instructor", craft: "wing", classes: [], goals: ["school"], hasDrone: true, packs: ["base", "wing", "school"], at: "" } },
      onboarding: true,
    });
    render(<Onboarding />);
    expect(checked(/^Инструктор/)).toBe("true");
  });
});
