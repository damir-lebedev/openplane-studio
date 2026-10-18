// Состояние приложения: разделы, ангар, описание прошивки, платы на USB.

import { create } from "zustand";

import { api, AppInfo, Device, errorText, Identity, inTauri, LiveFrame, onBoardEvents, ScanResult, Settings } from "./api";
import { Manifest } from "./core/manifest";
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
}

export interface LinkInfo {
  port: string | null;
  state: "idle" | "connecting" | "open" | "error";
  error?: string;
  attemptAt: number;
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
  live: LiveFrame | null;
  liveAt: number;
  consoleLines: string[];
  scan: ScanResult | null;
  boardPanel: boolean;

  init(): Promise<void>;
  setSection(section: Section): void;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  refreshInfo(): Promise<void>;
  reloadManifest(): Promise<void>;
  current(): PlaneProject | null;
  selectPlane(id: string | null): void;
  createPlane(kind: "import" | "blank", name: string): PlaneProject | null;
  duplicatePlane(id: string): void;
  removePlane(id: string): Promise<void>;
  updatePlane(update: (p: PlaneProject) => void): void;
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
  disconnect(): Promise<void>;
  command(cmd: string): Promise<void>;
  sendRaw(text: string): Promise<void>;
  setBoardPanel(open: boolean): void;
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let toastSeq = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let eventsBound = false;
const querying = new Set<string>();

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
  live: null,
  liveAt: 0,
  consoleLines: [],
  scan: null,
  boardPanel: false,

  async init() {
    if (!inTauri()) {
      set({ ready: true, manifestError: "Приложение запущено не в окне Tauri: нет доступа к системе" });
      return;
    }
    try {
      const [info, settings, planes] = await Promise.all([api.appInfo(), api.settingsLoad(), api.hangarList()]);
      planes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
            get().toast("info", `Подключена плата с «${match.name}»`);
          }
        },
        scan: (_port, data) => set({ scan: data }),
        line: (_port, line) =>
          set((s) => {
            const lines = s.consoleLines.length > 600 ? s.consoleLines.slice(-500) : s.consoleLines.slice();
            lines.push(line);
            return { consoleLines: lines };
          }),
        link: (st) =>
          set((s) => ({
            link: { ...s.link, port: st.state === "open" ? st.port : s.link.port, state: st.state === "open" ? "open" : st.state === "error" ? "error" : "idle", error: st.error ?? undefined },
            live: st.state === "open" ? s.live : null,
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
      set({ manifest: null, manifestError: "Не указана папка с исходниками прошивки — откройте «Настройки»" });
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
    const plane = kind === "import" ? importFromFirmware(manifest, name) : blankProject(manifest, name);
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
      name: `${src.name} (копия)`,
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
    set((s) => ({
      planes: s.planes.map((p) => {
        if (p.id !== id) return p;
        const next = structuredClone(p);
        update(next);
        next.updatedAt = new Date().toISOString();
        saved = next;
        return next;
      }),
    }));
    if (!saved) return;
    const plane: PlaneProject = saved;
    clearTimeout(saveTimers.get(id));
    saveTimers.set(
      id,
      setTimeout(() => {
        api.hangarSave(plane).catch((e) => get().toast("err", `Не сохранилось: ${errorText(e)}`));
      }, 400),
    );
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
      if (cdc?.port) {
        const sameOpen = link.port === cdc.port && (link.state === "open" || link.state === "connecting");
        const cooling = link.state === "error" && Date.now() - link.attemptAt < 5000;
        if (!sameOpen && !cooling) void get().connect(cdc.port, true);
      } else if (link.state === "open" && link.port && !present.has(link.port)) {
        set({ link: { port: null, state: "idle", attemptAt: 0 }, live: null });
      }
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
          get().toast("info", `Подключена плата с «${match.name}»`);
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
    set({ flash: null, ports: {} });
    void get().pollDevices();
  },

  async connect(port, stm32) {
    set({ link: { port, state: "connecting", attemptAt: Date.now() } });
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

  async disconnect() {
    await api.linkStop().catch(() => {});
    set({ link: { port: null, state: "idle", attemptAt: Date.now() }, live: null });
  },

  async command(cmd) {
    await api.linkCommand(cmd);
  },

  async sendRaw(text) {
    await api.linkSend(text);
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
