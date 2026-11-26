// Dynamic idle (041, dyn_idle_*): прошивка держит самый медленный мотор не
// ниже dyn_idle_min_rpm, поднимая холостые регулятором PI(D). Повтор
// copter/DynamicIdle.h — для картинки во вкладке «Моторы»: как ведут себя
// обороты, когда газ сбросили и коптер падает в собственный поток винтов.

export interface DynIdle {
  minRpm: number;        // об/мин (dyn_idle_min_rpm × 100); 0 — выключен
  p: number;             // dyn_idle_p_gain, число BF
  i: number;             // dyn_idle_i_gain
  d: number;             // dyn_idle_d_gain
  maxIncrease: number;   // доля (dyn_idle_max_increase / 1000)
  startIncrease: number; // доля до airmode (dyn_idle_start_increase / 1000)
}

export const DYN_IDLE_PARAMS = [
  "dyn_idle_min_rpm",
  "dyn_idle_p_gain",
  "dyn_idle_i_gain",
  "dyn_idle_d_gain",
  "dyn_idle_max_increase",
  "dyn_idle_start_increase",
];

export const DYN_IDLE_DEFAULT: DynIdle = { minRpm: 0, p: 50, i: 50, d: 50, maxIncrease: 0.15, startIncrease: 0.05 };

type Params = Record<string, { value: unknown } | undefined>;

/** Настройки с платы (числа BF) → доли и об/мин. */
export function dynIdleFrom(params: Params): DynIdle {
  const num = (name: string, def: number) => {
    const v = Number(params[name]?.value);
    return Number.isFinite(v) ? v : def;
  };
  return {
    minRpm: num("dyn_idle_min_rpm", 0) * 100,
    p: num("dyn_idle_p_gain", DYN_IDLE_DEFAULT.p),
    i: num("dyn_idle_i_gain", DYN_IDLE_DEFAULT.i),
    d: num("dyn_idle_d_gain", DYN_IDLE_DEFAULT.d),
    maxIncrease: num("dyn_idle_max_increase", DYN_IDLE_DEFAULT.maxIncrease * 1000) / 1000,
    startIncrease: num("dyn_idle_start_increase", DYN_IDLE_DEFAULT.startIncrease * 1000) / 1000,
  };
}

// масштаб чисел BF — как в прошивке
const P_SCALE = 0.00015, I_SCALE = 0.01, D_SCALE = 0.000003, D_LPF_HZ = 30;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Регулятор, как copter/DynamicIdle.h: добавка к холостым, доля команды. */
export class DynIdleController {
  private integral = 0;
  private rateLpf = 0;
  private prevHz: number | null = null;

  update(s: DynIdle, slowestHz: number, airmode: boolean, dt: number): number {
    if (s.minRpm <= 0 || dt <= 0) return 0;
    const limit = airmode ? s.maxIncrease : s.startIncrease;
    const error = s.minRpm / 60 - slowestHz;
    const p = error * s.p * P_SCALE;
    this.integral = clamp(this.integral + error * s.i * I_SCALE * dt, 0, limit);
    const rate = this.prevHz === null ? 0 : (slowestHz - this.prevHz) / dt;
    this.rateLpf += (rate - this.rateLpf) * Math.min(1, dt * 2 * Math.PI * D_LPF_HZ);
    this.prevHz = slowestHz;
    return clamp(p + this.integral - this.rateLpf * s.d * D_SCALE, 0, limit);
  }
}

export interface CutTrace {
  t: number[];      // с
  off: number[];    // об/мин без dynamic idle
  on: number[];     // об/мин с ним
  inc: number[];    // добавка, доля
  cutS: number;     // когда сбросили газ
  washS: [number, number];   // коптер в собственном потоке
}

const IDLE = 0.055;   // dshot_idle_value по умолчанию — доля команды

/**
 * Сброс газа в полёте (иллюстрация, не расчёт по сборке): мотор отвечает
 * за постоянную времени 30 мс, обороты пропорциональны команде; на спуске
 * винт в собственном потоке тянет обороты вниз на четверть. Холостые —
 * idleRpm (по умолчанию 0,7 минимума, у выключенного — пример 3500).
 */
export function throttleCutTrace(s: DynIdle, idleRpm?: number): CutTrace {
  const minRpm = s.minRpm > 0 ? s.minRpm : 3500;
  const idle = idleRpm ?? minRpm * 0.7;
  const k = idle / IDLE;   // об/мин на долю команды
  const set = { ...s, minRpm };
  const dt = 0.001, tau = 0.03, end = 1.2, cutS = 0.2, washS: [number, number] = [0.35, 0.95];
  const out: CutTrace = { t: [], off: [], on: [], inc: [], cutS, washS };
  const ctl = new DynIdleController();
  let off = k * 0.15, on = off, inc = 0;
  for (let n = 0; n * dt <= end + 1e-9; n++) {
    const t = n * dt;
    const wash = t >= washS[0] && t <= washS[1] ? 0.75 : 1;
    const cmd = t < cutS ? 0.15 : IDLE;
    off += ((k * cmd * wash - off) * dt) / tau;
    inc = ctl.update(set, on / 60, true, dt);
    on += ((k * (t < cutS ? cmd : cmd + inc) * wash - on) * dt) / tau;
    if (n % 10 === 0) {
      out.t.push(t);
      out.off.push(off);
      out.on.push(on);
      out.inc.push(inc);
    }
  }
  return out;
}

export type DynIdleState = "off" | "needBidir" | "noRpm" | "ok" | "raising";

/** Что сейчас с dynamic idle: выключен, нет DShot, нет оборотов, держит, поднимает. */
export function dynIdleState(s: DynIdle, bidir: boolean, live?: { inc: number; rpm: number }): DynIdleState {
  if (s.minRpm <= 0) return "off";
  if (!bidir) return "needBidir";
  if (!live || live.rpm <= 0) return "noRpm";
  return live.inc > 0.0005 ? "raising" : "ok";
}
