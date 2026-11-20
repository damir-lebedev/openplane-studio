// «Компас» на вкладке «Подготовка»: мастер калибровки. Коптер крутят во все
// стороны — сырое поле из живых кадров ложится точками на сферу (картинка
// вращается, пустые места видно сразу); по точкам считаются смещение,
// растяжение и то, как стоит датчик (core/magCal.ts), и пишутся на плату
// настройками mag_zero_*, mag_scale_*, align_mag.

import { useEffect, useRef, useState } from "react";
import { Compass } from "lucide-react";

import { ParamValue } from "../../core/copterParams";
import { addMagSample, AlignGuess, detectAlign, fitMag, MAG_MIN_COVERAGE, MAG_MIN_SAMPLES, magCommands, magCoverage, MagFit, MagSample, magVerdict, roughCenter, spherePoint } from "../../core/magCal";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { ParamInput, useCopterBoard, useCopterLink, useCopterLive } from "./common";

type Stage = "idle" | "collect" | "result";

export function CompassCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const { armed } = useCopterLink();
  const [stage, setStage] = useState<Stage>("idle");
  const samples = useRef<MagSample[]>([]);
  const [count, setCount] = useState(0);
  const [view, setView] = useState(30);
  const [result, setResult] = useState<{ fit: MagFit | null; align: AlignGuess | null } | null>(null);
  const [written, setWritten] = useState(false);

  // точки копятся с каждым кадром, пока идёт сбор
  const stamp = live?.t;
  useEffect(() => {
    if (stage !== "collect" || !live?.mag) return;
    const next = addMagSample(samples.current, { m: live.mag.raw, att: [live.att[0], live.att[1], live.att[2]] });
    if (next !== samples.current) {
      samples.current = next;
      setCount(next.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, stage]);

  // сфера медленно вращается: видно, где точек ещё нет
  useEffect(() => {
    if (stage === "idle") return;
    const id = setInterval(() => setView((v) => (v + 3) % 360), 100);
    return () => clearInterval(id);
  }, [stage]);

  // прошивка без компаса коптера (старая) — карточки нет
  if (!board.params.mag_zero_x) return null;

  const mag = live?.mag;
  const list = samples.current;
  const coverage = stage === "idle" ? 0 : magCoverage(list);
  const enough = list.length >= MAG_MIN_SAMPLES && coverage >= MAG_MIN_COVERAGE;

  const start = () => {
    samples.current = [];
    setCount(0);
    setResult(null);
    setWritten(false);
    setStage("collect");
  };
  const finish = () => {
    const fit = fitMag(samples.current);
    setResult({ fit, align: fit ? detectAlign(samples.current, fit) : null });
    setStage("result");
  };
  const write = () => {
    if (!result?.fit) return;
    const set = useApp.getState().copterSet;
    const cmds: [string, ParamValue][] = magCommands(result.fit, result.align?.sure ? result.align.align : undefined);
    for (const [name, v] of cmds) void set(name, v);
    setWritten(true);
  };

  const verdict = result?.fit ? magVerdict(result.fit) : null;
  const declination = board.params.mag_declination;
  const declAuto = board.params.mag_declination_auto;
  const autoOn = !!declAuto && String(declAuto.value) !== "OFF" && declAuto.value !== 0;

  return (
    <div className="card wide compass-card" data-testid="compass-card">
      <div className="row" style={{ gap: 10 }}>
        <Compass size={18} />
        <h3 className="grow" style={{ margin: 0 }}>
          {t("Компас")}
        </h3>
        <span className={`mono${mag && (!mag.cal || !mag.ok || mag.bad) ? " warn-text" : ""}`} data-testid="compass-state">
          {!live
            ? "—"
            : !mag
              ? t("не найден")
              : !mag.cal
                ? t("не откалиброван")
                : mag.bad
                  ? t("расходится с полётом")
                  : mag.ok
                    ? t("в порядке, курс {a}°", { a: Math.round(live.hdg) })
                    : t("полю нет веры: {f} мкТл", { f: mag.f.toFixed(0) })}
        </span>
      </div>
      <p className="sub">{t("Компас нужен удержанию позиции и возврату домой: по нему коптер знает, куда смотрит нос, ещё до того, как полетел. Калибровка — раз после сборки и после переделок рядом с модулем GPS.")}</p>

      {stage === "idle" && (
        <>
          {!mag && live && <p className="hint">{t("Модуль GPS с компасом (QMC5883) не отвечает — проверьте провода SDA/SCL. Без компаса позицию можно держать по курсу из полёта: pos_hold_without_mag на вкладке «Автопилот».")}</p>}
          {mag && (
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <button className="btn primary" disabled={armed} onClick={start}>
                {mag.cal ? t("Калибровать заново") : t("Калибровать")}
              </button>
              <span className="hint grow">{t("Понадобится полминуты: возьмите коптер в руки, подальше от стола, ноутбука и железа. Винты лучше снять.")}</span>
            </div>
          )}
        </>
      )}

      {stage !== "idle" && (
        <div className="compass-body">
          <Sphere samples={list} fit={result?.fit ?? null} view={view} />
          <div className="grow">
            {stage === "collect" && (
              <>
                <p>{t("Крутите коптер во все стороны: носом вниз и вверх, на правый и левый борт, вверх ногами — и поворачивайтесь с ним вокруг себя. Точки должны покрыть всю сферу.")}</p>
                <div className="compass-bar" title={t("Доля сферы, где уже есть точки")}>
                  <div className="compass-bar-fill" style={{ width: `${Math.round(coverage * 100)}%` }} />
                </div>
                <p className="hint" data-testid="compass-progress">
                  {t("Точек: {n}, сфера покрыта на {p} %", { n: count, p: Math.round(coverage * 100) })}
                  {enough ? ` — ${t("уже хватает, но чем полнее, тем точнее")}` : ""}
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn primary" disabled={!enough} onClick={finish}>
                    {t("Готово — посчитать")}
                  </button>
                  <button className="btn" onClick={() => setStage("idle")}>
                    {t("Отмена")}
                  </button>
                </div>
              </>
            )}
            {stage === "result" && (
              <>
                {!result?.fit && <p className="warn-text">{t("Посчитать не вышло: точки лежат в одной плоскости. Коптер нужно наклонять во все стороны, а не только крутить на столе.")}</p>}
                {result?.fit && verdict && (
                  <>
                    <p className={verdict.ok ? "" : "warn-text"} data-testid="compass-verdict">
                      {t(verdict.text)}
                    </p>
                    <div className="kv">
                      <span>{t("Поле")}</span>
                      <span className="mono">{t("{f} мкТл (у Земли — 25…65)", { f: result.fit.field.toFixed(0) })}</span>
                      <span>{t("Смещение")}</span>
                      <span className="mono">{result.fit.zero.map((v) => v.toFixed(1)).join(" · ")}</span>
                      <span>{t("Растяжение")}</span>
                      <span className="mono">{result.fit.scale.map((v) => v.toFixed(2)).join(" · ")}</span>
                      <span>{t("Разброс")}</span>
                      <span className="mono">{(result.fit.residual * 100).toFixed(1)} %</span>
                      <span>{t("Как стоит датчик")}</span>
                      <span className="mono" data-testid="compass-align">
                        {result.align?.sure ? result.align.align : t("не определилось — оставлю {a}", { a: String(board.params.align_mag?.value ?? "DEFAULT") })}
                      </span>
                    </div>
                    {result.align && !result.align.sure && <p className="hint">{t("Установку датчика (align_mag) видно по тому, как поле поворачивается вместе с коптером: наклонов было мало. Если курс после калибровки врёт на 90° или 180° — повторите, наклоняя сильнее.")}</p>}
                  </>
                )}
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button className="btn primary" disabled={armed || !result?.fit || !verdict?.ok || written} onClick={write}>
                    {written ? t("Записано") : t("Записать на плату")}
                  </button>
                  <button className="btn" onClick={start}>
                    {t("Заново")}
                  </button>
                  <button className="btn" onClick={() => setStage("idle")}>
                    {t("Закрыть")}
                  </button>
                </div>
                {written && <p className="hint">{t("Осталось нажать «Сохранить» внизу. Проверка: поверните коптер носом на север — курс должен стать около 0°, на восток — 90°.")}</p>}
              </>
            )}
          </div>
        </div>
      )}

      {declAuto && (
        <label className="training-param" data-param="mag_declination_auto" style={{ marginTop: 10 }}>
          <span className="grow">
            {t("Склонение по GPS")}
            <span className="hint"> — {t("коптер сам считает склонение по своим координатам (модель WMM-2025), вводить руками не нужно")}</span>
          </span>
          <ParamInput p={declAuto} width={90} />
          {mag?.decl !== undefined && (
            <span className="mono" data-testid="compass-decl">
              {mag.decl > 0 ? "+" : ""}
              {mag.decl.toFixed(1)}° {mag.dgps ? t("по GPS") : t("вручную")}
            </span>
          )}
        </label>
      )}
      {declination && (
        <label className="training-param" data-param="mag_declination" style={{ marginTop: 10 }}>
          <span className="grow">
            {t("Магнитное склонение")}
            <span className="hint">
              {" "}
              — {autoOn ? t("берётся, пока у коптера нет GPS (или GPS нет вовсе)") : t("на сколько магнитный север восточнее истинного в ваших местах (в Москве около +12°, это 120)")}
            </span>
          </span>
          <ParamInput p={declination} width={90} />
          <span className="hint">{t(declination.units ?? "")}</span>
        </label>
      )}
    </div>
  );
}

/** Сфера точек: вид вращается, дальние точки бледнее; после расчёта — уже откалиброванные. */
function Sphere({ samples, fit, view }: { samples: MagSample[]; fit: MagFit | null; view: number }) {
  const R = 88;
  const c = 110;
  const center = fit ? fit.zero : roughCenter(samples);
  let radius = fit ? fit.field : 0;
  if (!fit) for (const s of samples) radius = Math.max(radius, Math.hypot(s.m[0] - center[0], s.m[1] - center[1], s.m[2] - center[2]));
  // на экране — не больше 500 точек: берём равномерно
  const step = Math.max(1, Math.ceil(samples.length / 500));
  const dots = [];
  for (let i = 0; i < samples.length; i += step) {
    const m = samples[i].m;
    const scaled: [number, number, number] = fit ? [center[0] + (m[0] - center[0]) * fit.scale[0], center[1] + (m[1] - center[1]) * fit.scale[1], center[2] + (m[2] - center[2]) * fit.scale[2]] : m;
    const p = spherePoint(scaled, center, radius, view);
    dots.push(<circle key={i} cx={c + p.x * R} cy={c + p.y * R} r={p.depth > 0 ? 2.4 : 1.7} className="mag-dot" opacity={0.35 + 0.6 * Math.max(0, Math.min(1, (p.depth + 1) / 2))} />);
  }
  return (
    <svg viewBox="0 0 220 220" className="mag-sphere" role="img" aria-label={t("Точки поля на сфере")} data-testid="mag-sphere">
      <circle cx={c} cy={c} r={R} className="mag-globe" />
      <ellipse cx={c} cy={c} rx={R} ry={R * 0.34} className="mag-wire" />
      <ellipse cx={c} cy={c} rx={R * Math.abs(Math.cos((view * Math.PI) / 180))} ry={R} className="mag-wire" />
      {dots}
      {!samples.length && (
        <text x={c} y={c + 4} textAnchor="middle" className="rescue-label">
          {t("точек пока нет")}
        </text>
      )}
    </svg>
  );
}
