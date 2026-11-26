// «Измерение и автонастройка» (168, 169): журнал с chirp → частотная
// характеристика коптера, модель, запасы контура «было → стало», ступенька и
// предложение PID. Расчёт — в воркере (core/tuneworker.ts); записывает пилот.

import { useEffect, useRef, useState } from "react";

import { decodeFlight, Flight } from "../../core/blackbox";
import type { WorkerReply } from "../../core/bbworker";
import { AxisReport, ChirpSeries, TuneProblem, TuneReport } from "../../core/chirptune";
import type { Margins } from "../../core/autotune";
import type { TuneReply, TuneRequest } from "../../core/tuneworker";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { Library } from "../blackbox/BlackBoxView";
import { useCopterLive } from "./common";

const AXIS_TITLES = [N_("Крен"), N_("Тангаж"), N_("Рысканье")];

const PROBLEMS: Record<TuneProblem, string> = {
  no_chirp: N_("В этом журнале нет chirp: включите режим CHIRP тумблером в полёте (blackbox_sample_rate — 1/1)."),
  axis_missing: N_("{axis}: свипа нет — тумблер CHIRP нужно включить ещё раз (оси идут по очереди)."),
  short_sweep: N_("{axis}: свип прерван и до верхних частот не дошёл — задержки не измерены, настройка не предлагается. Повторите свип по этой оси."),
  low_rate: N_("{axis}: журнал писался реже цикла (blackbox_sample_rate) — верхние частоты не видны."),
  bad_fit: N_("{axis}: измерение не сошлось с моделью — мало годных частот (ветер, упор моторов, малый размах). Настройка не предлагается."),
  no_proposal: N_("Настройку с запасами найти не удалось — коптер слишком шумит или запись плохая."),
};

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
      reject(new Error("worker"));
    };
    worker.postMessage(buffer, [buffer]);
  });
}

/** Колонки QCHIRP журнала — в простые массивы (в воркер и в расчёт). */
export function chirpSeries(flight: Flight): ChirpSeries | null {
  const q = flight.series.QCHIRP;
  if (!q || !q.count) return null;
  const c = q.cols;
  if (!c.excite || !c.command || !c.gyro || !c.gyrof) return null;
  return { t: q.t, excite: c.excite, command: c.command, gyro: c.gyro, gyrof: c.gyrof, hz: c.hz, axis: c.axis, run: c.run };
}

function runAnalysis(request: TuneRequest): Promise<TuneReport> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("../../core/tuneworker.ts", import.meta.url), { type: "module" });
    } catch {
      // без воркеров (тесты) — тут же
      void import("../../core/chirptune").then((m) => resolve(m.analyze(request.series, request.info)), reject);
      return;
    }
    worker.onmessage = (e: MessageEvent<TuneReply>) => {
      worker.terminate();
      if ("error" in e.data) reject(new Error(e.data.error));
      else resolve(e.data.report);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage(request);
  });
}

// ---------------- графики ----------------

export interface Line {
  points: [number, number][];
  cls: string;
}
interface Dot {
  x: number;
  y: number;
  /** 0…1 — насколько точке можно верить */
  trust: number;
}

const PW = 320,
  PH = 170;

export function Plot({ title, x, y, logX, xTicks, yTicks, lines, dots, unit, children }: { title: string; x: [number, number]; y: [number, number]; logX?: boolean; xTicks: number[]; yTicks: number[]; lines: Line[]; dots?: Dot[]; unit?: string; children?: (fx: (v: number) => number, fy: (v: number) => number) => React.ReactNode }) {
  const fx = (v: number) => (logX ? Math.log(Math.max(v, 1e-9) / x[0]) / Math.log(x[1] / x[0]) : (v - x[0]) / (x[1] - x[0])) * PW;
  const fy = (v: number) => PH - ((Math.min(y[1], Math.max(y[0], v)) - y[0]) / (y[1] - y[0])) * PH;
  const path = (pts: [number, number][]) =>
    pts
      .filter(([px]) => (logX ? px >= x[0] && px <= x[1] : true))
      .map(([px, py], i) => `${i ? "L" : "M"}${fx(px).toFixed(1)},${fy(py).toFixed(1)}`)
      .join("");
  return (
    <figure className="tune-plot">
      <figcaption>{title}</figcaption>
      <svg viewBox={`-34 -6 ${PW + 44} ${PH + 26}`} role="img" aria-label={title}>
        {yTicks.map((v) => (
          <g key={`y${v}`}>
            <line x1={0} x2={PW} y1={fy(v)} y2={fy(v)} className="filter-grid" />
            <text x={-5} y={fy(v) + 4} className="filter-label" textAnchor="end">
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((v) => (
          <g key={`x${v}`}>
            <line x1={fx(v)} x2={fx(v)} y1={0} y2={PH} className="filter-grid" />
            <text x={fx(v)} y={PH + 15} className="filter-label" textAnchor="middle">
              {v}
            </text>
          </g>
        ))}
        {unit && (
          <text x={PW - 3} y={11} className="filter-label" textAnchor="end">
            {unit}
          </text>
        )}
        {children?.(fx, fy)}
        {dots?.map((d, i) => (d.x >= x[0] && d.x <= x[1] ? <circle key={i} cx={fx(d.x)} cy={fy(d.y)} r={2.2} className="tune-dot" opacity={0.15 + 0.85 * d.trust} /> : null))}
        {lines.map((l, i) => (
          <path key={i} d={path(l.points)} className={`tune-line ${l.cls}`} />
        ))}
      </svg>
    </figure>
  );
}

const db = (re: number, im: number) => 20 * Math.log10(Math.max(1e-9, Math.hypot(re, im)));
const F_TICKS = [1, 3, 10, 30, 100, 300];

export function AxisCard({ a, loopHz }: { a: AxisReport; loopHz: number }) {
  const fMax = Math.min(500, a.sampleHz / 2);
  const good = a.bands.filter((b) => b.coherence >= 0.3);
  const modelLine: [number, number][] = a.hz.map((f, k) => [f, a.modelDb[k]]);
  const dbs = good.map((b) => b.db);
  const inView = a.modelDb.filter((_, k) => a.hz[k] >= 1 && a.hz[k] <= fMax);
  const top = Math.ceil((Math.max(...dbs, ...inView) + 5) / 20) * 20;
  const bottom = Math.min(top - 60, Math.floor(Math.min(...inView) / 20) * 20);
  const dbTicks: number[] = [];
  for (let v = bottom; v <= top; v += 20) dbTicks.push(v);
  const loopNow: [number, number][] = a.now.loopRe.map((re, k) => [a.hz[k], db(re, a.now.loopIm[k])]);
  const loopNext: [number, number][] = a.next ? a.next.loopRe.map((re, k) => [a.hz[k], db(re, a.next!.loopIm[k])]) : [];
  const nyq = (re: number[], im: number[]): [number, number][] => re.map((v, k): [number, number] => [v, im[k]]).filter(([x, y]) => x > -3 && x < 1 && y > -2.5 && y < 1.5);
  // ступенька по циклам -> миллисекунды
  const trace = (tr: number[]): [number, number][] => tr.map((v, k): [number, number] => [((k + 1) * 1000) / loopHz, v]);
  const stepTop = Math.min(3, Math.max(1.4, Math.ceil(Math.max(...a.now.trace, ...(a.next?.trace ?? []), 0) * 10.5) / 10));
  return (
    <div className="card wide" data-testid={`tune-axis-${a.axis}`}>
      <h3>{t(AXIS_TITLES[a.axis])}</h3>
      <p className="sub">
        {t("Коптер по измерению: ускорение {k} °/с² на 1 % команды, мотор отстаёт на {tau} мс, задержка {delay} мс.", {
          k: Math.round(a.plant.gain / 100),
          tau: (a.plant.tau * 1000).toFixed(0),
          delay: (a.plant.delay * 1000).toFixed(1),
        })}{" "}
        <span className="hint">
          {t("Свип {s} с до {hz} Гц, годных частот {n}, расхождение с моделью {e} %.", {
            s: a.seconds.toFixed(0),
            hz: Math.round(a.reachedHz),
            n: a.goodBands,
            e: (a.plant.error * 100).toFixed(0),
          })}
        </span>
      </p>
      <div className="tune-plots">
        <Plot
          title={t("Как коптер отвечает на команду, дБ")}
          x={[1, fMax]}
          y={[bottom, top]}
          logX
          xTicks={F_TICKS.filter((f) => f <= fMax)}
          yTicks={dbTicks}
          unit={t("Гц")}
          lines={[{ points: modelLine, cls: "model" }]}
          dots={good.map((b) => ({ x: b.hz, y: b.db, trust: b.coherence }))}
        />
        <Plot
          title={t("Контур: усиление, дБ (ноль — срез)")}
          x={[1, fMax]}
          y={[-40, 40]}
          logX
          xTicks={F_TICKS.filter((f) => f <= fMax)}
          yTicks={[-40, -20, 0, 20, 40]}
          unit={t("Гц")}
          lines={[
            { points: loopNow, cls: "now" },
            { points: loopNext, cls: "next" },
          ]}
          dots={good.filter((b) => b.coherence >= 0.6).map((b) => ({ x: b.hz, y: db(b.loopRe, b.loopIm), trust: b.coherence }))}
        />
        <Plot
          title={t("Найквист: контур должен обходить точку −1")}
          x={[-3, 1]}
          y={[-2.5, 1.5]}
          xTicks={[-3, -2, -1, 0, 1]}
          yTicks={[-2, -1, 0, 1]}
          lines={[
            { points: nyq(a.now.loopRe, a.now.loopIm), cls: "now" },
            { points: a.next ? nyq(a.next.loopRe, a.next.loopIm) : [], cls: "next" },
          ]}
        >
          {(fx, fy) => (
            <>
              {/* ближе 0.5 к точке −1 нельзя: чувствительность выше 6 дБ */}
              <ellipse cx={fx(-1)} cy={fy(0)} rx={fx(-0.5) - fx(-1)} ry={fy(0) - fy(0.5)} className="tune-keepout" />
              <circle cx={fx(-1)} cy={fy(0)} r={3} className="tune-minus-one" />
            </>
          )}
        </Plot>
        <Plot
          title={t("Ступенька стиком {dps} °/с: отклик, мс", { dps: Math.round(a.stepDps) })}
          x={[0, 200]}
          y={[0, stepTop]}
          xTicks={[0, 50, 100, 150, 200]}
          yTicks={stepTop > 1.6 ? [0, 0.5, 1, 1.5, 2].filter((v) => v <= stepTop) : [0, 0.5, 1]}
          unit={t("мс")}
          lines={[
            { points: trace(a.now.trace), cls: "now" },
            { points: a.next ? trace(a.next.trace) : [], cls: "next" },
          ]}
        />
      </div>
      {a.flown && (
        <p className="hint">
          {t("Запасы по самой записи, без модели: срез {hz} Гц, по фазе {pm}°, по усилению {gm} дБ, чувствительность до {ms} дБ.", {
            hz: a.flown.crossoverHz.toFixed(0),
            pm: a.flown.phaseMarginDeg.toFixed(0),
            gm: a.flown.gainMarginDb.toFixed(1),
            ms: a.flown.sensitivityDb.toFixed(1),
          })}
        </p>
      )}
    </div>
  );
}

const marginCell = (m: Margins, key: "crossoverHz" | "phaseMarginDeg" | "gainMarginDb" | "sensitivityDb") => (m.crossoverHz > 0 ? m[key].toFixed(key === "phaseMarginDeg" || key === "crossoverHz" ? 0 : 1) : "—");

export function Summary({ report, onApply, applied }: { report: TuneReport; onApply: (() => void) | null; applied: boolean }) {
  const rows: { title: string; hint?: string; cell: (a: AxisReport, side: "now" | "next") => string; bad?: (a: AxisReport) => boolean }[] = [
    { title: "P", cell: (a, s) => String(a[s]!.bf.p) },
    { title: "I", cell: (a, s) => String(a[s]!.bf.i) },
    { title: "D", cell: (a, s) => String(a[s]!.bf.d) },
    { title: "FF", cell: (a, s) => String(a[s]!.bf.f) },
    { title: N_("Срез контура, Гц"), hint: N_("до какой частоты контур давит возмущения: выше — жёстче держит"), cell: (a, s) => marginCell(a[s]!.margins, "crossoverHz") },
    { title: N_("Запас по фазе, °"), hint: N_("не меньше 45"), cell: (a, s) => marginCell(a[s]!.margins, "phaseMarginDeg") },
    { title: N_("Запас по усилению, дБ"), hint: N_("не меньше 6"), cell: (a, s) => marginCell(a[s]!.margins, "gainMarginDb") },
    { title: N_("Чувствительность, дБ"), hint: N_("не больше 6: возмущение нигде не усиливается больше чем вдвое"), cell: (a, s) => marginCell(a[s]!.margins, "sensitivityDb") },
    { title: N_("В ANGLE: фаза ° / усиление дБ"), cell: (a, s) => `${marginCell(a[s]!.angleMargins, "phaseMarginDeg")} / ${marginCell(a[s]!.angleMargins, "gainMarginDb")}` },
    { title: N_("Шум гироскопа на моторах, %"), hint: N_("СКЗ, доля хода: больше — горячее моторы"), cell: (a, s) => (a[s]!.noise * 100).toFixed(1) },
    { title: N_("Ступенька: до 90 %, мс"), cell: (a, s) => (a[s]!.step.stable ? (a[s]!.step.rise * 1000).toFixed(0) : "—") },
    { title: N_("Ступенька: перелёт, %"), cell: (a, s) => (a[s]!.step.stable ? (a[s]!.step.overshoot * 100).toFixed(0) : "—") },
  ];
  const axes = report.axes.filter((a): a is AxisReport => !!a);
  const clamped = axes.some((a) => a.next?.clamped);
  return (
    <div className="card wide" data-testid="tune-summary">
      <h3>{report.found ? t("Предложение: было → стало") : t("Измерение")}</h3>
      {report.problems.map((p, i) => (
        <p key={i} className="issue warning">
          {t(PROBLEMS[p.kind], { axis: p.axis !== undefined ? t(AXIS_TITLES[p.axis]) : "" })}
        </p>
      ))}
      {axes.length > 0 && (
        <table className="table axis-table tune-table">
          <thead>
            <tr>
              <th />
              {axes.map((a) => (
                <th key={a.axis}>{t(AXIS_TITLES[a.axis])}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.title}>
                <td title={r.hint ? t(r.hint) : undefined}>{t(r.title)}</td>
                {axes.map((a) => (
                  <td key={a.axis} className="mono">
                    {r.cell(a, "now")}
                    {a.next && (
                      <>
                        {" → "}
                        <b>{r.cell(a, "next")}</b>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td>{t("ФНЧ D, Гц")}</td>
              <td className="mono" colSpan={axes.length}>
                {Math.round(report.dtermLpfHz.now)}
                {report.found && (
                  <>
                    {" → "}
                    <b>{report.dtermLpfHz.next}</b>
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {clamped && <p className="issue warning">{t("Часть чисел упёрлась в границу настройки (P, I, D — до 250, FF — до 1000): графики «стало» посчитаны для того, что запишется.")}</p>}
      {report.found && (
        <>
          <p className="hint">
            {t("Запасы посчитаны по измеренной модели коптера: 45° и 6 дБ — он может стать вдвое «резче» (батарея, винты) и не раскачается. Фильтры гироскопа, расходы и горизонт не меняются. Проверьте в воздухе: повторите свип на новой настройке — строка «по самой записи» покажет запасы, как она летает.")}
          </p>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <button className="btn primary" disabled={!onApply || applied} onClick={onApply ?? undefined} data-testid="tune-apply">
              {applied ? t("Записано в плату — осталось «Сохранить»") : t("Применить на плате")}
            </button>
            {!onApply && <span className="hint">{t("Плата не подключена — команды ниже можно вставить в CLI.")}</span>}
          </div>
          <details className="tune-cli">
            <summary>{t("Команды CLI")}</summary>
            <pre className="mono">{report.commands.join("\n")}</pre>
          </details>
        </>
      )}
    </div>
  );
}

const CHIRP_END: Record<string, string> = {
  DONE: N_("прошёл целиком"),
  SWITCH: N_("выключен тумблером"),
  MODE: N_("прерван: режим не ANGLE/ACRO"),
  TILT: N_("прерван: большой наклон"),
  SATURATED: N_("прерван: моторы упёрлись"),
  NOT_FLYING: N_("прерван: посадка"),
};

function LiveChirp() {
  const live = useCopterLive();
  const c = live?.chirp;
  if (!c) return null;
  return (
    <p className="issue ok" data-testid="tune-live">
      {c.on
        ? t("Идёт свип: {axis}, {hz} Гц", { axis: t(AXIS_TITLES[c.axis] ?? AXIS_TITLES[0]), hz: c.hz.toFixed(0) })
        : t("Свипов с включения: {n}; последний {end}; следующая ось — {axis}", { n: c.run, end: t(CHIRP_END[c.end] ?? c.end), axis: t(AXIS_TITLES[c.axis] ?? AXIS_TITLES[0]) })}
    </p>
  );
}

export function AutotuneTab() {
  const [report, setReport] = useState<TuneReport | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const linkOpen = useApp((s) => s.link.state === "open");
  const hasBoard = useApp((s) => !!s.copterBoard.params.p_roll);
  const copterSet = useApp((s) => s.copterSet);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const open = async (buffer: ArrayBuffer, name: string) => {
    setBusy(true);
    setError(null);
    setReport(null);
    setApplied(false);
    setLabel(name);
    try {
      const flight = await decode(buffer);
      const r = await runAnalysis({ series: chirpSeries(flight), info: flight.info });
      if (alive.current) setReport(r);
    } catch (e) {
      if (alive.current) setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const apply = async () => {
    if (!report) return;
    for (const line of report.commands) {
      const m = /^set (\S+) = (\S+)$/.exec(line);
      if (m) await copterSet(m[1], Number(m[2]));
    }
    setApplied(true);
  };

  return (
    <div className="copter-grid">
      <div className="card wide">
        <h3>{t("Измерить коптер в полёте")}</h3>
        <ol className="tune-steps">
          <li>{t("Поставьте режим CHIRP на тумблер («Режимы»). Чёрный ящик — каждый цикл (blackbox_sample_rate 1/1).")}</li>
          <li>{t("Взлетите, повисите в ANGLE на 5–10 м и включите тумблер: 20 секунд коптер мелко дрожит по крену — всё чаще. Выключите и включите ещё раз — тангаж, ещё раз — рысканье. Стики работают как обычно.")}</li>
          <li>{t("Сядьте, откройте журнал здесь — Studio посчитает, как коптер отвечает на каждой частоте, и предложит PID с запасами. Записывать или нет — решаете вы.")}</li>
        </ol>
        <p className="hint">{t("Свип начинается только в воздухе, при наклоне меньше 25°; тумблер, включённый до ARM, не считается. Прерывают его тумблер, смена режима, наклон больше 45° и упор моторов.")}</p>
        <LiveChirp />
      </div>
      {busy && (
        <div className="card wide">
          <p className="muted">{t("Считаю: спектры, модель, настройка…")}</p>
        </div>
      )}
      {error && (
        <div className="card wide">
          <p className="issue error">{t("Не получилось разобрать журнал: {error}", { error })}</p>
        </div>
      )}
      {report && (
        <>
          <div className="card wide">
            <div className="row" style={{ gap: 10 }}>
              <span className="grow">
                {t("Журнал")}: <b>{label}</b>
              </span>
              <button className="btn" onClick={() => setReport(null)}>
                {t("Другой журнал")}
              </button>
            </div>
          </div>
          <Summary report={report} onApply={linkOpen && hasBoard ? () => void apply() : null} applied={applied} />
          {report.axes.map((a) => (a ? <AxisCard key={a.axis} a={a} loopHz={report.loopHz} /> : null))}
        </>
      )}
      {!report && !busy && (
        <div className="card wide">
          <h3>{t("Журнал с chirp")}</h3>
          <Library onOpen={open} />
        </div>
      )}
    </div>
  );
}
