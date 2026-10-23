// Кнопка «Прошить»: сборка → плата в загрузчик → заливка → проверка паспорта.
// Каждая ошибка — одна фраза «что случилось» и действие «что сделать».

import { api, CalibFlags, Device, errorText, Identity, onTaskLog } from "./api";
import { copterConfig, copterHash, findCopterEnv } from "./core/copter";
import { isFresh } from "./core/live";
import { fingerprint } from "./core/migrate";
import { findBoard, Manifest } from "./core/manifest";
import { configHash, FlashRecord, PlaneProject, toFirmwareConfig } from "./core/project";
import { N_, t } from "./i18n";
import { FlashAction, FlashState, FlashStep, useApp } from "./store";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CALIB_NAMES: Record<keyof CalibFlags, string> = { mount: N_("установка IMU"), park: N_("калибровка на земле"), magcal: N_("компас") };
const calibName = (k: keyof CalibFlags) => t(CALIB_NAMES[k]);

/** Калибровки, о которых плата сказала в последнем живом кадре (null — кадров нет). */
function calibNow(since = 0): CalibFlags | null {
  const s = useApp.getState();
  if (!s.live || !isFresh(s.liveAt) || s.liveAt < since) return null;
  return { mount: s.live.mount, park: s.live.park, magcal: s.live.magcal };
}

/**
 * После прошивки: калибровки, что были на плате, на месте? Плата хранит их
 * отдельно от программы, прошивка их не трогает — но проверяем: связь
 * переподключится сама, ждём первый живой кадр новой прошивки.
 */
async function checkCalibrations(before: CalibFlags | null) {
  const start = Date.now();
  let after: CalibFlags | null = null;
  while (!after && Date.now() - start < 20000) {
    await sleep(500);
    after = calibNow(start);
  }
  if (!after) return;
  const lost = before ? (Object.keys(CALIB_NAMES) as (keyof CalibFlags)[]).filter((k) => before[k] && !after![k]).map(calibName) : [];
  const missing = (Object.keys(CALIB_NAMES) as (keyof CalibFlags)[]).filter((k) => after![k] === false).map(calibName);
  const kept = before ? (Object.keys(CALIB_NAMES) as (keyof CalibFlags)[]).filter((k) => before[k] && after![k]).map(calibName) : [];
  const app = useApp.getState();
  if (app.flash && !app.flash.running) app.setFlash((f) => ({ ...f, calib: { before, after: after!, lost, kept, missing } }));
  if (lost.length) app.toast("warn", t("После прошивки пропало: {list} — повторите в «Наладке»", { list: lost.join(", ") }));
}

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
    { id: "build", title: t("Сборка прошивки"), status: "wait" },
    { id: "board", title: dfu ? t("Плата в режим прошивки") : t("Поиск платы"), status: "wait" },
    { id: "upload", title: t("Заливка"), status: "wait" },
    { id: "verify", title: t("Проверка: на плате то, что в проекте"), status: "wait" },
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
  const low = tail.toLowerCase();
  if (task === "build") {
    const err = tail.split("\n").find((l) => /\berror:/.test(l) && /\.(h|cpp|c)\b/.test(l));
    if (err) return { title: t("Прошивка не собралась"), text: err.trim().slice(0, 400) };
    if (low.includes("unknownpackageerror") || low.includes("could not install") || low.includes("httpclienterror")) {
      return { title: t("PlatformIO не скачал инструменты"), text: t("Проверьте интернет: первая сборка качает компилятор и библиотеки.") };
    }
    return { title: t("Прошивка не собралась"), text: t("Подробности — в журнале ниже.") };
  }
  if (low.includes("no dfu capable usb device")) {
    return {
      title: t("Плата не в режиме прошивки"),
      text: t("dfu-util не нашёл STM32 в загрузчике. Включите режим прошивки и повторите."),
      action: "bootloader",
    };
  }
  if (low.includes("libusb_error_not_supported") || low.includes("cannot open dfu device") || low.includes("libusb_error_access")) {
    return {
      title: t("Нет драйвера для режима прошивки"),
      text: t("Windows видит «STM32 BOOTLOADER», но без драйвера WinUSB dfu-util его не открывает."),
      action: "driver",
    };
  }
  if (low.includes("could not open port") || low.includes("access is denied") || low.includes("permissionerror")) {
    return { title: t("Порт занят"), text: t("COM-порт держит другая программа — чаще всего монитор порта."), action: "kill-monitor" };
  }
  if (low.includes("failed to connect to esp32") || low.includes("wrong boot mode")) {
    return {
      title: t("ESP32 не вошла в режим прошивки"),
      text: t("Зажмите кнопку BOOT на плате, нажмите и отпустите RESET (EN), отпустите BOOT и повторите."),
      action: "retry",
    };
  }
  return { title: t("Заливка не удалась"), text: t("Подробности — в журнале ниже."), action: "retry" };
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
    t("Порт занят"),
    holders.length
      ? t("{port} держит монитор порта PlatformIO. Закрыть его и продолжить? Потом откройте монитор снова.", { port })
      : t("{port} занят другой программой. Закройте её и повторите.", { port }),
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
      activity(t("Перезагружаю плату в режим прошивки ({port})…", { port: cdc.port }));
      const app = useApp.getState();
      if (app.link.state === "open" && app.link.port === cdc.port) {
        // Порт держит связь приложения — клавиша D идёт через неё.
        await api.linkSend("D").catch(() => {});
        await sleep(200);
        await app.disconnect();
      } else {
        try {
          await api.boardBootloader(cdc.port);
        } catch (e) {
          const text = errorText(e);
          if (text.startsWith("PORT_BUSY")) throw await busyError(cdc.port);
          throw new FlashError("Плата не ответила", text, "retry");
        }
      }
      const dfuDevice = await waitDevice((d) => d.kind === "stm32-dfu", 12000);
      if (dfuDevice) return null;
      throw new FlashError(
        t("Плата не перешла в режим прошивки"),
        t("Команда отправлена, но загрузчик не появился. Если плата заармлена — снимите ARM. Или включите режим вручную."),
        "bootloader",
      );
    }
    throw new FlashError(
      t("Плата не найдена"),
      t("Подключите плату по USB. Если на ней ещё нет нашей прошивки — включите режим прошивки вручную."),
      "bootloader",
    );
  }
  const port = devices.find((d) => d.kind === "usb-serial" || d.kind === "esp32-usb")?.port ?? null;
  if (!port) throw new FlashError(t("Плата не найдена"), t("Подключите плату {env} по USB и повторите.", { env }), "retry");
  if (useApp.getState().link.port === port) await useApp.getState().disconnect();   // порт нужен esptool
  return port;
}

async function checkDriver() {
  const drv = await api.dfuDriverStatus().catch(() => null);
  if (drv && drv.present && !drv.ok) {
    throw new FlashError(
      t("Нет драйвера для режима прошивки"),
      t("Windows видит «STM32 BOOTLOADER», но драйвер не установлен ({status}).", {
        status: drv.problem ? t("{status}, код {code}", { status: drv.status, code: drv.problem }) : drv.status,
      }),
      "driver",
    );
  }
}

async function verify(manifest: Manifest, project: PlaneProject, hash: string, dfu: boolean): Promise<{ ok: boolean; text: string }> {
  const board = findBoard(manifest, project.board);
  if (!dfu) {
    return { ok: true, text: t("Прошивка залита в {board}.", { board: board ? t(board.title) : project.board }) };
  }
  activity("Жду, пока плата загрузится…");
  const cdc = await waitDevice((d) => d.kind === "stm32-cdc", 20000);
  if (!cdc?.port) {
    return { ok: false, text: t("Прошивка залита, но плата не появилась как COM-порт. Переподключите USB и проверьте.") };
  }
  await sleep(800);
  let identity: Identity | null = null;
  for (let i = 0; i < 3 && !identity; i++) {
    identity = await api.boardIdentity(cdc.port, true).catch(() => null);
    if (!identity) await sleep(700);
  }
  if (!identity) return { ok: false, text: t("Прошивка залита, плата на {port}, но паспорт не прочитался.", { port: cdc.port }) };
  if (identity.config !== hash) {
    return { ok: false, text: t("Плата ответила, но хэш конфигурации другой: {got} вместо {want}.", { got: identity.config || t("пусто"), want: hash }) };
  }
  return { ok: true, text: t("На плате ровно то, что в проекте: «{plane}», хэш {hash}, {port}.", { plane: identity.plane, hash, port: cdc.port }) };
}

/** Журнал сборки и заливки — в окно прошивки, проценты — в строку состояния. */
function followLog() {
  let compiled = 0;
  return onTaskLog((l) => {
    appendLog(l.line);
    if (l.task === "build" && /^(Compiling|Archiving|Linking|Indexing)/.test(l.line)) {
      compiled++;
      const what = l.line.startsWith("Linking") ? t("Компоновка") : t("Компилирую ({n})", { n: compiled });
      activity(`${what}…`);
    }
    if (l.task === "upload") {
      const m = l.line.match(/(?:Download|Erase)[^\d]*(\d{1,3})%/) ?? l.line.match(/\((\d{1,3}) ?%\)/);
      if (m) activity(l.line.includes("Erase") ? t("Стираю…") : t("Заливаю…"), Number(m[1]) / 100);
    }
  });
}

function failFlash(e: unknown, step: string) {
  const err = e instanceof FlashError ? e : new FlashError(t("Что-то пошло не так"), errorText(e), "retry");
  setStep(step, "fail");
  flash().setFlash((f) => ({
    ...f,
    running: false,
    progress: null,
    activity: "",
    error: { title: err.title, text: err.message, action: err.action, holders: err.holders },
  }));
}

/** Вызов окна прошивки: самолёт или коптер — по id. */
export function runAnyFlash(id: string) {
  return useApp.getState().copters.some((c) => c.id === id) ? runCopterFlash(id) : runFlash(id);
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
    activity: t("Готовлю исходники…"),
    log: [],
  };
  app.startFlash(state);
  const unlisten = await followLog();

  let record: FlashRecord | null = null;
  let calibBefore: CalibFlags | null = null;
  let current = "build";
  try {
    // 1. сборка
    setStep("build", "run");
    const commit = await api.firmwareCommit(source);
    const config = toFirmwareConfig(manifest, plane);
    const hash = await configHash(config, commit);
    config.project = { plane: plane.name, configHash: hash, commit, boardEnv: plane.board };
    const prepared = await api.firmwarePrepare(source, plane.id);
    appendLog(t("Исходники: {src} → {dir} (скопировано {n})", { src: source, dir: prepared.dir, n: prepared.copied }));
    const applied = await api.firmwareApply(source, prepared.dir, config);
    if (!applied.ok) {
      throw new FlashError("Конфигурация не записалась", (applied.errors ?? []).join("\n"));
    }
    appendLog(t("Конфигурация записана: {list}", { list: (applied.changed ?? []).join(", ") || t("без изменений") }));
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
    calibBefore = calibNow();
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
    setStep("verify", result.ok ? "ok" : "fail", result.ok ? undefined : t("не подтверждено"));
    record = { at: new Date().toISOString(), board: plane.board, commit, configHash: hash, ok: result.ok };
    flash().setFlash((f) => ({ ...f, running: false, progress: null, activity: "", done: { verified: result.ok, text: result.text } }));
    void api.hangarSnapshot(plane.id, `flash-${hash}`, {
      record,
      config,
      plane: structuredClone(plane),
      calib: { before: calibBefore, after: null },
      firmware: fingerprint(manifest),
    });
    if (result.ok) void checkCalibrations(calibBefore);
  } catch (e) {
    failFlash(e, current);
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

/**
 * Прошивка коптера: та же дорога, но конфигурации в исходниках нет —
 * настройки коптера живут на плате (CLI). Приложение вшивает только паспорт
 * (название, хэш, коммит) и после заливки сверяет его.
 */
export async function runCopterFlash(copterId: string) {
  const app = useApp.getState();
  const copter = app.copters.find((c) => c.id === copterId);
  const manifest = app.manifest;
  const source = app.settings.firmwareSource;
  if (!copter || !manifest || !source) return;
  const env = findCopterEnv(manifest, copter.board);
  const dfu = (env?.uploadProtocol ?? "dfu") === "dfu";

  app.startFlash({ planeId: copterId, vehicle: "copter", running: true, steps: initialSteps(dfu), progress: null, activity: t("Готовлю исходники…"), log: [] });
  const unlisten = await followLog();

  let record: FlashRecord | null = null;
  let current = "build";
  try {
    // 1. сборка
    setStep("build", "run");
    if (!env) throw new FlashError(t("Нет такой сборки"), t("В исходниках прошивки нет сборки коптера {env}. Выберите плату на странице коптера.", { env: copter.board || "—" }));
    if (env.needsBoardDump) {
      throw new FlashError(
        t("Распиновка платы ещё не снята"),
        t("Заголовок платы {file} — заглушка. Снимите распиновку с платы (шаги на странице коптера) и повторите.", { file: env.boardFile ?? env.env }),
      );
    }
    const commit = await api.firmwareCommit(source);
    const hash = await copterHash(copter, commit);
    const config = { ...copterConfig(copter), project: { plane: copter.name, configHash: hash, commit, boardEnv: copter.board } };
    const prepared = await api.firmwarePrepare(source, copter.id);
    appendLog(t("Исходники: {src} → {dir} (скопировано {n})", { src: source, dir: prepared.dir, n: prepared.copied }));
    const applied = await api.firmwareApply(source, prepared.dir, config);
    if (!applied.ok) throw new FlashError(t("Паспорт не записался"), (applied.errors ?? []).join("\n"));
    activity(t("Собираю прошивку…"));
    const built = await api.firmwareBuild(prepared.dir, copter.board);
    if (!built.ok) {
      const why = explainFailure(built.tail, "build");
      throw new FlashError(why.title, why.text, why.action);
    }
    setStep("build", "ok", built.firmware ? built.firmware.split(/[\\/]/).pop() : undefined);

    // 2. плата
    current = "board";
    setStep("board", "run");
    const port = await prepareBoard(copter.board, dfu);
    if (dfu) await checkDriver();
    setStep("board", "ok", port ?? (dfu ? "STM32 BOOTLOADER" : undefined));

    // 3. заливка
    current = "upload";
    setStep("upload", "run");
    activity(t("Заливаю…"), 0);
    const uploaded = await api.firmwareUpload(prepared.dir, copter.board, port);
    if (!uploaded.ok) {
      const why = explainFailure(uploaded.tail, "upload");
      throw new FlashError(why.title, why.text, why.action);
    }
    setStep("upload", "ok");

    // 4. проверка паспорта
    current = "verify";
    setStep("verify", "run");
    const result = await verifyCopter(copter.name, hash, dfu);
    setStep("verify", result.ok ? "ok" : "fail", result.ok ? undefined : t("не подтверждено"));
    record = { at: new Date().toISOString(), board: copter.board, commit, configHash: hash, ok: result.ok };
    flash().setFlash((f) => ({ ...f, running: false, progress: null, activity: "", done: { verified: result.ok, text: result.text } }));
  } catch (e) {
    failFlash(e, current);
  } finally {
    unlisten();
  }

  if (record) {
    const done = record;
    useApp.getState().updateCopter(copterId, (c) => {
      c.lastFlash = done;
      c.history = [done, ...c.history].slice(0, 50);
    });
  }
}

async function verifyCopter(name: string, hash: string, dfu: boolean): Promise<{ ok: boolean; text: string }> {
  if (!dfu) return { ok: true, text: t("Прошивка залита в «{plane}».", { plane: name }) };
  activity(t("Жду, пока плата загрузится…"));
  const cdc = await waitDevice((d) => d.kind === "stm32-cdc", 20000);
  if (!cdc?.port) {
    return { ok: false, text: t("Прошивка залита, но плата не появилась как COM-порт. Переподключите USB и проверьте.") };
  }
  await sleep(800);
  let identity: Identity | null = null;
  for (let i = 0; i < 3 && !identity; i++) {
    identity = await api.boardIdentity(cdc.port, true).catch(() => null);
    if (!identity) await sleep(700);
  }
  if (!identity) return { ok: false, text: t("Прошивка залита, плата на {port}, но паспорт не прочитался.", { port: cdc.port }) };
  if (identity.vehicle !== "copter" || identity.config !== hash) {
    return { ok: false, text: t("Плата ответила, но хэш конфигурации другой: {got} вместо {want}.", { got: identity.config || t("пусто"), want: hash }) };
  }
  return { ok: true, text: t("На плате ровно то, что в проекте: «{plane}», хэш {hash}, {port}.", { plane: identity.plane, hash, port: cdc.port }) };
}
