// @vitest-environment jsdom
// Обновление приложения: проверка при запуске → карточка → загрузка →
// «Установить и перезапустить»; выключатель и «Пропустить эту версию» в «Настройках».

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateInfo } from "../../core/update";

const calls: { name: string; args: unknown[] }[] = [];
let release: UpdateInfo | null;

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const api = new Proxy(
    {},
    {
      get: (_, prop: string) =>
        (...args: unknown[]) => {
          calls.push({ name: prop, args });
          if (prop === "updateCheck") return release ? Promise.resolve(release) : Promise.reject("нет ответа от api.github.com");
          if (prop === "updateDownload") return Promise.resolve("C:/cache/updates/OpenPlane-Studio-Windows-Setup.exe");
          if (prop === "updateInstall") return Promise.resolve(true);
          return Promise.resolve(undefined);
        },
    },
  );
  return { ...real, api, onUpdateProgress: () => Promise.resolve(() => undefined) };
});

const { useApp } = await import("../../store");
const { UpdateCard, UpdateSettings } = await import("../Update");

const asset = { name: "OpenPlane-Studio-Windows-Setup.exe", url: "https://github.com/x/w.exe", size: 210 * 1024 * 1024, sha256: "ab" };

beforeEach(() => {
  calls.length = 0;
  release = { version: "0.3.0", current: "0.2.0", newer: true, notes: "- Автообновление\n- Анкета", page: "https://github.com/x", published: "", asset };
  useApp.setState({
    update: { phase: "idle" },
    settings: {},
    flash: null,
    toasts: [],
    info: { version: "0.2.0", platform: "windows", hangar_dir: "", cache_dir: "", pio: null, python: null, firmware_guess: null },
  });
});
afterEach(cleanup);

const names = () => calls.map((c) => c.name);

describe("обновление приложения", () => {
  it("новая версия: карточка → скачать → установить и перезапустить", async () => {
    render(<UpdateCard />);
    await act(() => useApp.getState().checkUpdate(false));
    expect(screen.getByText("Вышла OpenPlane Studio 0.3.0")).toBeTruthy();
    expect(screen.getByText(/установщик 210 МБ/)).toBeTruthy();
    fireEvent.click(screen.getByText("Что нового"));
    expect(screen.getByText("Автообновление")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Скачать обновление")));
    expect(calls.find((c) => c.name === "updateDownload")!.args[0]).toEqual(asset);
    await act(async () => fireEvent.click(screen.getByText("Установить и перезапустить")));
    expect(calls.find((c) => c.name === "updateInstall")!.args[0]).toBe("C:/cache/updates/OpenPlane-Studio-Windows-Setup.exe");
  });

  it("во время прошивки не ставит", async () => {
    render(<UpdateCard />);
    await act(() => useApp.getState().checkUpdate(false));
    await act(async () => fireEvent.click(screen.getByText("Скачать обновление")));
    useApp.setState({ flash: { planeId: "p", running: true, steps: [], progress: null, activity: "", log: [] } });
    await act(async () => fireEvent.click(screen.getByText("Установить и перезапустить")));
    expect(names()).not.toContain("updateInstall");
    expect(useApp.getState().toasts.at(-1)?.text).toMatch(/дождитесь конца прошивки/);
  });

  it("пропущенная версия при запуске молчит, по кнопке — снова предлагается", async () => {
    render(<UpdateCard />);
    await act(() => useApp.getState().checkUpdate(false));
    await act(async () => fireEvent.click(screen.getByText("Пропустить эту версию")));
    expect(useApp.getState().settings.updateSkip).toBe("0.3.0");
    expect(screen.queryByText("Вышла OpenPlane Studio 0.3.0")).toBeNull();
    await act(() => useApp.getState().checkUpdate(false));
    expect(screen.queryByText("Вышла OpenPlane Studio 0.3.0")).toBeNull();
    await act(() => useApp.getState().checkUpdate(true));
    expect(screen.getByText("Вышла OpenPlane Studio 0.3.0")).toBeTruthy();
  });

  it("«Больше не спрашивать» — карточка уходит, проверка при запуске выключается", async () => {
    render(
      <>
        <UpdateSettings />
        <UpdateCard />
      </>,
    );
    await act(() => useApp.getState().checkUpdate(false));
    await act(async () => fireEvent.click(screen.getByText("Больше не спрашивать")));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useApp.getState().settings.updateCheck).toBe(false);
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("последняя версия — так и пишет, старые установщики убираются", async () => {
    release = { ...release!, version: "0.2.0", newer: false };
    render(
      <>
        <UpdateSettings />
        <UpdateCard />
      </>,
    );
    await act(async () => fireEvent.click(screen.getByText("Проверить сейчас")));
    expect(screen.getByText(/У вас последняя версия — 0.2.0/)).toBeTruthy();
    expect(names()).toContain("updateCleanup");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("выключатель проверки при запуске сохраняется в настройках", async () => {
    render(<UpdateSettings />);
    const box = screen.getByRole("checkbox") as HTMLInputElement;
    expect(box.checked).toBe(true);
    await act(async () => fireEvent.click(box));
    expect(useApp.getState().settings.updateCheck).toBe(false);
    expect(calls.find((c) => c.name === "settingsSave")!.args[0]).toMatchObject({ updateCheck: false });
  });

  it("без сети при запуске — ни карточки, ни ошибки; по кнопке — ошибка видна", async () => {
    release = null;
    render(
      <>
        <UpdateSettings />
        <UpdateCard />
      </>,
    );
    await act(() => useApp.getState().checkUpdate(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/нет ответа/)).toBeNull();
    await act(async () => fireEvent.click(screen.getByText("Проверить сейчас")));
    expect(screen.getByText(/нет ответа от api.github.com/)).toBeTruthy();
  });
});
