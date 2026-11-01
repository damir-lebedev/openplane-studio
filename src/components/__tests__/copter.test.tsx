// @vitest-environment jsdom
// Вкладки коптера на фейковой плате: дамп настроек и живые кадры подаются в
// состояние, как их прислала бы прошивка; вызовы Rust подменены — видно,
// какие команды ушли на плату.

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CopterLive } from "../../api";
import { blankCopter } from "../../core/copter";
import { dumpedBoard, param } from "../../core/__fixtures__/copterBoard";

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
const { CopterView } = await import("../CopterView");

function live(patch: Partial<CopterLive> = {}): CopterLive {
  return {
    t: 1,
    arm: false,
    state: "DISARMED",
    mode: "ANGLE",
    rx: "ok",
    ch: [1500, 1500, 1000, 1500, 1900, 1000, 1000, 1000, 1500, 1500, 1500, 1500],
    att: [2, -1, 90],
    alt: 0,
    vz: 0,
    thr: 0,
    v: 24.8,
    cell: 4.13,
    bat: "OK",
    hdg: 90,
    motors: [0, 0, 0, 0],
    block: ["THROTTLE", "NO_ACC_CAL"],
    modes: [0],
    cpu: 30,
    hz: 2000,
    unsaved: false,
    ...patch,
  };
}

function connect() {
  const copter = blankCopter(null, "Квадрик 7\"");
  const board = dumpedBoard([
    param("p_roll"),
    param("i_roll", { default: 80, value: 80 }),
    param("roll_rc_rate", { group: "rates", scope: "rate", default: 20, value: 20 }),
    param("roll_srate", { group: "rates", scope: "rate", default: 67, value: 67 }),
    param("roll_expo", { group: "rates", scope: "rate", default: 50, value: 50 }),
    param("motor_poles", { group: "motors", scope: "master", default: 14, value: 14, from: "table", text: "полюсов у мотора" }),
    param("serialrx_provider", { type: "enum", group: "receiver", scope: "master", options: ["IBUS", "SBUS", "CRSF"], value: "CRSF", default: "CRSF" }),
  ]);
  useApp.setState({
    copters: [copter],
    copterId: copter.id,
    link: { port: "COM7", state: "open", attemptAt: 0 },
    ports: { COM7: { identity: { fw: "openplane", proto: 3, board: "getfun-f405v3-quad", commit: "abc", config: "", plane: "", armed: false, vehicle: "copter" }, at: 0 } },
    copterBoard: board,
    clive: live(),
    cliveAt: Date.now(),
  });
}

const tab = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("вкладки коптера", () => {
  beforeEach(() => {
    sent.length = 0;
    connect();
  });
  afterEach(cleanup);

  it("PID: правка уходит на плату командой set, ответ — «не сохранено»", async () => {
    render(<CopterView />);
    tab("PID");
    const inputs = screen.getAllByDisplayValue("40");
    fireEvent.change(inputs[0], { target: { value: "47" } });
    fireEvent.blur(inputs[0]);
    expect(sent).toContain("set p_roll 47");
    act(() => useApp.getState().copterBoard && useApp.setState((s) => ({ copterBoard: { ...s.copterBoard, unsaved: true, pending: {} } })));
    expect(screen.getByText(/не сохранены/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(sent).toContain("save");
  });

  it("за границы — не отправляется", () => {
    render(<CopterView />);
    tab("PID");
    const input = screen.getAllByDisplayValue("40")[0];
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(sent.filter((s) => s.startsWith("set"))).toEqual([]);
  });

  it("моторы: без «пропеллеры сняты» ползунки закрыты; с ним — команда motor", () => {
    vi.useFakeTimers();
    render(<CopterView />);
    tab("Моторы");
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(5);   // 4 мотора и «все»
    expect((sliders[0] as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getAllByRole("slider")[1], { target: { value: "8" } });
    act(() => vi.advanceTimersByTime(900));
    expect(sent).toContain("motor 1 8");
    expect(sent).toContain("motor 0 0");
    fireEvent.click(screen.getByRole("button", { name: "Стоп" }));
    expect(sent).toContain("motor stop");
    vi.useRealTimers();
  });

  it("подготовка: причины запрета ARM словами", () => {
    render(<CopterView />);
    tab("Подготовка");
    expect(screen.getByText(/не откалибрована установка платы/)).toBeTruthy();
    expect(screen.getByText(/газ не внизу/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Начать" })[0]);
    expect(sent).toContain("i");
  });

  it("режимы: первая правка переносит тумблеры прошивки в таблицу", async () => {
    render(<CopterView />);
    tab("Режимы");
    expect(screen.getByText(/тумблеры прошивки/)).toBeTruthy();
    const add = screen.getAllByRole("button", { name: "Диапазон" });
    await act(async () => {
      fireEvent.click(add[add.length - 1]);
    });
    expect(sent.slice(0, 2)).toEqual(["aux 0 0 0 1700 2100 0 0", "aux 1 1 1 900 1300 0 0"]);
    expect(sent[2]).toMatch(/^aux 2 \d+ 0 1700 2100 0 0$/);
  });

  it("приёмник: каналы по порядку AETR и смена порядка", () => {
    render(<CopterView />);
    tab("Приёмник");
    expect(screen.getByText("Газ (T)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "TAER" }));
    expect(sent).toContain("map TAER1234");
  });

  it("без платы вкладки просят подключить коптер", () => {
    useApp.setState({ link: { port: null, state: "idle", attemptAt: 0 } });
    render(<CopterView />);
    tab("Расходы");
    expect(screen.getByText("Коптер не подключён")).toBeTruthy();
  });

  it("расходы: кривая и максимум по оси", () => {
    render(<CopterView />);
    tab("Расходы");
    expect(screen.getByText(/до 670 °\/с/)).toBeTruthy();
  });

  it("OSD: галочка показывает элемент, перетаскивание ставит позицию BF", () => {
    act(() =>
      useApp.setState((st) => ({
        copterBoard: dumpedBoard([
          ...st.copterBoard.order.map((n) => st.copterBoard.params[n]),
          param("osd_vbat_pos", { group: "osd", scope: "master", default: 2433, value: 2433, min: 0, max: 16383 }),
          param("osd_throttle_pos", { group: "osd", scope: "master", default: 65, value: 65, min: 0, max: 16383 }),
          param("osd_stat_max_alt", { type: "enum", group: "osd", scope: "master", options: ["OFF", "ON"], default: "ON", value: "ON" }),
        ]),
      })),
    );
    render(<CopterView />);
    tab("OSD");
    expect(screen.getByText("Статистика после посадки")).toBeTruthy();
    // газ спрятан (65 = x1 y2 без 0x0800) — включили
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(sent).toContain("set osd_throttle_pos 2113");
    // батарея: x1 y12 → тащим на x10 y1 (экран 300×160: клетка 10×10)
    const scr = document.querySelector(".osd-screen") as HTMLElement;
    scr.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 160, right: 300, bottom: 160, x: 0, y: 0, toJSON: () => ({}) });
    const vbat = screen.getByTitle("Напряжение батареи");
    fireEvent.pointerDown(vbat, { clientX: 15, clientY: 125, pointerId: 1 });
    fireEvent.pointerMove(scr, { clientX: 105, clientY: 15, pointerId: 1 });
    fireEvent.pointerUp(scr, { clientX: 105, clientY: 15, pointerId: 1 });
    expect(sent).toContain("set osd_vbat_pos 2090");
  });

  it("GPS: этап возврата из @live, схема по живому расстоянию, подсказка выбрать GPS-RESCUE", () => {
    useApp.setState({ clive: live({ alt: 25, gps: { fix: true, sats: 14, lat: 0, lon: 0, spd: 7, home: 240, dir: 15 }, rescue: "FLY_HOME" }) });
    render(<CopterView />);
    tab("GPS");
    expect(screen.getByText("летит домой")).toBeTruthy();
    expect(screen.getByText(/240 м до дома/)).toBeTruthy();
    expect(screen.getByText(/failsafe_procedure = AUTO-LAND/)).toBeTruthy();
    expect(document.querySelector(".rescue-path")?.getAttribute("d")).toMatch(/^M40\.0,/);
  });
});
