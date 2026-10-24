// Состояние просмотра журнала: какой полёт открыт, видимое окно времени,
// курсор, воспроизведение, какие графики показаны. Отдельно от store
// приложения: курсор меняется 60 раз в секунду, и перерисовываться должны
// только графики.

import { create } from "zustand";

import { Flight } from "../../core/blackbox";
import { summarize, Summary } from "../../core/bbanalysis";
import { COPTER_DEFAULT, PLANE_DEFAULT } from "./panels";

export interface Source {
  /** что открыто: файл на диске, полёт с платы (сохранён в файл), файл кольца с карты */
  label: string;
  path?: string;
}

interface BbState {
  flight: Flight | null;
  summary: Summary | null;
  source: Source | null;
  /** видимое окно, с */
  t0: number;
  t1: number;
  cursor: number;
  playing: boolean;
  speed: number;
  /** графики по виду аппарата: у коптера и самолёта свои */
  panels: Record<Vehicle, string[]>;
  axis: number;

  open(flight: Flight, source: Source): void;
  close(): void;
  setView(t0: number, t1: number): void;
  setCursor(t: number): void;
  zoomAt(t: number, factor: number): void;
  pan(dt: number): void;
  fit(): void;
  setPlaying(on: boolean): void;
  setSpeed(x: number): void;
  togglePanel(vehicle: Vehicle, id: string): void;
  setAxis(a: number): void;
}

export type Vehicle = "copter" | "plane";
const STORED = "openplane.blackbox.panels";

function loadPanels(): Record<Vehicle, string[]> {
  const out: Record<Vehicle, string[]> = { copter: COPTER_DEFAULT, plane: PLANE_DEFAULT };
  try {
    const v = JSON.parse(localStorage.getItem(STORED) ?? "null");
    for (const k of ["copter", "plane"] as Vehicle[]) {
      if (Array.isArray(v?.[k]) && v[k].every((x: unknown) => typeof x === "string")) out[k] = v[k];
    }
  } catch {
    // нет хранилища — по умолчанию
  }
  return out;
}

const MIN_SPAN = 0.02;

export const useBb = create<BbState>((set, get) => ({
  flight: null,
  summary: null,
  source: null,
  t0: 0,
  t1: 1,
  cursor: 0,
  playing: false,
  speed: 1,
  panels: loadPanels(),
  axis: 0,

  open(flight, source) {
    // сначала — вокруг ARM: полёт, а не предзапись
    const start = flight.start;
    const stop = flight.stop;
    set({ flight, source, summary: summarize(flight), t0: start, t1: stop, cursor: Math.max(start, 0), playing: false });
  },
  close() {
    set({ flight: null, summary: null, source: null, playing: false });
  },
  setView(t0, t1) {
    const f = get().flight;
    if (!f) return;
    let a = Math.min(t0, t1);
    let b = Math.max(t0, t1);
    if (b - a < MIN_SPAN) {
      const m = (a + b) / 2;
      a = m - MIN_SPAN / 2;
      b = m + MIN_SPAN / 2;
    }
    const full = f.stop - f.start;
    if (b - a > full) {
      a = f.start;
      b = f.stop;
    }
    if (a < f.start) {
      b += f.start - a;
      a = f.start;
    }
    if (b > f.stop) {
      a -= b - f.stop;
      b = f.stop;
    }
    set({ t0: a, t1: b });
  },
  setCursor(t) {
    const f = get().flight;
    if (!f) return;
    set({ cursor: Math.min(f.stop, Math.max(f.start, t)) });
  },
  zoomAt(t, factor) {
    const { t0, t1 } = get();
    get().setView(t - (t - t0) * factor, t + (t1 - t) * factor);
  },
  pan(dt) {
    const { t0, t1 } = get();
    get().setView(t0 + dt, t1 + dt);
  },
  fit() {
    const f = get().flight;
    if (f) set({ t0: f.start, t1: f.stop });
  },
  setPlaying(on) {
    set({ playing: on });
  },
  setSpeed(x) {
    set({ speed: x });
  },
  togglePanel(vehicle, id) {
    const list = get().panels[vehicle];
    const panels = { ...get().panels, [vehicle]: list.includes(id) ? list.filter((p) => p !== id) : [...list, id] };
    try {
      localStorage.setItem(STORED, JSON.stringify(panels));
    } catch {
      // без хранилища — только до перезапуска
    }
    set({ panels });
  },
  setAxis(a) {
    set({ axis: a });
  },
}));
