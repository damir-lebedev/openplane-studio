// Состояние приложения: разделы, ангар, описание прошивки, платы на USB.

import { create } from "zustand";

import { api, AppInfo, CalibFlags, Device, errorText, Identity, inTauri, LiveFrame, onBoardEvents, ScanResult, Settings } from "./api";
import { Proc, ProcKind, PROC_KEY, procLine, procStart } from "./core/live";
import { Manifest } from "./core/manifest";
import { setLanguage, t } from "./i18n";
import { findTemplate, fromTemplate } from "./core/templates";
import {
  blankProject,
  FULL_STEPS,
  importFromFirmware,
  newId,
  PlaneProject,
  SIMPLE_STEPS,
  stepIndex,
  StepId,
} from "./core/project";

export type Section = "hangar" | "board" | "flights" | "live" | "blackbox" | "cargo" | "settings";
export type Mode = "simple" | "full";

export interface PortInfo {
  identity: Identity | null;
  busy?: boolean;
  error?: string;
  at: number;
}

export interface FlashStep {
  id: string;
  title: string;
  status: "wait" | "run" | "ok" | "fail" | "skip";
  detail?: string;
}

export type FlashAction = "kill-monitor" | "bootloader" | "driver" | "retry";

export interface FlashState {
  planeId: string;
  running: boolean;
  steps: FlashStep[];
  progress: number | null;
  activity: string;
  log: string[];
  error?: { title: string; text: string; action?: FlashAction; holders?: { pid: number; name: string }[] };
  done?: { verified: boolean; text: string };
  /** калибровки на плате до и после прошивки: что пропало, чего нет */
  calib?: { before: CalibFlags | null; after: CalibFlags; lost: string[]; kept: string[]; missing: string[] };
}

export interface LinkInfo {
  port: string | null;
  state: "idle" | "connecting" | "open" | "error";
  error?: string;
  attemptAt: number;
  /** прошивка на плате живых данных не шлёт — старше приложения */
  noLive?: boolean;
}

export interface Toast {
  id: number;
  kind: "ok" | "info" | "warn" | "err";
  text: string;
}

interface AppState {
  ready: boolean;
  section: Section;
  info: AppInfo | null;
  settings: Settings;
  manifest: Manifest | null;
  manifestError: string | null;
  manifestLoading: boolean;
  planes: PlaneProject[];
  currentId: string | null;
  step: StepId;
  mode: Mode;
  boardTab: "wizard" | "params";
  devices: Device[];
  ports: Record<string, PortInfo>;
  flash: FlashState | null;
  toasts: Toast[];
  focus: string[];
  link: LinkInfo;
  /** порт, от которого отключились вручную: сами не подключаемся, пока плату не переткнут */
  linkHold: string | null;
  live: LiveFrame | null;
  liveAt: number;
  consoleLines: string[];
  /** сколько строк консоли пришло всего (consoleLines хранит последние) */
  consoleSeq: number;
  scan: ScanResult | null;
  scanAt: number;
  /** калибровка, запущенная из приложения или с пульта, — по тексту консоли */
  proc: Proc | null;
  boardPanel: boolean;

  init(): Promise<void>;
  setSection(section: Section): void;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  refreshInfo(): Promise<void>;
  reloadManifest(): Promise<void>;
  current(): PlaneProject | null;
  selectPlane(id: string | null): void;
  /** "import" — из прошивки как есть, "blank" — с нуля, "tpl:<id>" — по шаблону */
  createPlane(kind: string, name: string): PlaneProject | null;
  duplicatePlane(id: string): void;
  removePlane(id: string): Promise<void>;
  updatePlane(update: (p: PlaneProject) => void): void;
  /** Ctrl+Z / Ctrl+Y по правкам текущего самолёта */
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  setStep(step: StepId): void;
  nextStep(): void;
  prevStep(): void;
  setMode(mode: Mode): void;
  setBoardTab(tab: "wizard" | "params"): void;
  setFocus(parts: string[]): void;
  pollDevices(): Promise<void>;
  queryPort(port: string, stm32: boolean): Promise<void>;
  setFlash(update: (f: FlashState) => FlashState): void;
  startFlash(state: FlashState): void;
  closeFlash(): void;
  toast(kind: Toast["kind"], text: string): void;
  connect(port: string, stm32: boolean): Promise<void>;
  disconnect(manual?: boolean): Promise<void>;
  command(cmd: string): Promise<void>;
  sendRaw(text: string): Promise<void>;
  requestScan(): Promise<void>;
  startProc(kind: ProcKind): Promise<void>;
  clearProc(): void;
  setBoardPanel(open: boolean): void;
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Отмена правок: по стопке на самолёт. Правки подряд быстрее UNDO_MERGE_MS
// (набор числа в поле) — один шаг.
const UNDO_LIMIT = 100;
const UNDO_MERGE_MS = 700;
const undoStacks = new Map<string, PlaneProject[]>();
const redoStacks = new Map<string, PlaneProject[]>();
let lastEdit = { id: "", at: 0 };
let toastSeq = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let eventsBound = false;
let procTimer: ReturnType<typeof setInterval> | null = null;
const querying = new Set<string>();

/** Сколько ждать конца процедуры, пока плата молчит. */
const PROC_TIMEOUT_MS: Record<ProcKind, number> = { gyro: 10000, compass: 30000, mount: 120000, ground: 120000 };

export function stepsFor(mode: Mode): StepId[] {
  return mode === "simple" ? SIMPLE_STEPS : FULL_STEPS;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  section: "hangar",
  info: null,
  settings: {},
  manifest: null,
  manifestError: null,
  manifestLoading: false,
  planes: [],
  currentId: null,
  step: "board",
  mode: "simple",
  boardTab: "wizard",
  devices: [],
  ports: {},
  flash: null,
  toasts: [],
  focus: [],
  link: { port: null, state: "idle", attemptAt: 0 },
  linkHold: null,
  live: null,
  liveAt: 0,
  consoleLines: [],
  consoleSeq: 0,
  scan: null,
  scanAt: 0,
  proc: null,
  boardPanel: false,

  async init() {
    if (!inTauri()) {
      set({ ready: true, manifestError: t("Приложение запущено не в окне Tauri: нет доступа к системе") });
      return;
    }
    try {
      const [info, settings, planes] = await Promise.all([api.appInfo(), api.settingsLoad(), api.hangarList()]);
      planes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      // Язык не выбирали: ангар уже с самолётами — им пользовались по-русски, не удивляем.
      setLanguage(settings.language ?? (planes.length ? "ru" : undefined));
      const firmwareSource = settings.firmwareSource || info.firmware_guess || undefined;
      const currentId = planes.some((p) => p.id === settings.currentPlane) ? settings.currentPlane! : planes[0]?.id ?? null;
      set({
        info,
        settings: { ...settings, firmwareSource },
        planes,
        currentId,
        mode: settings.mode ?? "simple",
        section: planes.length ? "board" : "hangar",
        ready: true,
      });
      if (firmwareSource && firmwareSource !== settings.firmwareSource) {
        await api.settingsSave({ ...settings, firmwareSource });
      }
      await get().reloadManifest();
    } catch (e) {
      set({ ready: true, manifestError: errorText(e) });
    }
    if (!eventsBound) {
      eventsBound = true;
      void onBoardEvents({
        live: (_port, data) => set({ live: data, liveAt: Date.now() }),
        id: (port, identity) => {
          set((s) => ({ ports: { ...s.ports, [port]: { identity, at: Date.now() } } }));
          const match = get().planes.find((p) => p.lastFlash?.configHash === identity.config || (identity.plane && p.name === identity.plane));
          if (match && match.id !== get().currentId && !get().flash) {
            get().toast("info", t("Подключена плата с «{name}»", { name: match.name }));
          }
        },
        scan: (_port, data) => set({ scan: data, scanAt: Date.now() }),
        line: (_port, line) =>
          set((s) => {
            const lines = s.consoleLines.length > 600 ? s.consoleLines.slice(-500) : s.consoleLines.slice();
            lines.push(line);
            let proc = s.proc;
            // Калибровку на земле запустили с пульта (SwB 3 раза) — мастер тоже её покажет.
            if ((!proc || proc.state !== "run") && /^Калибровка самолёта \(/.test(line.trim())) proc = procStart("ground");
            else if (proc) proc = procLine(proc, line);
            return { consoleLines: lines, consoleSeq: s.consoleSeq + 1, proc };
          }),
        noLive: (port) => set((s) => (s.link.port === port ? { link: { ...s.link, noLive: true } } : {})),
        link: (st) =>
          set((s) => ({
            link: { ...s.link, port: st.state === "open" ? st.port : s.link.port, state: st.state === "open" ? "open" : st.state === "error" ? "error" : "idle", error: st.error ?? undefined },
            live: st.state === "open" ? s.live : null,
            proc: st.state !== "open" && s.proc?.state === "run" ? { ...s.proc, state: "fail", text: t("связь с платой пропала") } : s.proc,
          })),
      });
    }
    if (!pollTimer) {
      pollTimer = setInterval(() => void get().pollDevices(), 2000);
      void get().pollDevices();
    }
  },

  setSection(section) {
    set({ section });
  },

  async saveSettings(patch) {
    if ("language" in patch) setLanguage(patch.language);
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await api.settingsSave(settings);
    if ("firmwareSource" in patch) await get().reloadManifest();
  },

  async refreshInfo() {
    try {
      set({ info: await api.appInfo() });
    } catch {
      /* останется прежнее */
    }
  },

  async reloadManifest() {
    const source = get().settings.firmwareSource;
    if (!source) {
      set({ manifest: null, manifestError: t("Не указана папка с исходниками прошивки — откройте «Настройки»") });
      return;
    }
    set({ manifestLoading: true });
    try {
      const manifest = await api.firmwareDescribe(source);
      set({ manifest, manifestError: null, manifestLoading: false });
    } catch (e) {
      set({ manifest: null, manifestError: errorText(e), manifestLoading: false });
    }
  },

  current() {
    const { planes, currentId } = get();
    return planes.find((p) => p.id === currentId) ?? null;
  },

  selectPlane(id) {
    const plane = get().planes.find((p) => p.id === id);
    const steps = stepsFor(get().mode);
    let step: StepId = "board";
    if (plane) {
      const reached = steps.filter((s) => stepIndex(s) <= stepIndex(plane.reached));
      step = plane.reached === "review" || plane.reached === "setup" ? "review" : reached[reached.length - 1] ?? "board";
    }
    set({ currentId: id, step, boardTab: "wizard" });
    void api.settingsSave({ ...get().settings, currentPlane: id ?? undefined });
    set((s) => ({ settings: { ...s.settings, currentPlane: id ?? undefined } }));
  },

  createPlane(kind, name) {
    const manifest = get().manifest;
    if (!manifest) return null;
    const tpl = kind.startsWith("tpl:") ? findTemplate(kind.slice(4)) : undefined;
    const plane = tpl ? fromTemplate(manifest, tpl, name) : kind === "import" ? importFromFirmware(manifest, name) : blankProject(manifest, name);
    set((s) => ({ planes: [plane, ...s.planes] }));
    void api.hangarSave(plane);
    get().selectPlane(plane.id);
    set({ step: kind === "import" ? "review" : "board", section: "board" });
    return plane;
  },

  duplicatePlane(id) {
    const src = get().planes.find((p) => p.id === id);
    if (!src) return;
    const now = new Date().toISOString();
    const copy: PlaneProject = {
      ...structuredClone(src),
      id: newId(),
      name: t("{name} (копия)", { name: src.name }),
      createdAt: now,
      updatedAt: now,
      lastFlash: undefined,
      history: [],
    };
    set((s) => ({ planes: [copy, ...s.planes] }));
    void api.hangarSave(copy);
  },

  async removePlane(id) {
    await api.hangarRemove(id);
    set((s) => ({
      planes: s.planes.filter((p) => p.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
    }));
  },

  updatePlane(update) {
    const id = get().currentId;
    if (!id) return;
    let saved: PlaneProject | null = null;
    let before: PlaneProject | null = null;
    set((s) => ({
      planes: s.planes.map((p) => {
        if (p.id !== id) return p;
        const next = structuredClone(p);
        update(next);
        next.updatedAt = new Date().toISOString();
        saved = next;
        before = p;
        return next;
      }),
    }));
    if (!saved || !before) return;
    const now = Date.now();
    const stack = undoStacks.get(id) ?? [];
    if (!(lastEdit.id === id && now - lastEdit.at < UNDO_MERGE_MS && stack.length)) {
      stack.push(before);
      if (stack.length > UNDO_LIMIT) stack.shift();
    }
    undoStacks.set(id, stack);
    redoStacks.set(id, []);
    lastEdit = { id, at: now };
    persistPlane(saved);
  },

  undo() {
    stepHistory(undoStacks, redoStacks);
  },

  redo() {
    stepHistory(redoStacks, undoStacks);
  },

  canUndo() {
    const id = get().currentId;
    return !!id && (undoStacks.get(id)?.length ?? 0) > 0;
  },

  canRedo() {
    const id = get().currentId;
    return !!id && (redoStacks.get(id)?.length ?? 0) > 0;
  },

  setStep(step) {
    // Шаг только полного режима (безопасность, система, пульт) — включить полный.
    if (!stepsFor(get().mode).includes(step)) {
      set({ mode: "full" });
      void get().saveSettings({ mode: "full" });
    }
    set({ step, boardTab: "wizard", focus: [] });
  },

  nextStep() {
    const steps = stepsFor(get().mode);
    const i = steps.indexOf(get().step);
    const next = steps[Math.min(i + 1, steps.length - 1)];
    const plane = get().current();
    if (plane && stepIndex(next) > stepIndex(plane.reached)) {
      get().updatePlane((p) => (p.reached = next));
    }
    get().setStep(next);
  },

  prevStep() {
    const steps = stepsFor(get().mode);
    const i = steps.indexOf(get().step);
    get().setStep(steps[Math.max(i - 1, 0)]);
  },

  setMode(mode) {
    const steps = stepsFor(mode);
    let step = get().step;
    if (!steps.includes(step)) {
      // шаг полного режима → ближайший шаг простого перед ним
      step = steps.filter((s) => stepIndex(s) <= stepIndex(step)).pop() ?? "board";
    }
    set({ mode, step, boardTab: mode === "simple" ? "wizard" : get().boardTab });
    void get().saveSettings({ mode });
  },

  setBoardTab(boardTab) {
    set({ boardTab });
  },

  setFocus(focus) {
    set({ focus });
  },

  async pollDevices() {
    if (get().flash?.running) return; // во время прошивки порты не трогаем
    try {
      const devices = await api.devicesList();
      const ports = { ...get().ports };
      const present = new Set(devices.map((d) => d.port).filter(Boolean) as string[]);
      for (const port of Object.keys(ports)) if (!present.has(port)) delete ports[port];
      set({ devices, ports });
      // Наша прошивка на STM32 — подключаемся сами и держим связь.
      const cdc = devices.find((d) => d.kind === "stm32-cdc" && d.port);
      const link = get().link;
      if (get().linkHold && !present.has(get().linkHold!)) set({ linkHold: null });
      if (cdc?.port) {
        const sameOpen = link.port === cdc.port && (link.state === "open" || link.state === "connecting");
        const cooling = link.state === "error" && Date.now() - link.attemptAt < 5000;
        const held = get().linkHold === cdc.port;
        if (!sameOpen && !cooling && !held) void get().connect(cdc.port, true);
      } else if (link.state === "open" && link.port && !present.has(link.port)) {
        set({ link: { port: null, state: "idle", attemptAt: 0 }, live: null });
      }
      // Связь есть, а паспорта нет (плата ещё загружалась, когда спросили) — спросить снова.
      const now = get().link;
      if (now.state === "open" && now.port && !get().ports[now.port]?.identity) void api.linkCommand("id").catch(() => {});
    } catch {
      /* список устройств недоступен — попробуем в следующий раз */
    }
  },

  async queryPort(port, stm32) {
    querying.add(port);
    try {
      const identity = await api.boardIdentity(port, stm32);
      set((s) => ({ ports: { ...s.ports, [port]: { identity, at: Date.now() } } }));
      if (identity?.plane) {
        const match = get().planes.find(
          (p) => p.lastFlash?.configHash === identity.config || p.name === identity.plane,
        );
        if (match && match.id !== get().currentId && !get().flash) {
          get().toast("info", t("Подключена плата с «{name}»", { name: match.name }));
        }
      }
    } catch (e) {
      const text = errorText(e);
      set((s) => ({
        ports: { ...s.ports, [port]: { identity: null, busy: text.startsWith("PORT_BUSY"), error: text, at: Date.now() } },
      }));
    } finally {
      querying.delete(port);
    }
  },

  setFlash(update) {
    const f = get().flash;
    if (f) set({ flash: update(f) });
  },

  startFlash(state) {
    set({ flash: state });
  },

  closeFlash() {
    if (get().flash?.running) return;
    // Паспорта портов устарели (плата перепрошита), кроме того, что связь
    // уже спросила заново; на всякий случай — спросить ещё раз.
    const { link } = get();
    const held = link.state === "open" ? link.port : null;
    set((s) => ({ flash: null, ports: held && s.ports[held] ? { [held]: s.ports[held] } : {} }));
    if (held) void api.linkCommand("id").catch(() => {});
    void get().pollDevices();
  },

  async connect(port, stm32) {
    set({ link: { port, state: "connecting", attemptAt: Date.now() }, linkHold: null });
    try {
      await api.linkStart(port, stm32);
      set((s) => ({ link: { ...s.link, port, state: "open" }, ports: { ...s.ports, [port]: { ...(s.ports[port] ?? { identity: null }), busy: false, error: undefined, at: Date.now() } } }));
    } catch (e) {
      const text = errorText(e);
      set((s) => ({
        link: { port, state: "error", error: text, attemptAt: Date.now() },
        ports: { ...s.ports, [port]: { identity: s.ports[port]?.identity ?? null, busy: text.startsWith("PORT_BUSY"), error: text, at: Date.now() } },
      }));
    }
  },

  async disconnect(manual = false) {
    const port = get().link.port;
    await api.linkStop().catch(() => {});
    set({ link: { port: null, state: "idle", attemptAt: Date.now() }, live: null, linkHold: manual ? port : get().linkHold });
  },

  async command(cmd) {
    await api.linkCommand(cmd);
  },

  async sendRaw(text) {
    await api.linkSend(text);
  },

  async requestScan() {
    set({ scan: null });
    await api.linkCommand("scan");
  },

  async startProc(kind) {
    set({ proc: procStart(kind) });
    try {
      await api.linkCommand(`act ${PROC_KEY[kind]}`);
    } catch (e) {
      set({ proc: { ...procStart(kind), state: "fail", text: errorText(e) } });
      return;
    }
    if (!procTimer) {
      procTimer = setInterval(() => {
        const p = get().proc;
        if (!p || p.state !== "run") return;
        // Калибровка на земле идёт сама, пока плата шлёт кадры; блокирующие — по таймауту.
        if (Date.now() - p.startedAt > PROC_TIMEOUT_MS[p.kind]) {
          set({ proc: { ...p, state: "fail", text: t("плата не ответила — она на связи?") } });
        }
      }, 1000);
    }
  },

  clearProc() {
    set({ proc: null });
  },

  setBoardPanel(open) {
    set({ boardPanel: open });
  },

  toast(kind, text) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
}));

/** Сохранить самолёт в ангар через 0,4 с после последней правки. */
function persistPlane(plane: PlaneProject) {
  clearTimeout(saveTimers.get(plane.id));
  saveTimers.set(
    plane.id,
    setTimeout(() => {
      api.hangarSave(plane).catch((e) => useApp.getState().toast("err", t("Не сохранилось: {e}", { e: errorText(e) })));
    }, 400),
  );
}

/** Шаг по истории правок: из одной стопки — в самолёт, нынешнее — в другую. */
function stepHistory(from: Map<string, PlaneProject[]>, to: Map<string, PlaneProject[]>) {
  const { currentId, planes } = useApp.getState();
  if (!currentId) return;
  const stack = from.get(currentId);
  const target = stack?.pop();
  const now = planes.find((p) => p.id === currentId);
  if (!target || !now) return;
  const other = to.get(currentId) ?? [];
  other.push(now);
  to.set(currentId, other);
  lastEdit = { id: "", at: 0 };
  // История прошивок и наладка — не правки: остаются нынешними.
  const restored: PlaneProject = { ...target, history: now.history, lastFlash: now.lastFlash, setup: now.setup, updatedAt: new Date().toISOString() };
  useApp.setState({ planes: planes.map((p) => (p.id === currentId ? restored : p)) });
  persistPlane(restored);
}
