// @vitest-environment jsdom
// Вкладки коптера на фейковой плате: дамп настроек и живые кадры подаются в
// состояние, как их прислала бы прошивка; вызовы Rust подменены — видно,
// какие команды ушли на плату.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CopterLive } from "../../api";
import { blankCopter } from "../../core/copter";
import { makeProfile } from "../../core/pilot";
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
    settings: { copterMode: "pro" },
  });
}

/** Ползунки прошивки (simplified_*) и то, что двигают ползунки «Настройки полёта». */
function sliderParams() {
  const pct = (name: string, group = "pid", scope: "pid" | "master" = "pid") => param(name, { group, scope, min: 0, max: 200, default: 100, value: 100, from: "table" });
  const onOff = (name: string, scope: "pid" | "master") => param(name, { type: "enum", group: "filters", scope, options: ["OFF", "ON"], default: "ON", value: "ON", from: "table" });
  const rate = (name: string, v: number) => param(name, { group: "rates", scope: "rate", default: v, value: v });
  return [
    param("simplified_pids_mode", { type: "enum", options: ["OFF", "RP", "RPY"], default: "RPY", value: "RPY", from: "table" }),
    ...["master_multiplier", "pi_gain", "i_gain", "d_gain", "dmax_gain", "feedforward_gain", "pitch_pi_gain", "pitch_d_gain"].map((n) => pct(`simplified_${n}`)),
    onOff("simplified_gyro_filter", "master"),
    pct("simplified_gyro_filter_multiplier", "filters", "master"),
    onOff("simplified_dterm_filter", "pid"),
    pct("simplified_dterm_filter_multiplier", "filters"),
    ...["roll", "pitch", "yaw"].flatMap((a) => [rate(`${a}_rc_rate`, 18), rate(`${a}_srate`, a === "yaw" ? 60 : 72), rate(`${a}_expo`, 50)]),
    param("angle_limit", { default: 55, value: 55, min: 10, max: 90 }),
  ];
}

function withSliders(margin = { gm: 11.6, pm: 49, hz: 21.3, min: 6 }) {
  act(() =>
    useApp.setState((st) => {
      const b = dumpedBoard([...st.copterBoard.order.map((n) => st.copterBoard.params[n]).filter((p) => !p.name.includes("rate") && !p.name.includes("expo")), ...sliderParams()]);
      return { copterBoard: { ...b, header: { ...b.header!, margin } } };
    }),
  );
}

const tab = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("профиль пилота: новичок, наборы, «Показать всё»", () => {
  beforeEach(() => {
    sent.length = 0;
    connect();
    useApp.setState({ settings: {} });   // анкеты не было — «Основа» с мастером
  });
  afterEach(cleanup);

  it("новичок не видит профи-вкладок; «Показать всё» открывает все", () => {
    render(<CopterView />);
    expect(screen.getByRole("button", { name: "По шагам" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Настройка полёта" })).toBeTruthy();
    for (const pro of ["PID", "Расходы", "Фильтры", "CLI", "Приёмник"]) expect(screen.queryByRole("button", { name: pro })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Показать всё" }));
    expect(useApp.getState().settings.pilot?.showAll).toBe(true);
    expect(screen.getByRole("button", { name: "PID" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Настройка полёта" })).toBeTruthy();
  });

  it("прежний «Профи» без анкеты — видно всё", () => {
    useApp.setState({ settings: { copterMode: "pro" } });
    render(<CopterView />);
    for (const tab of ["PID", "CLI", "Прочее", "По шагам"]) expect(screen.getByRole("button", { name: tab })).toBeTruthy();
  });

  it("летающий фристайлер: «Основа» и фристайл, без мастера, CLI и GPS", () => {
    const pilot = makeProfile({ experience: "flying", craft: "quad", classes: ["quad5"], goals: ["freestyle"], hasDrone: true });
    useApp.setState({ settings: { pilot } });
    render(<CopterView />);
    for (const tab of ["Приёмник", "Моторы", "PID", "Фильтры", "OSD"]) expect(screen.getByRole("button", { name: tab })).toBeTruthy();
    for (const tab of ["По шагам", "CLI", "GPS"]) expect(screen.queryByRole("button", { name: tab })).toBeNull();
  });

  it("«Настройка полёта»: ползунок словами — команды настроек, ни одного имени настройки", () => {
    withSliders();
    const { container } = render(<CopterView />);
    tab("Настройка полёта");
    expect(container.textContent).not.toMatch(/simplified_|_srate|angle_limit|p_roll/);
    expect(screen.getByText("11.6 дБ")).toBeTruthy();
    expect(screen.getByText(/с запасом/)).toBeTruthy();
    const response = screen.getByRole("slider", { name: "Отзывчивость" });
    fireEvent.change(response, { target: { value: "120" } });
    expect(sent).toEqual([]);   // пока тянут — ничего не уходит
    fireEvent.pointerUp(response);
    expect(sent).toEqual(["set simplified_master_multiplier 120"]);
    const speed = screen.getByRole("slider", { name: "Скорость вращения" });
    fireEvent.change(speed, { target: { value: "900" } });
    fireEvent.pointerUp(speed);
    expect(sent.slice(1)).toEqual(["set roll_srate 90", "set pitch_srate 90", "set yaw_srate 75"]);   // рысканье — в той же доле
  });

  it("запас мал — красная полоса и совет сдвинуть назад", () => {
    withSliders({ gm: 4.2, pm: 31, hz: 30, min: 6 });
    const { container } = render(<CopterView />);
    tab("Настройка полёта");
    expect(container.querySelector(".margin-bar.bad")).toBeTruthy();
    expect(screen.getByText(/сдвиньте ползунки назад/)).toBeTruthy();
  });

  it("мастер доходит до «можно лететь» на фейковой плате", () => {
    useApp.setState({ clive: live({ block: [] }) });
    render(<CopterView />);
    // первый шаг — плата (карточки из манифеста; в тесте его нет)
    expect(screen.getByRole("heading", { name: "Плата" })).toBeTruthy();
    const next = () => fireEvent.click(screen.getByRole("button", { name: "Дальше" }));
    const confirm = (text: RegExp) => fireEvent.click(screen.getByLabelText(text));
    next();
    expect(screen.getByRole("heading", { name: "Рама и винты" })).toBeTruthy();
    next();
    confirm(/Стики двигают нужные полосы/);
    next();
    confirm(/Каждый мотор на своём месте/);
    next();
    confirm(/выключил пульт — моторы встали/);
    next();
    confirm(/как у моей батареи/);
    next();
    confirm(/Картинка в очках есть/);
    next();
    expect(screen.getByText("Всё готово — можно лететь!")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Дальше" })).toBeNull();
    expect(useApp.getState().copters[0].wizardDone).toHaveLength(5);
  });

  it("мастер: пока не всё — «осталось» и переход к шагу", () => {
    render(<CopterView />);   // плата не откалибрована, шаги не отмечены
    fireEvent.click(screen.getByRole("button", { name: /Можно лететь/ }));
    expect(screen.getByRole("heading", { name: /Осталось \d+/ })).toBeTruthy();
    expect(screen.getByText("Установка платы откалибрована")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "К шагу" })[0]);
    expect(screen.getByRole("heading", { name: "Рама и винты" })).toBeTruthy();
  });
});

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

  it("поиск по имени BF открывает вкладку и подсвечивает строку", async () => {
    render(<CopterView />);
    const box = screen.getByRole("textbox", { name: "Поиск настроек" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "motor_poles" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Моторы" }).className).toContain(" on");
    await waitFor(() => expect(document.querySelector(".found")?.getAttribute("data-param")).toBe("motor_poles"));
  });

  it("новичок ищет p_roll — включается набор «Фристайл», открывается PID", async () => {
    useApp.setState({ settings: {} });
    render(<CopterView />);
    const box = screen.getByRole("textbox", { name: "Поиск настроек" });
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "p_roll" } });
    fireEvent.click(screen.getAllByRole("option")[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "PID" }).className).toContain(" on"));
    expect(useApp.getState().settings.pilot?.packs).toContain("freestyle");
    expect(screen.getByRole("button", { name: "По шагам" })).toBeTruthy();   // мастер новичка остаётся
  });

  it("«Я с Betaflight»: вкладка BF ведёт на нашу", () => {
    render(<CopterView />);
    tab("Я с Betaflight");
    expect(screen.getByText("Video Transmitter")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Приёмник" })[1]);
    expect(screen.getByRole("button", { name: "Приёмник" }).className).toContain(" on");
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

  it("моторы: направление у DShot — мотор кликом по схеме, команды dshot", () => {
    render(<CopterView />);
    tab("Моторы");
    expect(screen.queryByText("Направление моторов")).toBeNull();   // не DShot — карточки нет
    cleanup();
    act(() => useApp.setState((s) => ({ copterBoard: { ...s.copterBoard, header: { ...s.copterBoard.header!, dshotCommands: true } } })));
    const { container } = render(<CopterView />);
    tab("Моторы");
    expect(screen.getByText("Направление моторов")).toBeTruthy();
    fireEvent.click(container.querySelectorAll(".frame-pick")[1]);   // M2 — передний правый
    expect(screen.getByText(/передний правый/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Обратное" }));
    fireEvent.click(screen.getByRole("button", { name: "Пискнуть" }));
    fireEvent.click(screen.getByRole("button", { name: "Пискнуть всеми" }));
    expect(sent.filter((c) => c.startsWith("dshot"))).toEqual(["dshot 1 8 12", "dshot 1 1", "dshot all 1"]);
  });

  it("режимы: turtle mode — схема моторов от стиков пульта", () => {
    act(() =>
      useApp.setState((s) => ({
        copterBoard: { ...s.copterBoard, header: { ...s.copterBoard.header!, dshotCommands: true }, modes: [...s.copterBoard.modes, [35, "FLIP OVER AFTER CRASH", true]] },
        clive: live({ ch: [2000, 1500, 1000, 1500, 1900, 1000, 1000, 1000, 1500, 1500, 1500, 1500] }),   // крен вправо до упора
      })),
    );
    const { container } = render(<CopterView />);
    tab("Режимы");
    expect(screen.getByText("FLIP OVER AFTER CRASH")).toBeTruthy();
    const props = [...container.querySelectorAll(".turtle .frame-dir")].map((e) => e.textContent);
    expect(props).toEqual(["наоборот", "наоборот", "стоит", "стоит"]);   // правые
    expect(screen.getByText(/закрутились бы моторы/)).toBeTruthy();
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

  it("PID и фильтры: ползунки Betaflight с запасом устойчивости", () => {
    withSliders();
    render(<CopterView />);
    tab("PID");
    expect(screen.getByText("Ползунки PID")).toBeTruthy();
    expect(screen.getByText("simplified_d_gain")).toBeTruthy();   // имя BF — мелко
    const d = screen.getByRole("slider", { name: "Демпфирование: D" });
    fireEvent.change(d, { target: { value: "130" } });
    fireEvent.keyUp(d);
    expect(sent).toContain("set simplified_d_gain 130");
    tab("Фильтры");
    expect(screen.getByRole("slider", { name: "Фильтр гироскопа" })).toBeTruthy();
    expect(screen.getByText("11.6 дБ")).toBeTruthy();
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

describe("память настроек", () => {
  it("«Прочее»: занято N из M и цвет по заполнению", async () => {
    const { FlashCard } = await import("../copter/MiscTabs");
    const { container } = render(<FlashCard flash={[7800, 8192]} />);
    expect(screen.getByText("7.6 из 8.0 КБ")).toBeTruthy();
    expect(container.querySelector(".margin-bar.bad")).toBeTruthy();
  });
});

describe("что подключено (P03) и перегрузка по току (P04)", () => {
  const build = () => {
    const m = (name: string, value: number | string, patch: Partial<Parameters<typeof param>[1]> = {}) =>
      param(name, { group: "copter", scope: "master", from: "build", min: 0, max: 100000, default: value, value, ...patch });
    return [
      m("copter_mass_g", 680),
      m("copter_wheelbase_mm", 225),
      m("prop_diameter_in", 5.1, { type: "float" }),
      m("prop_pitch_in", 4.3, { type: "float" }),
      m("prop_blades", 3),
      m("motor_stator_mm", 22, { type: "float" }),
      m("motor_height_mm", 7, { type: "float" }),
      m("motor_kv", 1950),
      m("battery_cells", 6),
      m("battery_mah", 1300),
      m("battery_chemistry", "LIPO", { type: "enum", options: ["LIPO", "LIHV", "LIION"] }),
      m("battery_c_rating", 0, { from: "table" }),
      m("esc_current_a", 0, { from: "table" }),
      m("esc_burst_current_a", 0, { from: "table" }),
    ];
  };

  beforeEach(() => {
    sent.length = 0;
    connect();
    useApp.setState({ copterBoard: dumpedBoard(build()) });
  });
  afterEach(cleanup);

  it("выбор из каталога уходит на плату, итог считает тягу и висение; регулятор 20 А — «сгорит»", async () => {
    render(<CopterView />);
    tab("Что подключено");
    expect(screen.getByText("Что из этого выходит")).toBeTruthy();
    expect(screen.getByText("Тяговооружённость")).toBeTruthy();
    expect(screen.getByText("Ток регулятора не задан — прошивка не следит за его перегрузкой.")).toBeTruthy();

    // мотор 2810 1300KV из каталога
    const cards = document.querySelectorAll(".parts-card");
    fireEvent.click(cards[0].querySelector("button")!);
    fireEvent.change(screen.getByPlaceholderText("Поиск: 2207, 7\", li-ion…"), { target: { value: "2810" } });
    await act(async () => fireEvent.click(screen.getByText("2810 1300KV")));
    expect(sent).toEqual(expect.arrayContaining(["set motor_stator_mm 28", "set motor_height_mm 10", "set motor_kv 1300"]));
    expect(useApp.getState().currentCopter()!.parts.motors).toBe("2810 1300KV");

    // регулятор 20 А на 5" 2207 — мало
    sent.length = 0;
    act(() =>
      useApp.setState(() => ({
        copterBoard: dumpedBoard(build().map((p) => (p.name === "esc_current_a" ? { ...p, value: 20 } : p.name === "esc_burst_current_a" ? { ...p, value: 25 } : p))),
      })),
    );
    expect(screen.getByText(/мотор тянет больше пикового тока регулятора — сгорит/)).toBeTruthy();
  });

  it("батарея из каталога: химия в написании платы, C — в battery_c_rating", async () => {
    render(<CopterView />);
    tab("Что подключено");
    const cards = document.querySelectorAll(".parts-card");
    fireEvent.click(cards[2].querySelector("button")!);
    await act(async () => fireEvent.click(screen.getByText("6S1P 21700 Li-ion 4000 мА·ч")));
    expect(sent).toEqual(expect.arrayContaining(["set battery_chemistry LIION", "set battery_c_rating 10", "set battery_mah 4000"]));
  });

  it("«Питание»: перегрузка сейчас и наибольший ток на мотор за полёт", () => {
    useApp.setState({ clive: live({ amps: 160, mah: 300, ovl: "ESC", mma: 52.4 }), cliveAt: Date.now() });
    render(<CopterView />);
    tab("Питание");
    expect(screen.getByText(/ESC OVERLOAD ·/)).toBeTruthy();
    expect(screen.getByText(/до 52.4 А на мотор за полёт/)).toBeTruthy();
  });
});
