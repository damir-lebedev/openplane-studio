// @vitest-environment jsdom
// Обновление приложения: проверка при запуске → карточка → загрузка →
// «Установить и перезапустить»; выключатель и «Пропустить эту версию» в «Настройках».

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SourceFreshness } from "../../api";
import type { UpdateInfo } from "../../core/update";

const calls: { name: string; args: unknown[] }[] = [];
let release: UpdateInfo | null;
let freshness: SourceFreshness | null | "offline";

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
          if (prop === "firmwareSourceCheck") return freshness === "offline" ? Promise.reject("нет ответа от api.github.com") : Promise.resolve(freshness);
          if (prop === "firmwareFetchGithub") return Promise.resolve({ dir: "C:/app/source/OpenPlaneProject", reference: "main", commit: "b".repeat(40), fresh: true });
          return Promise.resolve(undefined);
        },
    },
  );
  return { ...real, api, onUpdateProgress: () => Promise.resolve(() => undefined) };
});

const { useApp } = await import("../../store");
const { SourceCard, UpdateCard, UpdateSettings } = await import("../Update");

const asset = { name: "OpenPlane-Studio-Windows-Setup.exe", url: "https://github.com/x/w.exe", size: 210 * 1024 * 1024, sha256: "ab" };

beforeEach(() => {
  calls.length = 0;
  release = { version: "0.3.0", current: "0.2.0", newer: true, notes: "- Автообновление\n- Анкета", page: "https://github.com/x", published: "", asset };
  freshness = { reference: "main", local: "a".repeat(40), remote: "b".repeat(40), newer: true, ahead: 12, notes: ["copter: SpeedyBee F405 V4 board", "copter CLI: dump fix"] };
  useApp.setState({
    update: { phase: "idle" },
    sourceUpdate: { phase: "idle" },
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

describe("исходники прошивки при запуске (P60)", () => {
  it("отстали от main: карточка → «Обновить исходники» качает ту же ссылку и сохраняет папку", async () => {
    useApp.setState({ settings: { firmwareSource: "C:/app/source/OpenPlaneProject" } });
    render(<SourceCard />);
    await act(() => useApp.getState().checkSource());
    expect(calls.find((c) => c.name === "firmwareSourceCheck")!.args[0]).toBe("C:/app/source/OpenPlaneProject");
    expect(screen.getByText("Есть свежие исходники прошивки")).toBeTruthy();
    expect(screen.getByText(/новых изменений — 12/)).toBeTruthy();
    fireEvent.click(screen.getByText("Что нового"));
    expect(screen.getByText("copter: SpeedyBee F405 V4 board")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Обновить исходники")));
    expect(calls.find((c) => c.name === "firmwareFetchGithub")!.args[0]).toBe("main");
    expect(useApp.getState().settings.firmwareSource).toBe("C:/app/source/OpenPlaneProject");
    expect(useApp.getState().sourceUpdate.phase).toBe("done");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useApp.getState().toasts.some((x) => /обновлены: main · bbbbbbb/.test(x.text))).toBe(true);
  });

  it("«Пропустить» запоминает коммит: при следующей проверке карточки нет", async () => {
    useApp.setState({ settings: { firmwareSource: "C:/src" } });
    render(<SourceCard />);
    await act(() => useApp.getState().checkSource());
    await act(async () => fireEvent.click(screen.getByText("Пропустить")));
    expect(useApp.getState().settings.sourceSkip).toBe("b".repeat(40));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(() => useApp.getState().checkSource());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("своя git-копия, свежие исходники или нет сети — карточки нет", async () => {
    useApp.setState({ settings: { firmwareSource: "C:/src" } });
    render(<SourceCard />);
    for (const f of [null, { ...(freshness as SourceFreshness), newer: false, ahead: 0, notes: [] } as SourceFreshness, "offline" as const]) {
      freshness = f;
      await act(() => useApp.getState().checkSource());
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("пока видна карточка нового приложения — карточка исходников ждёт", async () => {
    useApp.setState({ settings: { firmwareSource: "C:/src" } });
    render(
      <>
        <UpdateCard />
        <SourceCard />
      </>,
    );
    await act(() => useApp.getState().checkUpdate(false));
    await act(() => useApp.getState().checkSource());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByText("Вышла OpenPlane Studio 0.3.0")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getAllByLabelText("Позже")[0]));
    expect(screen.getByText("Есть свежие исходники прошивки")).toBeTruthy();
  });
});
