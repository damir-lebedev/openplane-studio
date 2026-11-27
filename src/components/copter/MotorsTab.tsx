// «Моторы»: схема рамы (номера как в Betaflight, куда крутится каждый),
// проверка моторов ползунками — только с подтверждением «пропеллеры сняты»;
// команда повторяется каждые 0,4 с, плата держит её 1 с: приложение
// закрылось или связь пропала — моторы встали сами. У регуляторов DShot —
// направление мотора и «пискнуть» командой (dshot N 7|8 12, как мастер
// направления конфигуратора BF): мотор выбирается кликом по схеме. Мастер
// направления (096): все крутятся тихо, щелчок по мотору разворачивает его.
// Порядок выходов (076, motor_output_reordering): два щелчка по схеме —
// моторы меняются выходами платы.

import { TriangleAlert, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FrameMotor, tabParams } from "../../core/copterParams";
import { cancelSteps, Dir, flipSteps, runSteps, saveSteps, startSteps, Step, wizardPct } from "../../core/motorDirection";
import { ESC_HOT_C, escRows, escTotalAmps } from "../../core/escTelemetry";
import { DYN_IDLE_PARAMS, dynIdleFrom, DynIdleState, dynIdleState, throttleCutTrace } from "../../core/dynIdle";
import { EZ_DEFAULT, MIX_CASES, MIXER_TYPES, MixerType, mixQuadX } from "../../core/mixerType";
import { parseMotorOrder, swapOutputs } from "../../core/motorOrder";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamList, ParamRow, useCopterBoard, useCopterLink, useCopterLive } from "./common";

const RESEND_MS = 400;

export function MotorsTab() {
  return (
    <NeedBoard>
      <MotorsBody />
    </NeedBoard>
  );
}

/** simple — без списка настроек регуляторов (мастер «Новичка»). */
export function MotorsBody({ simple = false }: { simple?: boolean }) {
  const board = useCopterBoard();
  const live = useCopterLive();
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const motors = board.header?.frame?.motors ?? [];
  const max = board.header?.motorTestMax ?? 30;
  const [propsOff, setPropsOff] = useState(false);
  const [values, setValues] = useState<number[]>(() => motors.map(() => 0));
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Пока хоть один ползунок не на нуле — повторять команду (плата держит её 1 с).
  const spinning = values.some((v) => v > 0);
  useEffect(() => {
    if (!spinning || !propsOff || armed) return;
    const send = () => valuesRef.current.forEach((v, i) => void cmd(`motor ${i} ${v}`));
    send();
    const id = setInterval(send, RESEND_MS);
    return () => clearInterval(id);
  }, [spinning, propsOff, armed, cmd]);

  // Ушли со вкладки — стоп.
  useEffect(() => () => void useApp.getState().copterCommand("motor stop").catch(() => {}), []);

  const stopAll = () => {
    setValues(motors.map(() => 0));
    void cmd("motor stop");
  };
  const setOne = (i: number, v: number) => setValues((vs) => vs.map((x, k) => (k === i ? v : x)));
  const setAll = (v: number) => setValues(motors.map(() => v));
  const propsOut = board.params.props_out;
  const [picked, setPicked] = useState(0);
  const dshot = !!board.header?.dshotCommands;

  // мастер направления: null — не идёт; dirs — что сейчас у каждого регулятора
  const [wiz, setWiz] = useState<Dir[] | null>(null);
  const [wizBusy, setWizBusy] = useState(false);
  const pct = wizardPct(max);
  const run = async (steps: Step[]) => {
    setWizBusy(true);
    try {
      await runSteps(steps, { send: (l) => cmd(l), spin: (on) => setValues(motors.map(() => (on ? pct : 0))) });
    } finally {
      setWizBusy(false);
    }
  };
  const wizard = {
    dirs: wiz,
    busy: wizBusy,
    start: () => {
      setWiz(motors.map(() => "normal"));
      void run(startSteps());
    },
    flip: (i: number) => {
      if (!wiz || wizBusy) return;
      const f = flipSteps(i, wiz);
      setWiz(f.dirs);
      setPicked(i);
      void run(f.steps);
    },
    save: () => {
      setWiz(null);
      void run(saveSteps());
    },
    cancel: () => {
      setWiz(null);
      void run(cancelSteps());
    },
  };
  // сняли галочку «пропеллеры сняты» или заармили — мастер закончился
  useEffect(() => {
    if ((!propsOff || armed) && wiz) setWiz(null);
  }, [propsOff, armed, wiz]);

  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Рама")}</h3>
        <FrameDiagram motors={motors} out={live?.motors} reversed={!!live?.turtle} selected={dshot ? picked : undefined} onPick={dshot ? (wiz ? wizard.flip : setPicked) : undefined} />
        <p className="hint">
          {t("Вид сверху, нос — вверх. Номера — выходы M1–M{n} платы, как в Betaflight. Стрелка — куда должен крутиться мотор.", { n: motors.length })}
        </p>
        {propsOut && <ParamRow p={propsOut} title={t("Пропеллеры наружу (props out)")} />}
      </div>

      <div className="card">
        <h3>{t("Проверка моторов")}</h3>
        <label className={`props-off${propsOff ? " on" : ""}`}>
          <input type="checkbox" checked={propsOff} disabled={armed} onChange={(e) => (e.target.checked ? setPropsOff(true) : (setPropsOff(false), stopAll()))} />
          <TriangleAlert size={18} color="var(--warn)" />
          <span>{t("Я снял пропеллеры. Батарея подключена, коптер закреплён.")}</span>
        </label>
        <p className="hint">{t("Без батареи регуляторы не запустятся — от USB моторы не крутятся. Каждый мотор по очереди: номер на схеме и направление должны совпасть. Не тот мотор — порядок выходов; не туда крутится — направление в регуляторах (BLHeli/Bluejay), провода не трогайте.")}</p>
        <div className="motor-sliders">
          {motors.map((_, i) => (
            <div key={i} className="motor-slider">
              <span className="mono">M{i + 1}</span>
              <input type="range" min={0} max={max} step={1} disabled={!propsOff || armed} value={values[i] ?? 0} onChange={(e) => setOne(i, Number(e.target.value))} />
              <span className="mono hint">{values[i] ?? 0}%</span>
              <span className="mono hint" title={t("команда на выходе")}>
                {live ? `${Math.round(live.motors[i] * 100)}%` : ""}
              </span>
            </div>
          ))}
          <div className="motor-slider master">
            <span>{t("Все")}</span>
            <input type="range" min={0} max={max} step={1} disabled={!propsOff || armed} value={Math.max(...values, 0)} onChange={(e) => setAll(Number(e.target.value))} />
            <span className="mono hint">{Math.max(...values, 0)}%</span>
            <span />
          </div>
        </div>
        <button className="btn primary" style={{ marginTop: 10 }} disabled={!spinning} onClick={stopAll}>
          {t("Стоп")}
        </button>
        <p className="hint">{t("Не больше {max} % тяги. Плата держит команду 1 с: закрыли приложение или вынули кабель — моторы встанут сами.", { max })}</p>
      </div>

      <OutputOrderCard motors={motors} />

      {dshot && <DirectionCard motors={motors} picked={picked} busy={armed || spinning} wizard={wizard} canWizard={propsOff && !armed} pct={pct} />}

      {dshot && <EscCard />}

      {!simple && <MixerCard />}

      {!simple && <DynIdleCard dshot={dshot} />}

      {!simple && (
        <div className="wide">
          <ParamList title={t("Моторы и регуляторы")} params={tabParams(board, "motors").filter((p) => !mixerCardParams(board.params).includes(p.name))} />
        </div>
      )}
    </div>
  );
}

const EZ_PARAMS = ["ez_landing_threshold", "ez_landing_limit", "ez_landing_speed"];

/** Настройки, которые показывает карточка смесителя (в общем списке их нет). */
function mixerCardParams(params: Record<string, { value: unknown } | undefined>): string[] {
  if (!params.mixer_type) return [];
  const mixer = params.mixer_type.value === "EZLANDING" ? ["mixer_type", ...EZ_PARAMS] : ["mixer_type"];
  return params.dyn_idle_min_rpm ? [...mixer, ...DYN_IDLE_PARAMS] : mixer;
}

const MIXER_TEXT: Record<MixerType, string> = {
  LEGACY: N_("Урезает команды: крен и тангаж целы, рысканье уступает первым. По умолчанию."),
  LINEAR: N_("Ничего не урезает: газ встаёт в середину, края обрезаются. Больше управления на упоре, но тяга и направление гуляют."),
  DYNAMIC: N_("У середины газа — как LEGACY, к нулю и полному газу — как LINEAR."),
  EZLANDING: N_("Как LEGACY, но со стиками у центра и газом внизу моторы почти не расходятся: на посадке коптер не подпрыгивает и не заваливается."),
};

/** mixer_type (039/040): как смеситель укладывает команды на упоре — столбики моторов. */
export function MixerCard() {
  const board = useCopterBoard();
  const p = board.params.mixer_type;
  const [view, setView] = useState<keyof typeof MIX_CASES>("punch");
  if (!p) return null;   // старая прошивка
  const current = (MIXER_TYPES as string[]).includes(String(p.value)) ? (String(p.value) as MixerType) : "LEGACY";
  const num = (name: string, def: number) => {
    const v = Number(board.params[name]?.value);
    return Number.isFinite(v) ? v / 100 : def;
  };
  const ez = { threshold: num("ez_landing_threshold", EZ_DEFAULT.threshold), limit: num("ez_landing_limit", EZ_DEFAULT.limit) };
  const c = MIX_CASES[view];
  const W = 92, H = 70, GAP = 14;
  return (
    <div className="card wide" data-testid="mixer-card">
      <div className="row" style={{ gap: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          {t("Смеситель на упоре")}
        </h3>
        <div className="seg" role="group" aria-label={t("Случай")}>
          <button className={view === "punch" ? "on" : ""} onClick={() => setView("punch")}>
            {t("Полный газ и разворот")}
          </button>
          <button className={view === "touchdown" ? "on" : ""} onClick={() => setView("touchdown")}>
            {t("Касание земли")}
          </button>
        </div>
      </div>
      <p className="sub">
        {view === "punch"
          ? t("Газ 90 %, крен и рысканье разом — моторам не хватает хода. Столбики — тяга M1–M4 при каждом типе.")
          : t("Газ в нуле, коптер ударился о землю, и PID тянет по крену. airmode поднимает газ — без ограничения одна сторона подпрыгивает.")}
      </p>
      <svg viewBox={`0 0 ${MIXER_TYPES.length * (W + GAP)} ${H + 34}`} className="filter-svg" role="img" aria-label={t("Тяга моторов при каждом типе смесителя")}>
        {MIXER_TYPES.map((type, k) => {
          const out = mixQuadX(type, c, ez);
          const x0 = k * (W + GAP);
          const on = type === current;
          return (
            <g key={type} data-type={type} className={on ? "on" : undefined}>
              <rect x={x0} y={0} width={W} height={H} rx={6} fill={on ? "var(--accent-soft)" : "none"} stroke={on ? "var(--accent-line)" : "var(--line)"} />
              {out.motors.map((m, i) => {
                const bw = 14, bx = x0 + 10 + i * 20, bh = m * (H - 12);
                return <rect key={i} x={bx} y={H - 6 - bh} width={bw} height={Math.max(1, bh)} rx={2} fill={on ? "var(--accent)" : "var(--text-2)"} opacity={on ? 1 : 0.55} />;
              })}
              <text x={x0 + W / 2} y={H + 14} textAnchor="middle" className="filter-label">
                {type}
              </text>
              <text x={x0 + W / 2} y={H + 28} textAnchor="middle" className="filter-label">
                {t("разброс {s} %", { s: Math.round((Math.max(...out.motors) - Math.min(...out.motors)) * 100) })}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="hint">{t(MIXER_TEXT[current])}</p>
      <ParamRow p={p} title={t("Тип смесителя (mixer_type)")} />
      {current === "EZLANDING" &&
        EZ_PARAMS.map((n) => board.params[n] && <ParamRow key={n} p={board.params[n]} />)}
    </div>
  );
}

const DYN_TEXT: Record<DynIdleState, string> = {
  off: N_("Выключен: холостые постоянные (dshot_idle_value). Задайте dyn_idle_min_rpm — обычно 25–40 у 5\", у мелких винтов больше."),
  needBidir: N_("Нужны обороты от регуляторов: протокол DShot и dshot_bidir = ON (после него — перезагрузка платы). Без них dynamic idle молчит."),
  noRpm: N_("Оборотов пока нет: моторы стоят или регуляторы не отвечают по DShot."),
  ok: N_("Самый медленный мотор выше минимума — холостые не подняты."),
  raising: N_("Мотор у минимума — холостые подняты."),
};

/** dynamic idle (041): обороты на сбросе газа с ним и без — картинка, живое состояние и настройки. */
export function DynIdleCard({ dshot = true }: { dshot?: boolean }) {
  const board = useCopterBoard();
  const live = useCopterLive();
  if (!board.params.dyn_idle_min_rpm) return null;   // старая прошивка
  const s = dynIdleFrom(board.params);
  const bidir = dshot && String(board.params.dshot_bidir?.value ?? "ON") === "ON";
  const state = dynIdleState(s, bidir, live?.dynidle);
  const tr = throttleCutTrace(s);
  const minRpm = s.minRpm > 0 ? s.minRpm : 3500;
  const W = 420, H = 120, top = 2 * minRpm;
  const x = (t: number) => (t / tr.t[tr.t.length - 1]) * W;
  const y = (rpm: number) => H - (Math.min(rpm, top) / top) * H;
  const line = (v: number[]) => v.map((r, i) => `${x(tr.t[i]).toFixed(1)},${y(r).toFixed(1)}`).join(" ");
  return (
    <div className="card wide" data-testid="dynidle-card">
      <h3>{t("Холостые по оборотам (dynamic idle)")}</h3>
      <p className="sub">
        {t("Газ сброшен, коптер падает в собственный поток винтов: обороты проваливаются, регулятор может потерять мотор, а раме нечем тормозить. Dynamic idle поднимает холостые ровно настолько, чтобы самый медленный мотор не опускался ниже минимума.")}
      </p>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="filter-svg" role="img" aria-label={t("Обороты мотора после сброса газа")}>
        <rect x={x(tr.washS[0])} y={0} width={x(tr.washS[1]) - x(tr.washS[0])} height={H} fill="var(--accent-soft)" opacity={0.5} />
        <line x1={0} x2={W} y1={y(minRpm)} y2={y(minRpm)} stroke="var(--warn)" strokeDasharray="4 3" />
        <line x1={x(tr.cutS)} x2={x(tr.cutS)} y1={0} y2={H} stroke="var(--line)" />
        <polyline points={line(tr.off)} fill="none" stroke="var(--text-2)" strokeWidth={1.5} data-line="off" />
        <polyline points={line(tr.on)} fill="none" stroke="var(--accent)" strokeWidth={2} data-line="on" />
        <text x={x(tr.cutS) + 4} y={12} className="filter-label">
          {t("газ в ноль")}
        </text>
        <text x={x(tr.washS[0]) + 4} y={H - 4} className="filter-label">
          {t("в своём потоке")}
        </text>
        <text x={W - 4} y={y(minRpm) - 4} textAnchor="end" className="filter-label">
          {t("минимум {r} об/мин", { r: Math.round(minRpm) })}
        </text>
        <text x={0} y={H + 14} className="filter-label">
          {t("серая — без dynamic idle, цветная — с ним")}
        </text>
      </svg>
      <p className={`hint${state === "needBidir" ? " warn-text" : ""}`} data-state={state}>
        {t(DYN_TEXT[state])}
        {live?.dynidle && live.dynidle.rpm > 0 &&
          " " + t("Сейчас: самый медленный {r} об/мин, добавка {p} %.", { r: Math.round(live.dynidle.rpm), p: (live.dynidle.inc * 100).toFixed(1) })}
      </p>
      {DYN_IDLE_PARAMS.map((n) => board.params[n] && <ParamRow key={n} p={board.params[n]} />)}
    </div>
  );
}

/** EDT (dshot_edt): температура, напряжение и ток каждого регулятора. */
export function EscCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const rows = escRows(live?.esc);
  const bidir = board.params.dshot_bidir;
  const edt = board.params.dshot_edt;
  const total = escTotalAmps(rows);
  if (!edt && !rows.length) return null;   // старая прошивка
  const cell = (v: number | null, unit: string, digits = 0) => (v === null ? "—" : `${v.toFixed(digits)} ${unit}`);
  return (
    <div className="card">
      <h3>{t("Регуляторы")}</h3>
      {rows.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>{t("Температура")}</th>
              <th>{t("Напряжение")}</th>
              <th>{t("Ток")}</th>
              <th>{t("Состояние")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bad = r.alert || r.error;
              const state = r.error
                ? t("ошибка")
                : r.alert
                  ? t("тревога")
                  : r.warning
                    ? t("предупреждение")
                    : r.sag
                      ? t("просадка: проверьте пайку питания")
                      : r.stress !== null
                        ? t("нагрузка {s} из 15", { s: r.stress })
                        : "—";
              return (
                <tr key={r.motor} className={bad || r.hot || r.sag ? "warn-text" : undefined}>
                  <td className="mono">M{r.motor + 1}</td>
                  <td className="mono">{cell(r.tempC, "°C")}</td>
                  <td className="mono">{cell(r.volts, t("В"), 2)}</td>
                  <td className="mono">{cell(r.amps, t("А"))}</td>
                  <td>{state}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="sub">
          {String(bidir?.value ?? "OFF") !== "ON"
            ? t("Регуляторы молчат: сначала включите dshot_bidir (нужна перезагрузка), затем dshot_edt.")
            : String(edt?.value ?? "OFF") !== "ON"
              ? t("Включите dshot_edt — регуляторы Bluejay, BLHeli_32 и AM32 пришлют температуру, напряжение и ток.")
              : t("EDT включён, но регуляторы его не шлют: подключите батарею (команду плата повторит сама) или обновите прошивку регуляторов.")}
        </p>
      )}
      {total !== null && <p className="hint">{t("Всего {a} А по регуляторам — защите по току хватает и без датчика тока на плате.", { a: total.toFixed(0) })}</p>}
      <p className="hint">{t("Горячий — от {c} °C: Bluejay и BLHeli_32 сами режут газ около 140 °C.", { c: ESC_HOT_C })}</p>
      {edt && <ParamRow p={edt} title={t("Расширенная телеметрия (dshot_edt)")} />}
    </div>
  );
}

/** Где мотор на раме, словами: «передний правый». */
/** Порядок выходов: щелчок по двум моторам схемы — они меняются выходами платы. */
export function OutputOrderCard({ motors }: { motors: FrameMotor[] }) {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const pending = useApp((s) => s.copterBoard.pending.motor_output_reordering);
  const { armed } = useCopterLink();
  const [first, setFirst] = useState<number | null>(null);
  const p = board.params.motor_output_reordering;
  if (!p || motors.length === 0) return null;
  const order = parseMotorOrder(String(pending ?? p.value ?? "")) ?? parseMotorOrder("")!;
  const send = (o: number[]) => void set(p.name, o.join(","));
  const pick = (i: number) => {
    if (armed) return;
    if (first === null) return setFirst(i);
    if (first !== i) send(swapOutputs(order, first, i));
    setFirst(null);
  };
  const shuffled = order.slice(0, motors.length).some((v, i) => v !== i);
  return (
    <div className="card" data-card="output-order">
      <h3>{t("Порядок выходов")}</h3>
      <FrameDiagram motors={motors} labels={motors.map((_, i) => t("выход {n}", { n: order[i] + 1 }))} selected={first ?? undefined} onPick={pick} />
      <p className="hint">
        {first === null
          ? t("Проверка показала, что крутится не тот мотор? Нажмите на схеме на два мотора — они поменяются выходами платы.")
          : t("Теперь — мотор, с которым поменять M{n}.", { n: first + 1 })}
      </p>
      <p className="hint">{t("Новый порядок выходов и протокол регуляторов включаются после сохранения и перезагрузки платы.")}</p>
      {shuffled && (
        <button className="btn ghost small" disabled={armed} onClick={() => send(parseMotorOrder("")!)}>
          {t("По порядку")}
        </button>
      )}
    </div>
  );
}

export function motorWhere(m: FrameMotor): string {
  const fore = m[0] > 0.2 ? t("передний") : m[0] < -0.2 ? t("задний") : "";
  const side = m[1] > 0.2 ? t("правый") : m[1] < -0.2 ? t("левый") : "";
  return [fore, side].filter(Boolean).join(" ") || t("в центре");
}

// Направление мотора командой DShot: «обычное» (7) или «обратное» (8) и
// «сохранить» (12) — регулятор запоминает; «пискнуть» (1) — найти мотор.
type Wizard = { dirs: Dir[] | null; busy: boolean; start: () => void; flip: (i: number) => void; save: () => void; cancel: () => void };

function DirectionCard({ motors, picked, busy, wizard, canWizard, pct }: { motors: FrameMotor[]; picked: number; busy: boolean; wizard: Wizard; canWizard: boolean; pct: number }) {
  const cmd = useApp((s) => s.copterCommand);
  const error = useApp((s) => s.copterBoard.errors.dshot);
  const [sent, setSent] = useState("");
  const m = motors[picked];
  if (!m) return null;
  const send = (what: string, line: string) => {
    setSent(what);
    void cmd(line);
  };
  return (
    <div className="card">
      <h3>{t("Направление моторов")}</h3>
      <p className="hint">{t("Регуляторы DShot: направление меняется отсюда, без BLHeliSuite. Крутните мотор ползунком и сравните со стрелкой на схеме; не туда — «Обратное» (или назад «Обычное»). Мотор выбирается кликом по схеме.")}</p>
      <div className="row" style={{ gap: 8, margin: "10px 0" }}>
        <span className="pill ok">
          <span className="txt mono">M{picked + 1}</span>
        </span>
        <span className="grow">
          {motorWhere(m)} · {t("должен крутиться")} {m[2] === "cw" ? t("по часовой") : t("против часовой")}
        </span>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn" disabled={busy} onClick={() => send(t("M{n} пискнул", { n: picked + 1 }), `dshot ${picked} 1`)}>
          <Volume2 size={15} />
          {t("Пискнуть")}
        </button>
        <button className="btn" disabled={busy} onClick={() => send(t("M{n}: обычное направление, сохранено в регуляторе", { n: picked + 1 }), `dshot ${picked} 7 12`)}>
          {t("Обычное")}
        </button>
        <button className="btn" disabled={busy} onClick={() => send(t("M{n}: обратное направление, сохранено в регуляторе", { n: picked + 1 }), `dshot ${picked} 8 12`)}>
          {t("Обратное")}
        </button>
        <button className="btn ghost" disabled={busy} onClick={() => send(t("Пискнули все"), "dshot all 1")}>
          {t("Пискнуть всеми")}
        </button>
      </div>
      {error ? <p className="hint warn-text">{error}</p> : sent && <p className="hint">{sent}</p>}
      <div className="dir-wizard" data-card="dir-wizard">
        <h4>{t("Мастер: щёлкните по мотору, который крутится не туда")}</h4>
        {!wizard.dirs ? (
          <>
            <p className="hint">{t("Все моторы закрутятся на {pct} % в обычную сторону. Сравните со стрелками на схеме и щёлкните по неправильному — он встанет, развернётся и закрутится снова. В конце «Сохранить».", { pct })}</p>
            <button className="btn primary" disabled={!canWizard || busy || wizard.busy} onClick={wizard.start}>
              {t("Начать")}
            </button>
            {!canWizard && <span className="hint"> {t("Сначала отметьте «Я снял пропеллеры».")}</span>}
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
              {wizard.dirs.map((d, i) => (
                <span key={i} className={`pill${d === "reversed" ? " warn" : " ok"}`}>
                  <span className="txt mono">
                    M{i + 1} {d === "reversed" ? t("обратное") : t("обычное")}
                  </span>
                </span>
              ))}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" disabled={wizard.busy} onClick={wizard.save}>
                {t("Сохранить")}
              </button>
              <button className="btn ghost" onClick={wizard.cancel}>
                {t("Отмена")}
              </button>
              {wizard.busy && <span className="hint">{t("разворачиваю…")}</span>}
            </div>
          </>
        )}
      </div>
      <p className="hint">{t("Команды уходят, только пока моторы стоят и коптер не заармлен. «Обычное» и «Обратное» — относительно того, как мотор припаян; провода не трогайте.")}</p>
    </div>
  );
}

/** Рама сверху: x — к носу (вверх на картинке), y — вправо. out — сила 0…1
 * (меньше нуля — стоит); reversed — моторы крутятся наоборот (turtle mode). */
export function FrameDiagram({
  motors,
  out,
  size = 260,
  reversed = false,
  selected,
  onPick,
  labels,
}: {
  motors: FrameMotor[];
  out?: number[];
  size?: number;
  reversed?: boolean;
  selected?: number;
  onPick?: (i: number) => void;
  /** подпись под мотором вместо направления (порядок выходов) */
  labels?: string[];
}) {
  const c = 130;
  const arm = 88;
  const pos = (m: FrameMotor) => ({ x: c + m[1] * arm, y: c - m[0] * arm });
  return (
    <svg className="frame-svg" viewBox="0 0 260 260" width={size} height={size}>
      <polygon points={`${c},${c - 34} ${c - 12},${c - 14} ${c + 12},${c - 14}`} className="frame-nose" />
      {motors.map((m, i) => {
        const p = pos(m);
        return <line key={`a${i}`} x1={c} y1={c} x2={p.x} y2={p.y} className="frame-arm" />;
      })}
      <rect x={c - 22} y={c - 22} width={44} height={44} rx={8} className="frame-body" />
      {motors.map((m, i) => {
        const p = pos(m);
        const level = out ? Math.max(0, Math.min(1, out[i] ?? 0)) : 0;
        const cw = (m[2] === "cw") !== reversed;
        return (
          <g key={i} transform={`translate(${p.x} ${p.y})`} className={onPick ? "frame-pick" : undefined} onClick={onPick ? () => onPick(i) : undefined}>
            <circle r={30} className="frame-prop" style={{ fillOpacity: 0.08 + level * 0.6 }} />
            {selected === i && <circle r={36} className="frame-sel" />}
            <path d={cw ? "M -18 -18 A 26 26 0 0 1 18 -18" : "M 18 -18 A 26 26 0 0 0 -18 -18"} className="frame-spin" markerEnd="url(#arrow)" />
            <text y={6} textAnchor="middle" className="frame-num">
              {i + 1}
            </text>
            <text y={46} textAnchor="middle" className="frame-dir">
              {labels?.[i] ?? (reversed ? (level > 0 ? t("наоборот") : t("стоит")) : cw ? t("по часовой") : t("против"))}
            </text>
          </g>
        );
      })}
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="frame-arrow" />
        </marker>
      </defs>
    </svg>
  );
}
