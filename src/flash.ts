// Кнопка «Прошить»: сборка → плата в загрузчик → заливка → проверка паспорта.
// Каждая ошибка — одна фраза «что случилось» и действие «что сделать».

import { api, Device, errorText, Identity, onTaskLog } from "./api";
import { findBoard, Manifest } from "./core/manifest";
import { configHash, FlashRecord, PlaneProject, toFirmwareConfig } from "./core/project";
import { FlashAction, FlashState, FlashStep, useApp } from "./store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FlashError extends Error {
  constructor(
    public title: string,
    text: string,
    public action?: FlashAction,
    public holders?: { pid: number; name: string }[],
  ) {
    super(text);
  }
}

function initialSteps(dfu: boolean): FlashStep[] {
  return [
    { id: "build", title: "Сборка прошивки", status: "wait" },
    { id: "board", title: dfu ? "Плата в режим прошивки" : "Поиск платы", status: "wait" },
    { id: "upload", title: "Заливка", status: "wait" },
    { id: "verify", title: "Проверка: на плате то, что в проекте", status: "wait" },
  ];
}

const flash = () => useApp.getState();

function setStep(id: string, status: FlashStep["status"], detail?: string) {
  flash().setFlash((f) => ({
    ...f,
    steps: f.steps.map((s) => (s.id === id ? { ...s, status, detail: detail ?? s.detail } : s)),
  }));
}

function activity(text: string, progress: number | null = null) {
  flash().setFlash((f) => ({ ...f, activity: text, progress }));
}

function appendLog(line: string) {
  flash().setFlash((f) => {
    const log = f.log.length > 4000 ? f.log.slice(-3000) : f.log.slice();
    log.push(line);
    return { ...f, log };
  });
}

/** Понятная причина по хвосту вывода PlatformIO / dfu-util / esptool. */
export function explainFailure(tail: string, task: "build" | "upload"): { title: string; text: string; action?: FlashAction } {
  const t = tail.toLowerCase();
  if (task === "build") {
    const err = tail.split("\n").find((l) => /\berror:/.test(l) && /\.(h|cpp|c)\b/.test(l));
    if (err) return { title: "Прошивка не собралась", text: err.trim().slice(0, 400) };
    if (t.includes("unknownpackageerror") || t.includes("could not install") || t.includes("httpclienterror")) {
      return { title: "PlatformIO не скачал инструменты", text: "Проверьте интернет: первая сборка качает компилятор и библиотеки." };
    }
    return { title: "Прошивка не собралась", text: "Подробности — в журнале ниже." };
  }
  if (t.includes("no dfu capable usb device")) {
    return {
      title: "Плата не в режиме прошивки",
      text: "dfu-util не нашёл STM32 в загрузчике. Включите режим прошивки и повторите.",
      action: "bootloader",
    };
  }
  if (t.includes("libusb_error_not_supported") || t.includes("cannot open dfu device") || t.includes("libusb_error_access")) {
    return {
      title: "Нет драйвера для режима прошивки",
      text: "Windows видит «STM32 BOOTLOADER», но без драйвера WinUSB dfu-util его не открывает.",
      action: "driver",
    };
  }
  if (t.includes("could not open port") || t.includes("access is denied") || t.includes("permissionerror")) {
    return { title: "Порт занят", text: "COM-порт держит другая программа — чаще всего монитор порта.", action: "kill-monitor" };
  }
  if (t.includes("failed to connect to esp32") || t.includes("wrong boot mode")) {
    return {
      title: "ESP32 не вошла в режим прошивки",
      text: "Зажмите кнопку BOOT на плате, нажмите и отпустите RESET (EN), отпустите BOOT и повторите.",
      action: "retry",
    };
  }
  return { title: "Заливка не удалась", text: "Подробности — в журнале ниже.", action: "retry" };
}

async function waitDevice(match: (d: Device) => boolean, timeoutMs: number): Promise<Device | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const list = await api.devicesList();
    const found = list.find(match);
    if (found) return found;
    await sleep(500);
  }
  return null;
}

async function busyError(port: string): Promise<FlashError> {
  const holders = await api.portHolders().catch(() => []);
  return new FlashError(
    "Порт занят",
    holders.length
      ? `${port} держит монитор порта PlatformIO. Закрыть его и продолжить? Потом откройте монитор снова.`
      : `${port} занят другой программой. Закройте её и повторите.`,
    holders.length ? "kill-monitor" : "retry",
    holders.map((h) => ({ pid: h.pid, name: h.name })),
  );
}

async function prepareBoard(env: string, dfu: boolean): Promise<string | null> {
  const devices = await api.devicesList();
  if (dfu) {
    if (devices.some((d) => d.kind === "stm32-dfu")) return null;
    const cdc = devices.find((d) => d.kind === "stm32-cdc");
    if (cdc?.port) {
      activity(`Перезагружаю плату в режим прошивки (${cdc.port})…`);
      try {
        await api.boardBootloader(cdc.port);
      } catch (e) {
        const text = errorText(e);
        if (text.startsWith("PORT_BUSY")) throw await busyError(cdc.port);
        throw new FlashError("Плата не ответила", text, "retry");
      }
      const dfuDevice = await waitDevice((d) => d.kind === "stm32-dfu", 12000);
      if (dfuDevice) return null;
      throw new FlashError(
        "Плата не перешла в режим прошивки",
        "Команда отправлена, но загрузчик не появился. Если плата заармлена — снимите ARM. Или включите режим вручную.",
        "bootloader",
      );
    }
    throw new FlashError(
      "Плата не найдена",
      "Подключите плату по USB. Если на ней ещё нет нашей прошивки — включите режим прошивки вручную.",
      "bootloader",
    );
  }
  const port = devices.find((d) => d.kind === "usb-serial" || d.kind === "esp32-usb")?.port ?? null;
  if (!port) throw new FlashError("Плата не найдена", `Подключите плату ${env} по USB и повторите.`, "retry");
  return port;
}

async function checkDriver() {
  const drv = await api.dfuDriverStatus().catch(() => null);
  if (drv && drv.present && !drv.ok) {
    throw new FlashError(
      "Нет драйвера для режима прошивки",
      `Windows видит «STM32 BOOTLOADER», но драйвер не установлен (${drv.status}${drv.problem ? `, код ${drv.problem}` : ""}).`,
      "driver",
    );
  }
}

async function verify(manifest: Manifest, project: PlaneProject, hash: string, dfu: boolean): Promise<{ ok: boolean; text: string }> {
  const board = findBoard(manifest, project.board);
  if (!dfu) {
    return { ok: true, text: `Прошивка залита в ${board?.title ?? project.board}.` };
  }
  activity("Жду, пока плата загрузится…");
  const cdc = await waitDevice((d) => d.kind === "stm32-cdc", 20000);
  if (!cdc?.port) {
    return { ok: false, text: "Прошивка залита, но плата не появилась как COM-порт. Переподключите USB и проверьте." };
  }
  await sleep(800);
  let identity: Identity | null = null;
  for (let i = 0; i < 3 && !identity; i++) {
    identity = await api.boardIdentity(cdc.port, true).catch(() => null);
    if (!identity) await sleep(700);
  }
  if (!identity) return { ok: false, text: `Прошивка залита, плата на ${cdc.port}, но паспорт не прочитался.` };
  if (identity.config !== hash) {
    return { ok: false, text: `Плата ответила, но хэш конфигурации другой: ${identity.config || "пусто"} вместо ${hash}.` };
  }
  return { ok: true, text: `На плате ровно то, что в проекте: «${identity.plane}», хэш ${hash}, ${cdc.port}.` };
}

export async function runFlash(planeId: string) {
  const app = useApp.getState();
  const plane = app.planes.find((p) => p.id === planeId);
  const manifest = app.manifest;
  const source = app.settings.firmwareSource;
  if (!plane || !manifest || !source) return;
  const board = findBoard(manifest, plane.board);
  const dfu = board?.uploadProtocol === "dfu";

  const state: FlashState = {
    planeId,
    running: true,
    steps: initialSteps(dfu),
    progress: null,
    activity: "Готовлю исходники…",
    log: [],
  };
  app.startFlash(state);

  let compiled = 0;
  const unlisten = await onTaskLog((l) => {
    appendLog(l.line);
    if (l.task === "build" && /^(Compiling|Archiving|Linking|Indexing)/.test(l.line)) {
      compiled++;
      const what = l.line.startsWith("Linking") ? "Компоновка" : `Компилирую (${compiled})`;
      activity(`${what}…`);
    }
    if (l.task === "upload") {
      const m = l.line.match(/(?:Download|Erase)[^\d]*(\d{1,3})%/) ?? l.line.match(/\((\d{1,3}) ?%\)/);
      if (m) activity(l.line.includes("Erase") ? "Стираю…" : "Заливаю…", Number(m[1]) / 100);
    }
  });

  let record: FlashRecord | null = null;
  let current = "build";
  try {
    // 1. сборка
    setStep("build", "run");
    const commit = await api.firmwareCommit(source);
    const config = toFirmwareConfig(manifest, plane);
    const hash = await configHash(config, commit);
    config.project = { plane: plane.name, configHash: hash, commit, boardEnv: plane.board };
    const prepared = await api.firmwarePrepare(source, plane.id);
    appendLog(`Исходники: ${source} → ${prepared.dir} (скопировано ${prepared.copied})`);
    const applied = await api.firmwareApply(source, prepared.dir, config);
    if (!applied.ok) {
      throw new FlashError("Конфигурация не записалась", (applied.errors ?? []).join("\n"));
    }
    appendLog(`Конфигурация записана: ${(applied.changed ?? []).join(", ") || "без изменений"}`);
    activity("Собираю прошивку…");
    const built = await api.firmwareBuild(prepared.dir, plane.board);
    if (!built.ok) {
      const why = explainFailure(built.tail, "build");
      throw new FlashError(why.title, why.text, why.action);
    }
    setStep("build", "ok", built.firmware ? built.firmware.split(/[\\/]/).pop() : undefined);

    // 2. плата
    current = "board";
    setStep("board", "run");
    const port = await prepareBoard(plane.board, dfu);
    if (dfu) await checkDriver();
    setStep("board", "ok", port ?? (dfu ? "STM32 BOOTLOADER" : undefined));

    // 3. заливка
    current = "upload";
    setStep("upload", "run");
    activity("Заливаю…", 0);
    const uploaded = await api.firmwareUpload(prepared.dir, plane.board, port);
    if (!uploaded.ok) {
      const why = explainFailure(uploaded.tail, "upload");
      throw new FlashError(why.title, why.text, why.action);
    }
    setStep("upload", "ok");

    // 4. проверка
    current = "verify";
    setStep("verify", "run");
    const result = await verify(manifest, plane, hash, dfu);
    setStep("verify", result.ok ? "ok" : "fail", result.ok ? undefined : "не подтверждено");
    record = { at: new Date().toISOString(), board: plane.board, commit, configHash: hash, ok: result.ok };
    flash().setFlash((f) => ({ ...f, running: false, progress: null, activity: "", done: { verified: result.ok, text: result.text } }));
    void api.hangarSnapshot(plane.id, `flash-${hash}`, { record, config });
  } catch (e) {
    const err =
      e instanceof FlashError ? e : new FlashError("Что-то пошло не так", errorText(e), "retry");
    setStep(current, "fail");
    flash().setFlash((f) => ({
      ...f,
      running: false,
      progress: null,
      activity: "",
      error: { title: err.title, text: err.message, action: err.action, holders: err.holders },
    }));
  } finally {
    unlisten();
  }

  if (record) {
    const done = record;
    useApp.getState().updatePlane((p) => {
      if (p.id !== planeId) return;
      p.lastFlash = done;
      p.history = [done, ...p.history].slice(0, 50);
      if (p.reached !== "setup") p.reached = "setup";
    });
  }
}
