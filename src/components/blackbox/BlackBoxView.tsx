// Раздел «Ящик»: журналы полётов с платы и с карты, разбор полёта —
// таймлайн с режимами и событиями, графики уставки и гироскопа, PID,
// моторов, газа и батареи с общим курсором, спектр шума, коптер в 3D в
// момент курсора, воспроизведение. Журнал — формат BlackBoxFormat.h
// (самолёт и коптер), разбор — core/blackbox.ts.

import {
  ChevronLeft,
  Cpu,
  Download,
  FileUp,
  FolderOpen,
  Gauge,
  HardDrive,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SkipBack,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, BoardFlights, errorText, inTauri, LogFile, onBlackboxProgress } from "../../api";
import { decodeFlight, extractFlight, Flight, looksLikeRing, RingFlight, ringFlights, valueAt } from "../../core/blackbox";
import { FLAG, names } from "../../core/bbanalysis";
import type { WorkerReply } from "../../core/bbworker";
import { locale, t } from "../../i18n";
import { useApp } from "../../store";
import { Attitude3D } from "./Attitude3D";
import { useBb } from "./bbstore";
import { formatTime } from "./draw";
import { COLORS, COPTER_DEFAULT, COPTER_PANELS, customPanel, MODE_COLORS, PanelDef, PLANE_DEFAULT, PLANE_PANELS } from "./panels";
import { SpectrumChart } from "./SpectrumChart";
import { TimeChart } from "./TimeChart";
import { EVENT_COLORS, Timeline, timelineHint } from "./Timeline";
import "../../blackbox.css";

// ---------------- разбор в фоне ----------------

function decode(buffer: ArrayBuffer): Promise<Flight> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../core/bbworker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(decodeFlight(new Uint8Array(buffer)));
      return;
    }
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      worker.terminate();
      if ("error" in e.data) reject(new Error(e.data.error));
      else resolve(e.data.flight);
    };
    worker.onerror = () => {
      worker.terminate();
      try {
        resolve(decodeFlight(new Uint8Array(buffer)));
      } catch (err) {
        reject(err);
      }
    };
    worker.postMessage(buffer, [buffer]);
  });
}

const fmtBytes = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} ${t("МБ")}` : `${Math.max(1, Math.round(b / 1024))} ${t("КБ")}`);
const fmtDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// ---------------- журналы: плата, папка, файл ----------------

function Library({ onOpen }: { onOpen: (buffer: ArrayBuffer, label: string, path?: string) => Promise<void> }) {
  const linkOpen = useApp((s) => s.link.state === "open");
  // папка журналов — проект того, что прошито в подключённой плате (коптер или самолёт)
  const project = useApp((s) => {
    const id = s.link.port ? s.ports[s.link.port]?.identity : null;
    if (id) return id.vehicle === "copter" ? s.copterId : s.currentId;
    return s.copterId ?? s.currentId;
  });
  const projectName = useApp((s) => s.copters.find((c) => c.id === project)?.name ?? s.planes.find((p) => p.id === project)?.name ?? "");
  const toast = useApp((s) => s.toast);
  const [board, setBoard] = useState<BoardFlights | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ flight: number; done: number; total: number } | null>(null);
  const [ring, setRing] = useState<{ name: string; bytes: Uint8Array; flights: RingFlight[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refreshFiles = useCallback(() => {
    if (!inTauri()) return;
    api.bbFiles(project).then(setFiles, () => setFiles([]));
  }, [project]);

  const refreshBoard = useCallback(() => {
    if (!linkOpen) return;
    setBusy("list");
    setBoardError(null);
    api
      .bbList()
      .then(setBoard, (e) => setBoardError(errorText(e)))
      .finally(() => setBusy(null));
  }, [linkOpen]);

  useEffect(refreshFiles, [refreshFiles]);
  useEffect(() => {
    if (linkOpen) refreshBoard();
    else setBoard(null);
  }, [linkOpen, refreshBoard]);
  useEffect(() => {
    let stop: (() => void) | undefined;
    if (inTauri()) void onBlackboxProgress(setProgress).then((u) => (stop = u));
    return () => stop?.();
  }, []);

  const download = async (n: number) => {
    setBusy(`get${n}`);
    setProgress(null);
    try {
      const path = await api.bbDownload(n, project);
      toast("ok", t("Полёт #{n} сохранён", { n }));
      refreshFiles();
      const data = await api.bbRead(path);
      await onOpen(data, t("Полёт #{n} с платы", { n }), path);
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const openSaved = async (f: LogFile) => {
    setBusy(f.path);
    try {
      await onOpen(await api.bbRead(f.path), f.name, f.path);
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const pickFile = async (file: File) => {
    setBusy("file");
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (looksLikeRing(bytes)) {
        const flights = ringFlights(bytes);
        if (!flights.length) throw new Error(t("В файле нет полётов"));
        setRing({ name: file.name, bytes, flights });
      } else {
        await onOpen(buffer, file.name);
      }
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bb-library">
      <div className="bb-lib-col">
        <div className="section-title">
          <Cpu size={14} /> {t("На плате")}
          {linkOpen && (
            <button className="btn ghost small" onClick={refreshBoard} disabled={!!busy} title={t("Обновить")}>
              <RefreshCw size={13} />
            </button>
          )}
        </div>
        {!linkOpen && <p className="hint">{t("Подключите плату по USB — здесь появятся полёты с её SD-карты.")}</p>}
        {boardError && <p className="hint err">{boardError}</p>}
        {board && (
          <>
            <p className="hint">
              {board.state.state === "off"
                ? t("Ящик выключен: нет карты или файла BLACKBOX.BIN (tools/blackbox.py sd-prepare)")
                : t("Свободно {free} из {total}", { free: fmtBytes((board.state.free_kb ?? 0) * 1024), total: fmtBytes((board.state.total_kb ?? 0) * 1024) })}
              {board.state.state === "recording" && <span className="badge warn"> {t("идёт запись")}</span>}
            </p>
            {!board.flights.length && board.state.state !== "off" && <p className="hint">{t("Полётов пока нет.")}</p>}
            <div className="bb-list">
              {[...board.flights].reverse().map((f) => (
                <div key={f.n} className="bb-item">
                  <HardDrive size={16} />
                  <div className="grow">
                    <b>#{f.n}</b> <span className="muted">· {fmtDuration(f.seconds)} · {fmtBytes(f.kb * 1024)}</span>
                    {busy === `get${f.n}` && progress && progress.flight === f.n && (
                      <div className="bb-progress">
                        <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
                      </div>
                    )}
                  </div>
                  <button className="btn small" disabled={!!busy} onClick={() => void download(f.n)}>
                    <Download size={13} /> {busy === `get${f.n}` ? t("Скачиваю…") : t("Скачать")}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="bb-lib-col">
        <div className="section-title">
          <FolderOpen size={14} /> {t("Сохранённые")}
          {projectName && <small>{projectName}</small>}
        </div>
        {!files.length && <p className="hint">{t("Скачанные полёты лежат в папке проекта в Ангаре (blackbox) и в Документы/OpenPlane/Blackbox.")}</p>}
        <div className="bb-list">
          {files.map((f) => (
            <button key={f.path} className="bb-item clickable" disabled={!!busy} onClick={() => void openSaved(f)}>
              <Gauge size={16} />
              <div className="grow left">
                <b>{f.name}</b>
                <div className="hint">
                  {new Date(f.modified).toLocaleString(locale())} · {fmtBytes(f.bytes)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="bb-lib-col">
        <div className="section-title">
          <FileUp size={14} /> {t("Файл")}
        </div>
        <p className="hint">{t("Журнал .bbl или BLACKBOX.BIN прямо с SD-карты — полёты в нём найдутся по заголовкам.")}</p>
        <button className="btn" disabled={!!busy} onClick={() => input.current?.click()}>
          <FileUp size={15} /> {busy === "file" ? t("Читаю…") : t("Открыть файл…")}
        </button>
        <input
          ref={input}
          type="file"
          accept=".bbl,.bin,.BIN"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void pickFile(f);
          }}
        />
        {ring && (
          <div className="bb-list">
            <p className="hint">{t("{name}: полётов {n}", { name: ring.name, n: ring.flights.length })}</p>
            {[...ring.flights].reverse().map((f, k) => (
              <button
                key={`${f.number}-${k}`}
                className="bb-item clickable"
                onClick={() => void onOpen(extractFlight(ring.bytes, f).buffer as ArrayBuffer, t("Полёт #{n} из {file}", { n: f.number, file: ring.name }))}
              >
                <HardDrive size={16} />
                <div className="grow left">
                  <b>#{f.number}</b> <span className="muted">· {fmtDuration((f.lastMs - f.startMs) / 1000)} · {fmtBytes(f.sectors.length * 4096)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- сводка, курсор, события ----------------

function SummaryChips({ flight }: { flight: Flight }) {
  const s = useBb((x) => x.summary);
  if (!s) return null;
  const maxRate = Math.max(0, ...s.axes.map((a) => a.maxRate));
  const chips: [string, string, string?][] = [
    [t("Запись"), fmtDuration(s.duration)],
    [t("В ARM"), fmtDuration(s.armedTime)],
  ];
  if (maxRate) chips.push([t("Вращение до"), `${maxRate.toFixed(0)} °/с`]);
  if (s.maxAltitude !== null) chips.push([t("Высота до"), `${s.maxAltitude.toFixed(1)} м`]);
  if (s.minVolts !== null) chips.push([t("Батарея от"), `${s.minVolts.toFixed(2)} В`]);
  if (s.maxAmps) chips.push([t("Ток до"), `${s.maxAmps.toFixed(1)} А`]);
  if (s.mah) chips.push([t("Израсходовано"), `${s.mah.toFixed(0)} ${t("мА·ч")}`]);
  if (s.gyroHz) chips.push([t("Гироскоп"), `${s.gyroHz.toFixed(0)} ${t("Гц")}`]);
  if (s.saturatedShare) chips.push([t("Упор моторов"), `${(s.saturatedShare * 100).toFixed(1)} %`, s.saturatedShare > 0.05 ? "warn" : undefined]);
  if (s.dropped) chips.push([t("Потеряно записей"), String(s.dropped), "warn"]);
  if (flight.badSectors || flight.tornRecords) chips.push([t("Битых секторов"), String(flight.badSectors + flight.tornRecords), "warn"]);
  return (
    <div className="bb-chips">
      {chips.map(([k, v, cls]) => (
        <div key={k} className={`bb-chip ${cls ?? ""}`}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
      <div className="bb-chip modes">
        {s.modes.map((m) => (
          <i key={m} style={{ background: MODE_COLORS[m] ?? "#79c0ff" }}>
            {m}
          </i>
        ))}
      </div>
    </div>
  );
}

function Readout({ flight }: { flight: Flight }) {
  const cursor = useBb((s) => s.cursor);
  const axis = useBb((s) => s.axis);
  const q = flight.series.QSTATE;
  const g = flight.series.QGYRO;
  const c = flight.series.QCTRL;
  const v = (s: typeof q, f: string) => valueAt(s, f, cursor);
  const modes = names(flight, "names.mode", ["ACRO", "HORIZON", "ANGLE", "ALT_HOLD"]);
  const states = names(flight, "names.state", ["DISARMED", "ARMED", "FAILSAFE"]);
  const flags = v(q, "flags") ?? 0;
  const mode = modes[v(q, "mode") ?? -1] ?? "—";
  const state = states[v(q, "state") ?? -1] ?? "—";
  const AX = ["roll", "pitch", "yaw"];
  const num = (x: number | null, d = 0) => (x === null ? "—" : (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d));
  const motors = [1, 2, 3, 4, 5, 6, 7, 8]
    .map((m) => valueAt(m <= 4 ? c : flight.series.QMOT8, `motor${m}`, cursor))
    .filter((x): x is number => x !== null)
    .slice(0, Number(flight.info.motors ?? 4) || 4);
  if (!q && !g) {
    return (
      <div className="bb-card">
        <div className="bb-card-head">
          <span>{formatTime(cursor, 0.001)} {t("с")}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="bb-card bb-readout">
      <div className="bb-card-head">
        <span className="mono">{formatTime(cursor, 0.001)} {t("с")}</span>
        <span className="grow" />
        <span className="bb-mode" style={{ background: flags & FLAG.armed ? MODE_COLORS[mode] ?? "#79c0ff" : "#2b3f56" }}>
          {flags & FLAG.armed ? mode : state}
        </span>
        {flags & FLAG.failsafe ? <span className="badge warn">FAILSAFE</span> : null}
        {flags & FLAG.rxLost ? <span className="badge err">{t("нет связи")}</span> : null}
      </div>
      <table>
        <tbody>
          <tr>
            <th />
            <th>{t("уставка")}</th>
            <th>{t("гироскоп")}</th>
            <th>{t("угол")}</th>
          </tr>
          {AX.map((a, k) => (
            <tr key={a} className={k === axis ? "on" : ""}>
              <td>{t(["Крен", "Тангаж", "Рысканье"][k])}</td>
              <td style={{ color: COLORS.setpoint }}>{num(v(g, `sp_${a}`))}</td>
              <td style={{ color: COLORS.gyro }}>{num(v(g, `gyrof_${a}`))}</td>
              <td>{num(v(q, k === 0 ? "roll" : k === 1 ? "pitch" : "yaw"), 1)}°</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bb-pid">
        {(["p", "i", "d", "f"] as const).map((term) => {
          const x = v(c, `${term}_${AX[axis]}`);
          return (
            <div key={term}>
              <span style={{ color: COLORS[term] }}>{term.toUpperCase()}</span>
              <b>{x === null ? "—" : (x * 100).toFixed(1)}</b>
            </div>
          );
        })}
      </div>
      <div className="bb-motors">
        {motors.map((m, k) => (
          <div key={k} title={`M${k + 1}`}>
            <i style={{ height: `${Math.min(100, m * 100)}%`, background: COLORS.motors[k] }} />
            <span>{(m * 100).toFixed(0)}</span>
          </div>
        ))}
      </div>
      <div className="bb-kv">
        <span>{t("газ")}</span>
        <b>{num((v(c, "thrust") ?? 0) * 100)} %</b>
        <span>{t("высота")}</span>
        <b>{num(v(q, "alt_m"), 1)} {t("м")}</b>
        <span>{t("набор")}</span>
        <b>{num(v(q, "climb_ms"), 1)} {t("м/с")}</b>
        <span>{t("батарея")}</span>
        <b>{num(v(q, "vbat_v"), 2)} {t("В")}</b>
        <span>{t("ток")}</span>
        <b>{num(v(q, "amps"), 1)} {t("А")}</b>
        <span>{t("обороты")}</span>
        <b>{num(v(q, "rot_hz"))} {t("Гц")}</b>
      </div>
    </div>
  );
}

function Events({ flight }: { flight: Flight }) {
  const cursor = useBb((s) => s.cursor);
  const jump = (te: number) => {
    const bb = useBb.getState();
    const half = (bb.t1 - bb.t0) / 2;
    if (te < bb.t0 || te > bb.t1) bb.setView(te - half, te + half);
    bb.setCursor(te);
  };
  const list = flight.events.filter((e) => e.kind !== "other" || e.text.length < 90);
  return (
    <div className="bb-card">
      <div className="bb-card-head">
        <span>{t("События")}</span>
        <span className="hint">{list.length}</span>
      </div>
      <div className="bb-events">
        {list.map((e, k) => (
          <button key={k} className={Math.abs(e.t - cursor) < 0.05 ? "on" : ""} onClick={() => jump(e.t)}>
            <i style={{ background: EVENT_COLORS[e.kind] }} />
            <span className="mono">{formatTime(e.t, 0.01)}</span>
            <span className="txt">{e.text}</span>
          </button>
        ))}
        {flight.end && (
          <button onClick={() => jump(flight.end!.t)}>
            <i style={{ background: EVENT_COLORS.record }} />
            <span className="mono">{formatTime(flight.end.t, 0.01)}</span>
            <span className="txt">{t("конец записи: {why}", { why: flight.end.text })}</span>
          </button>
        )}
      </div>
    </div>
  );
}

function TuneCard({ flight }: { flight: Flight }) {
  const [open, setOpen] = useState(false);
  const rows: [string, string][] = Object.entries(flight.info).filter(([k]) =>
    /^(build|frame|motors|loop_hz|tune\.source|pid\.|rates\.|filter\.|model\.|firmware|board|blackbox_mode|rate\.)/.test(k),
  );
  return (
    <div className="bb-card">
      <button className="bb-card-head clickable" onClick={() => setOpen(!open)}>
        <span>{t("Настройка в этом полёте")}</span>
        <span className="grow" />
        <span className="hint">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="bb-tune">
          {rows.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
          {flight.settings.length > 0 && <div className="bb-tune-sep">{t("Задано в CLI")}</div>}
          {flight.settings.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- графики и их выбор ----------------

function PanelPicker({ flight, all, shown }: { flight: Flight; all: PanelDef[]; shown: string[] }) {
  const togglePanel = useBb((s) => s.togglePanel);
  const toggle = (id: string) => togglePanel(flight.vehicle, id);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const fields = useMemo(() => {
    const out: string[] = [];
    for (const s of Object.values(flight.series)) for (const f of s.fields) out.push(`${s.name}.${f}`);
    return out;
  }, [flight]);
  const found = q.trim() ? fields.filter((f) => f.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30) : [];
  return (
    <div className="bb-picker">
      <button className="btn small" onClick={() => setOpen(!open)}>
        <Plus size={13} /> {t("Графики")}
      </button>
      {open && (
        <div className="bb-picker-pop" onPointerLeave={() => setOpen(false)}>
          {all.map((p) => (
            <label key={p.id}>
              <input type="checkbox" checked={shown.includes(p.id)} onChange={() => toggle(p.id)} />
              {t(p.title)}
            </label>
          ))}
          <input className="input" placeholder={t("Любой канал: gyro, motor, alt…")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {found.map((f) => (
            <label key={f}>
              <input type="checkbox" checked={shown.includes(`custom:${f}`)} onChange={() => toggle(`custom:${f}`)} />
              <span className="mono">{f}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Transport({ flight }: { flight: Flight }) {
  const playing = useBb((s) => s.playing);
  const speed = useBb((s) => s.speed);
  const cursor = useBb((s) => s.cursor);
  const bb = useBb.getState();
  return (
    <div className="bb-transport">
      <button className="btn small" onClick={() => bb.setCursor(Math.max(flight.start, bb.t0))} title={t("К началу окна")}>
        <SkipBack size={14} />
      </button>
      <button className="btn small primary" onClick={() => bb.setPlaying(!playing)} title={t("Пробел — пуск и пауза")}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <select className="select small" value={speed} onChange={(e) => bb.setSpeed(Number(e.target.value))}>
        {[0.1, 0.25, 0.5, 1, 2, 4].map((x) => (
          <option key={x} value={x}>
            {x}×
          </option>
        ))}
      </select>
      <span className="mono bb-time">{formatTime(cursor, 0.001)}</span>
      <span className="grow" />
      <span className="hint">{timelineHint()}</span>
      <button className="btn small ghost" onClick={() => bb.zoomAt(cursor, 1 / 1.6)} title={t("Ближе")}>
        <ZoomIn size={14} />
      </button>
      <button className="btn small ghost" onClick={() => bb.zoomAt(cursor, 1.6)} title={t("Дальше")}>
        <ZoomOut size={14} />
      </button>
      <button className="btn small ghost" onClick={() => bb.fit()} title={t("Весь полёт")}>
        <Maximize2 size={14} />
      </button>
    </div>
  );
}

// ---------------- страница ----------------

export function BlackBoxView() {
  const flight = useBb((s) => s.flight);
  const source = useBb((s) => s.source);
  const vehicle = useBb((s) => s.flight?.vehicle ?? "copter");
  const panelIds = useBb((s) => s.panels[vehicle]);
  const axis = useBb((s) => s.axis);
  const playing = useBb((s) => s.playing);
  const toast = useApp((s) => s.toast);
  const [loading, setLoading] = useState<string | null>(null);

  const onOpen = useCallback(
    async (buffer: ArrayBuffer, label: string, path?: string) => {
      setLoading(label);
      try {
        const f = await decode(buffer);
        if (!Object.keys(f.series).length) throw new Error(t("В журнале нет записей полёта"));
        useBb.getState().open(f, { label, path });
      } catch (e) {
        toast("err", t("Журнал не читается: {e}", { e: errorText(e) }));
      } finally {
        setLoading(null);
      }
    },
    [toast],
  );

  // воспроизведение: курсор идёт со скоростью speed, окно — за ним
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const bb = useBb.getState();
      const f = bb.flight;
      if (!f) return;
      const dt = ((now - last) / 1000) * bb.speed;
      last = now;
      const c = bb.cursor + dt;
      if (c >= f.stop) {
        bb.setCursor(f.stop);
        bb.setPlaying(false);
        return;
      }
      bb.setCursor(c);
      const span = bb.t1 - bb.t0;
      if (c > bb.t0 + span * 0.8 || c < bb.t0) bb.setView(c - span * 0.3, c + span * 0.7);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // клавиши: пробел — пуск/пауза, ← → — шаг, Home — весь полёт
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return;
      const bb = useBb.getState();
      if (!bb.flight) return;
      if (e.key === " ") {
        bb.setPlaying(!bb.playing);
        e.preventDefault();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const d = (e.shiftKey ? 0.1 : 0.005) * (e.key === "ArrowRight" ? 1 : -1);
        bb.setCursor(bb.cursor + d);
        e.preventDefault();
      } else if (e.key === "Home") {
        bb.fit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const all = useMemo(() => (flight ? (flight.vehicle === "copter" ? COPTER_PANELS(flight, axis) : PLANE_PANELS) : []), [flight, axis]);
  const shown = useMemo(() => {
    if (!flight) return [];
    const known = panelIds.filter((id) => all.some((p) => p.id === id) || id.startsWith("custom:"));
    return known.length ? known : flight.vehicle === "copter" ? COPTER_DEFAULT : PLANE_DEFAULT;
  }, [flight, panelIds, all]);
  const panels = useMemo(
    () => shown.map((id) => all.find((p) => p.id === id) ?? customPanel(id)).filter((p): p is PanelDef => !!p),
    [shown, all],
  );

  if (!flight) {
    return (
      <div className="page bb-page">
        <div className="page-head">
          <div>
            <h1>{t("Чёрный ящик")}</h1>
            <p>{t("Разбор полёта: что делал коптер, что просил пилот, как отвечали PID и моторы.")}</p>
          </div>
        </div>
        {loading && <div className="bb-loading">{t("Разбираю «{name}»…", { name: loading })}</div>}
        <Library onOpen={onOpen} />
      </div>
    );
  }

  return (
    <div className="bb-page bb-open">
      <div className="bb-top">
        <button className="btn small ghost" onClick={() => useBb.getState().close()} title={t("К журналам")}>
          <ChevronLeft size={15} /> {t("Журналы")}
        </button>
        <div className="bb-title">
          <b>{t("Полёт #{n}", { n: flight.number })}</b>
          <span className="muted">
            {source?.label}
            {flight.info.build ? ` · ${flight.info.build}` : ""}
            {flight.info.firmware ? ` · ${flight.info.firmware}` : ""}
          </span>
        </div>
        <span className="grow" />
        <PanelPicker flight={flight} all={all} shown={shown} />
      </div>
      <SummaryChips flight={flight} />
      <div className="bb-body">
        <div className="bb-main">
          <Timeline flight={flight} />
          <Transport flight={flight} />
          <div className="bb-charts">
            {panels.map((p) => (
              <TimeChart
                key={p.id}
                flight={flight}
                panel={p}
                onRemove={panels.length > 1 ? () => useBb.getState().togglePanel(vehicle, p.id) : undefined}
              />
            ))}
          </div>
        </div>
        <div className="bb-side">
          {flight.vehicle === "copter" && <Attitude3D flight={flight} />}
          <Readout flight={flight} />
          <SpectrumChart flight={flight} />
          <Events flight={flight} />
          <TuneCard flight={flight} />
        </div>
      </div>
    </div>
  );
}
