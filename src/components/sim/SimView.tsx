// Вкладка «Симулятор»: наша прошивка коптера, собранная для ПК (SITL), летает
// в 3D прямо в приложении. Связь с ней — как с платой (порт tcp:), поэтому
// консоль, настройки коптера и живые кадры работают как на железе. Пульт —
// настоящий (TX12 и др. в режиме USB-джойстика), геймпад или клавиатура.
import { Gamepad2, Keyboard, Play, Radio, RotateCcw, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, errorText, isSimPort, onSimFrame, onTaskLog, SimFrame } from "../../api";
import {
  defaultRadioMap,
  gamepadChannels,
  gamepadToggles,
  InputKind,
  keyboardChannels,
  keyboardStep,
  keyboardToggle,
  KeyState,
  modeOf,
  neutral,
  padKind,
  pressedEdges,
  RadioMap,
  radioChannels,
  rcCommand,
  SIM_CHANNELS,
  speeds,
  Toggles,
} from "../../core/sim";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { Seg } from "../ui";
import { FrameRef, SimCamera, SimScene } from "./SimScene";
import "../../sim.css";

const MAP_KEY = "openplane.sim.radioMap";
const CHANNEL_NAMES = [N_("Крен"), N_("Тангаж"), N_("Газ"), N_("Рысканье"), "ARM", "SwB", N_("Режим"), "SwD", "VrA", "VrB"];

function loadMap(): RadioMap {
  try {
    const raw = localStorage.getItem(MAP_KEY);
    const m = raw ? (JSON.parse(raw) as RadioMap) : null;
    if (Array.isArray(m) && m.length === SIM_CHANNELS) return m;
  } catch {
    /* нет хранилища — по умолчанию */
  }
  return defaultRadioMap();
}

function saveMap(m: RadioMap) {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(m));
  } catch {
    /* не сохранится — не беда */
  }
}

function firstPad(): Gamepad | null {
  const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected) return p;
  return null;
}

interface Hud {
  frame: SimFrame | null;
  ch: number[];
  flightS: number;
}

export function SimView() {
  const settings = useApp((s) => s.settings);
  const link = useApp((s) => s.link);
  const clive = useApp((s) => s.clive);
  const connect = useApp((s) => s.connect);
  const disconnect = useApp((s) => s.disconnect);
  const setSection = useApp((s) => s.setSection);
  const toast = useApp((s) => s.toast);
  const dir = settings.firmwareSource ?? "";

  const [built, setBuilt] = useState<boolean | null>(null);
  const [building, setBuilding] = useState(false);
  const [starting, setStarting] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState<SimCamera>("chase");
  const [inputChoice, setInputChoice] = useState<InputKind | "auto">("auto");
  const [padName, setPadName] = useState<string | null>(null);
  const [radioMap, setRadioMap] = useState<RadioMap>(loadMap);
  const [mapOpen, setMapOpen] = useState(false);
  const [wind, setWind] = useState("0");
  const [hud, setHud] = useState<Hud>({ frame: null, ch: neutral(), flightS: 0 });

  const running = isSimPort(link.port) && link.state === "open";
  const frameRef = useRef<FrameRef>({ frame: null, at: 0, resets: 0 });
  const chRef = useRef<number[]>(neutral());
  const padAxes = useRef<number[]>([]);
  const keys = useRef(new Set<string>());
  // клавиатура — ALTHOLD: газ 50 % держит высоту (в ANGLE клавишами 5" улетает на сотни метров)
  const keyState = useRef<KeyState>({ throttle: 0, toggles: { arm: false, mode: "ALTHOLD" } });
  const padToggles = useRef<Toggles>({ arm: false, mode: "ALTHOLD" });
  const padButtons = useRef<boolean[]>([]);
  const flight = useRef({ s: 0, last: 0 });

  const refreshStatus = useCallback(async () => {
    if (!dir) return setBuilt(null);
    try {
      const st = await api.sitlStatus(dir);
      setBuilt(!!st.exe);
    } catch {
      setBuilt(null);
    }
  }, [dir]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // кадры модели — мимо стора (30 Гц), HUD — 10 раз в секунду
  useEffect(() => {
    let off: (() => void) | undefined;
    void onSimFrame((f) => {
      frameRef.current.frame = f;
      frameRef.current.at = performance.now();
    }).then((u) => (off = u));
    const hudTimer = setInterval(() => {
      const f = frameRef.current.frame;
      const now = performance.now();
      if (f?.arm && !f.gnd && flight.current.last) flight.current.s += (now - flight.current.last) / 1000;
      flight.current.last = now;
      setHud({ frame: f, ch: chRef.current.slice(), flightS: flight.current.s });
    }, 100);
    return () => {
      off?.();
      clearInterval(hudTimer);
    };
  }, []);

  useEffect(() => {
    let off: (() => void) | undefined;
    void onTaskLog((l) => l.task === "build" && setLog((prev) => [...prev.slice(-300), l.line])).then((u) => (off = u));
    return () => off?.();
  }, []);

  // клавиатура: пока открыта вкладка, кроме полей ввода
  useEffect(() => {
    const typing = () => {
      const el = document.activeElement;
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    };
    const down = (e: KeyboardEvent) => {
      if (typing() || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === "KeyC" && !e.repeat) {
        setCamera((c) => (c === "chase" ? "fpv" : c === "fpv" ? "ground" : "chase"));
        return;
      }
      if (e.code === "KeyR" && !e.repeat) {
        void api.linkCommand("sim reset").catch(() => {});
        frameRef.current.resets++;
        return;
      }
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
      if (!e.repeat) keyState.current = keyboardToggle(keyState.current, e.code);
      keys.current.add(e.code);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // пульт 50 Гц: что выбрано (или что подключено), — в симулятор
  const inputRef = useRef<{ choice: InputKind | "auto"; map: RadioMap }>({ choice: inputChoice, map: radioMap });
  inputRef.current = { choice: inputChoice, map: radioMap };
  const [activeInput, setActiveInput] = useState<InputKind>("keyboard");
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    let lastKind: InputKind | null = null;
    let lastPad: string | null = null;
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const pad = firstPad();
      const { choice, map } = inputRef.current;
      const kind: InputKind = choice !== "auto" ? choice : pad ? padKind(pad) : "keyboard";
      let ch: number[];
      if ((kind === "radio" || kind === "gamepad") && pad) {
        padAxes.current = Array.from(pad.axes);
        if (kind === "radio") ch = radioChannels(pad, map);
        else {
          const pressed = pad.buttons.map((b) => b.pressed);
          padToggles.current = gamepadToggles(padToggles.current, pressedEdges(pressed, padButtons.current));
          padButtons.current = pressed;
          ch = gamepadChannels(pad, padToggles.current);
        }
      } else {
        keyState.current = keyboardStep(keyState.current, keys.current, dt);
        ch = keyboardChannels(keyState.current, keys.current);
      }
      chRef.current = ch;
      if (kind !== lastKind) setActiveInput((lastKind = kind));
      const name = pad?.id ?? null;
      if (name !== lastPad) setPadName((lastPad = name));
      void api.linkCommand(rcCommand(ch)).catch(() => {});
    }, 20);
    return () => clearInterval(timer);
  }, [running]);

  async function build() {
    if (!dir) return;
    setBuilding(true);
    setError(null);
    setLog([]);
    try {
      const ok = await api.sitlBuild(dir);
      if (!ok) setError(t("Сборка не удалась — смотрите вывод ниже"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBuilding(false);
      void refreshStatus();
    }
  }

  async function start() {
    if (!dir) return;
    setStarting(true);
    setError(null);
    try {
      const port = await api.sitlStart(dir);
      await connect(port, true);
      frameRef.current.resets++;
      flight.current.s = 0;
    } catch (e) {
      const text = errorText(e);
      if (text.startsWith("SITL_NOT_BUILT")) setBuilt(false);
      else setError(text);
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    await api.sitlStop().catch(() => {});
    await disconnect(true);
    frameRef.current.frame = null;
  }

  async function resetSettings() {
    await api.sitlReset().catch((e) => toast("err", errorText(e)));
    await disconnect(true);
    frameRef.current.frame = null;
    toast("info", t("Настройки симулятора стёрты — как новая плата"));
  }

  function setWindSpeed(v: string) {
    setWind(v);
    const w = Number(v);
    void api.linkCommand(`sim wind 0 ${w} ${(w * 0.35).toFixed(1)}`).catch(() => {});
  }

  function backToStart() {
    void api.linkCommand("sim reset").catch(() => {});
    frameRef.current.resets++;
    flight.current.s = 0;
  }

  const f = hud.frame;
  const sp = f ? speeds(f.vel) : { ground: 0, climb: 0 };
  const alt = f ? -f.pos[2] : 0;
  const armSwitch = hud.ch[4] > 1500;
  const mode = clive?.mode ?? modeOf(hud.ch[6]);
  const hint = !f
    ? null
    : !f.rc
      ? t("Нет сигнала пульта")
      : f.arm
        ? null
        : armSwitch
          ? t("ARM не дан: газ вниз, затем снова ARM; причина — в консоли (s)")
          : activeInput === "keyboard"
            ? t("Пробел — ARM, W/S — газ, A/D — рысканье, стрелки — наклон, 1/2/3 — режим, C — камера, R — на старт")
            : activeInput === "gamepad"
              ? t("Газ вниз, A — ARM; X/Y/B — ANGLE/ALTHOLD/ACRO; C — камера, R — на старт")
              : t("Газ вниз и тумблер ARM (CH5); C — камера, R — на старт");

  const inputOptions = useMemo(
    () => [
      { value: "auto" as const, label: t("Авто") },
      { value: "radio" as const, label: t("Пульт") },
      { value: "gamepad" as const, label: t("Геймпад") },
      { value: "keyboard" as const, label: t("Клавиатура") },
    ],
    [],
  );

  if (!dir) {
    return (
      <div className="sim sim-empty">
        <div className="sim-card">
          <h2>{t("Симулятор")}</h2>
          <p>{t("Симулятор собирается из исходников прошивки. Укажите их в «Настройках».")}</p>
          <button className="btn primary" onClick={() => setSection("settings")}>
            {t("Открыть настройки")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="sim">
      <div className="sim-bar">
        <div className="sim-title">
          <Gamepad2 size={18} />
          <b>{t("Симулятор")}</b>
          <span className={`sim-dot ${running ? "on" : ""}`} />
          <span className="muted">{running ? t("прошивка летает на ПК") : t("остановлен")}</span>
        </div>
        {running ? (
          <>
            <Seg
              value={camera}
              onChange={setCamera}
              options={[
                { value: "chase", label: t("Сзади") },
                { value: "fpv", label: "FPV" },
                { value: "ground", label: t("С земли") },
              ]}
            />
            <Seg value={inputChoice} onChange={setInputChoice} options={inputOptions} />
            <label className="sim-wind" title={t("Ветер с запада, м/с, с порывами")}>
              {t("Ветер")}
              <select value={wind} onChange={(e) => setWindSpeed(e.target.value)}>
                {["0", "3", "6", "10"].map((v) => (
                  <option key={v} value={v}>
                    {v} {t("м/с")}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn small" onClick={backToStart} title={t("Коптер — на площадку (R)")}>
              <RotateCcw size={14} /> {t("На старт")}
            </button>
            <button className="btn small ghost" onClick={() => void stop()}>
              <Square size={14} /> {t("Остановить")}
            </button>
          </>
        ) : null}
      </div>

      <div className="sim-stage">
        {running ? (
          <>
            <SimScene frameRef={frameRef} camera={camera} />
            <div className="sim-hud">
              <div className="sim-hud-left">
                <span className={`sim-badge ${f?.arm ? "arm" : ""}`}>{f?.arm ? "ARMED" : "DISARMED"}</span>
                <span className="sim-badge mode">{mode}</span>
                <span className="sim-badge src">
                  {activeInput === "radio" ? <Radio size={13} /> : activeInput === "gamepad" ? <Gamepad2 size={13} /> : <Keyboard size={13} />}
                  {activeInput === "keyboard" ? t("Клавиатура") : padName ?? ""}
                </span>
              </div>
              <div className="sim-hud-right">
                <div>
                  <small>{t("Высота")}</small>
                  <b>{alt.toFixed(1)}</b> {t("м")}
                </div>
                <div>
                  <small>{t("Скорость")}</small>
                  <b>{(sp.ground * 3.6).toFixed(0)}</b> {t("км/ч")}
                </div>
                <div>
                  <small>{t("Вертикальная")}</small>
                  <b>{sp.climb.toFixed(1)}</b> {t("м/с")}
                </div>
                <div>
                  <small>{t("Газ")}</small>
                  <b>{Math.round((hud.ch[2] - 1000) / 10)}</b> %
                </div>
                <div>
                  <small>{t("Батарея")}</small>
                  <b>{f ? f.volts.toFixed(1) : "—"}</b> {t("В")} · {f ? f.amps.toFixed(0) : "—"} {t("А")}
                </div>
                <div>
                  <small>{t("Полёт")}</small>
                  <b>
                    {Math.floor(hud.flightS / 60)}:{String(Math.floor(hud.flightS % 60)).padStart(2, "0")}
                  </b>
                </div>
              </div>
              {camera === "fpv" && <div className="sim-cross" />}
              <div className="sim-sticks">
                <Stick x={hud.ch[3]} y={hud.ch[2]} />
                <Stick x={hud.ch[0]} y={hud.ch[1]} />
              </div>
              {hint && <div className="sim-hint">{hint}</div>}
            </div>
            {activeInput === "radio" && (
              <button className="btn small sim-map-btn" onClick={() => setMapOpen(!mapOpen)}>
                <Wrench size={14} /> {t("Каналы пульта")}
              </button>
            )}
            {mapOpen && activeInput === "radio" && (
              <RadioMapPanel
                map={radioMap}
                axes={padAxes.current}
                ch={hud.ch}
                onChange={(m) => {
                  setRadioMap(m);
                  saveMap(m);
                }}
                onClose={() => setMapOpen(false)}
              />
            )}
          </>
        ) : (
          <div className="sim-empty">
            <div className="sim-card">
              <h2>{t("Наша прошивка летает прямо здесь")}</h2>
              <p>
                {t(
                  "Прошивка коптера, собранная для компьютера: те же PID, фильтры, режимы и защиты, что на плате, а вместо датчиков — модель полёта. Настройки, консоль и живые данные работают как с настоящей платой.",
                )}
              </p>
              <p className="muted">
                {t("Управление: пульт по USB (режим джойстика), геймпад или клавиатура.")}
              </p>
              {error && <div className="sim-error">{error}</div>}
              <div className="sim-actions">
                {built ? (
                  <button className="btn primary" disabled={starting || building} onClick={() => void start()}>
                    <Play size={15} /> {starting ? t("Запускаю…") : t("Запустить симулятор")}
                  </button>
                ) : null}
                <button className={`btn ${built ? "ghost" : "primary"}`} disabled={building || starting} onClick={() => void build()}>
                  <Wrench size={15} /> {building ? t("Собираю…") : built ? t("Пересобрать") : t("Собрать симулятор")}
                </button>
                {built ? (
                  <button className="btn ghost" disabled={building || starting} onClick={() => void resetSettings()}>
                    {t("Стереть настройки симулятора")}
                  </button>
                ) : null}
              </div>
              {built === false && !building && (
                <p className="muted">{t("Сборка один раз, около минуты; нужен компилятор C++ для компьютера (MinGW).")}</p>
              )}
              {log.length > 0 && <pre className="sim-log">{log.slice(-14).join("\n")}</pre>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stick({ x, y }: { x: number; y: number }) {
  const px = ((x - 1000) / 1000) * 100;
  const py = 100 - ((y - 1000) / 1000) * 100;
  return (
    <div className="sim-stick">
      <span style={{ left: `${Math.min(100, Math.max(0, px))}%`, top: `${Math.min(100, Math.max(0, py))}%` }} />
    </div>
  );
}

function RadioMapPanel({
  map,
  axes,
  ch,
  onChange,
  onClose,
}: {
  map: RadioMap;
  axes: number[];
  ch: number[];
  onChange: (m: RadioMap) => void;
  onClose: () => void;
}) {
  const set = (i: number, patch: Partial<RadioMap[number]>) => onChange(map.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  return (
    <div className="sim-map">
      <div className="sim-map-head">
        <b>{t("Каналы пульта")}</b>
        <span className="muted">{t("Подвигайте стиком — полоска канала должна ехать в ту же сторону")}</span>
        <button className="btn small ghost" onClick={onClose}>
          {t("Готово")}
        </button>
      </div>
      {map.slice(0, 8).map((src, i) => (
        <div key={i} className="sim-map-row">
          <span className="sim-map-name">
            CH{i + 1} · {t(CHANNEL_NAMES[i])}
          </span>
          <select
            value={src.kind === "none" ? "none" : `${src.kind}:${src.index}`}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "none") set(i, { kind: "none" });
              else {
                const [kind, idx] = v.split(":");
                set(i, { kind: kind as "axis" | "button", index: Number(idx) });
              }
            }}
          >
            <option value="none">{t("нет")}</option>
            {Array.from({ length: Math.max(8, axes.length) }, (_, k) => (
              <option key={`a${k}`} value={`axis:${k}`}>
                {t("Ось")} {k + 1}
              </option>
            ))}
            {Array.from({ length: 16 }, (_, k) => (
              <option key={`b${k}`} value={`button:${k}`}>
                {t("Кнопка")} {k + 1}
              </option>
            ))}
          </select>
          <label className="sim-map-inv">
            <input type="checkbox" checked={src.invert} onChange={(e) => set(i, { invert: e.target.checked })} />
            {t("реверс")}
          </label>
          <div className="sim-map-bar">
            <span style={{ width: `${Math.min(100, Math.max(0, (ch[i] - 1000) / 10))}%` }} />
          </div>
          <span className="sim-map-us">{ch[i]}</span>
        </div>
      ))}
      <button className="btn small ghost" onClick={() => onChange(defaultRadioMap())}>
        {t("По умолчанию")}
      </button>
    </div>
  );
}
