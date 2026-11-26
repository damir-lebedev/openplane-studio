// «PID» и «Расходы»: таблицы по осям как в BF, профили, кривая
// «стик → °/с»; остальные настройки группы — списками по темам.

import { lazy, Suspense, useRef, useState } from "react";
import { AXES, AXIS_LABELS, CopterBoard, CopterParam, convertRates, num, PID_COLUMNS, RATE_TYPE_LABELS, rateCurve, RATES_TYPES, RatesType, rateSpec, tabParams, throttleAt } from "../../core/copterParams";
import { useApp } from "../../store";
import { N_, t } from "../../i18n";
import { FILTER_PARAMS } from "../../core/filters";
import { MarginBar, NeedBoard, ParamInput, ParamList, ParamRow, ParamSlider, ProfilePicker, useCopterBoard, useCopterLink, useCopterLive } from "./common";
import { FilterChart } from "./FilterChart";
import { SpectrumChart } from "./SpectrumChart";
import { Plot } from "./AutotuneTab";
import { pidSteps, stepVerdict } from "../../core/pidStep";
import { CENTER_STICKS, deadbands, flipSeconds, liveSticks, spinRates, Sticks } from "../../core/ratesSpin";

const RatesSpin3D = lazy(() => import("./RatesSpin3D").then((m) => ({ default: m.RatesSpin3D })));
const hasWebGL = () => typeof WebGL2RenderingContext !== "undefined";

/** Темы настроек PID-профиля по началу имени. */
const PID_TOPICS: { title: string; sub?: string; match: (n: string) => boolean }[] = [
  {
    title: N_("Angle, Horizon, Acro trainer"),
    sub: N_("самовыравнивание, наклон стиком и режим для обучения акро"),
    match: (n) => n.startsWith("angle_") || n.startsWith("horizon_") || n.startsWith("acro_trainer"),
  },
  { title: N_("D max / D min"), sub: N_("D сильнее на резких движениях, мягче в покое"), match: (n) => n.startsWith("d_max") || n.startsWith("d_min") },
  { title: N_("I-term"), sub: N_("интеграл: держит курс при ветре и смещённом центре тяжести"), match: (n) => n.startsWith("iterm") },
  { title: N_("Feedforward"), sub: N_("отклик на движение стика без ожидания ошибки"), match: (n) => n.startsWith("feedforward") },
  { title: N_("Anti-gravity и throttle boost"), sub: N_("не клевать при резком газе"), match: (n) => n.startsWith("anti_gravity") || n.startsWith("throttle_boost") },
  { title: N_("TPA"), sub: N_("PID слабее на большом газе"), match: (n) => n.startsWith("tpa") },
  { title: N_("Рысканье и absolute control"), match: (n) => n.includes("yaw") || n.startsWith("abs_control") },
];

export function PidTab() {
  return (
    <NeedBoard>
      <PidBody />
    </NeedBoard>
  );
}

function AxisTable({ board, columns }: { board: CopterBoard; columns: { key: string; title: string; hint?: string; name: (a: (typeof AXES)[number]) => string }[] }) {
  return (
    <table className="table axis-table">
      <thead>
        <tr>
          <th />
          {columns.map((c) => (
            <th key={c.key} title={c.hint ? t(c.hint) : undefined}>
              {t(c.title)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {AXES.map((a) => (
          <tr key={a}>
            <td>{t(AXIS_LABELS[a])}</td>
            {columns.map((c) => {
              const p = board.params[c.name(a)];
              return <td key={c.key}>{p ? <ParamInput p={p} width={70} compact /> : "—"}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Ползунки PID как в BF (simplified_*): множители поверх модели — подписи понятные, имена BF мелко. */
const PID_SLIDERS: [string, string][] = [
  ["simplified_master_multiplier", N_("Общий: P, I, D и FF вместе")],
  ["simplified_pi_gain", N_("Отслеживание: P и I")],
  ["simplified_i_gain", N_("Удержание курса: I")],
  ["simplified_d_gain", N_("Демпфирование: D")],
  ["simplified_dmax_gain", N_("D на резком движении")],
  ["simplified_feedforward_gain", N_("Отклик на стик: FF")],
  ["simplified_pitch_pi_gain", N_("Тангаж: P и I к крену")],
  ["simplified_pitch_d_gain", N_("Тангаж: D к крену")],
];

const FILTER_SLIDERS: [string, string, string, string][] = [
  ["simplified_gyro_filter_multiplier", "simplified_gyro_filter", N_("Фильтр гироскопа"), N_("Ползунок фильтра гироскопа")],
  ["simplified_dterm_filter_multiplier", "simplified_dterm_filter", N_("Фильтр D"), N_("Ползунок фильтра D")],
];

function SliderCard({ board, title, sub, mode, sliders }: { board: CopterBoard; title: string; sub: string; mode: [CopterParam, string][]; sliders: [CopterParam, string][] }) {
  if (!sliders.length) return null;
  return (
    <div className="card wide">
      <h3>{title}</h3>
      <p className="sub">{sub}</p>
      <div className="slider-card">
        <div>
          {mode.map(([p, title]) => (
            <ParamRow key={p.name} p={p} title={title} />
          ))}
          {sliders.map(([p, title]) => (
            <ParamSlider key={p.name} p={p} title={title} min={p.name.includes("filter") ? 50 : 0} max={p.name.includes("filter") ? 150 : 200} />
          ))}
        </div>
        <MarginBar margin={board.header?.margin} />
      </div>
    </div>
  );
}

const VERDICT_TEXT = {
  ok: N_("быстро и без раскачки"),
  slow: N_("вяло: P или FF можно поднять"),
  overshoot: N_("перелёт: P или FF великоваты, D мало"),
  unstable: N_("раскачка: так летать нельзя"),
} as const;

/** 044 · Ступенька на модели коптера при PID, что работают: меняешь число — видишь отклик. */
export function StepCard({ board }: { board: CopterBoard }) {
  const steps = pidSteps(board);
  if (!steps) return null;
  const top = Math.min(2, Math.max(1.4, Math.ceil(Math.max(...steps.flatMap((s) => s.points.map(([, v]) => v)), 0) * 10.5) / 10));
  return (
    <div className="card wide" data-testid="pid-step">
      <h3>{t("Отклик на резкий стик")}</h3>
      <p className="sub">{t("Ступенька в 40 % стика на модели коптера при тех PID и фильтрах, что работают сейчас. Линия должна быстро дойти до 1 и не прыгать выше — прыгает, значит раскачается и в воздухе.")}</p>
      <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="grow" style={{ minWidth: 280, maxWidth: 560 }}>
          <Plot
            title={t("Доля уставки по времени, мс")}
            x={[0, 200]}
            y={[0, top]}
            xTicks={[0, 50, 100, 150, 200]}
            yTicks={top > 1.6 ? [0, 0.5, 1, 1.5, 2].filter((v) => v <= top) : [0, 0.5, 1]}
            unit={t("мс")}
            lines={[]}
          >
            {(fx, fy) => (
              <>
                <line x1={fx(0)} x2={fx(200)} y1={fy(1)} y2={fy(1)} className="tune-target" />
                {steps.map((s) => (
                  <path
                    key={s.axis}
                    d={s.points
                      .filter(([ms]) => ms <= 200)
                      .map(([ms, v], i) => `${i ? "L" : "M"}${fx(ms).toFixed(1)},${fy(v).toFixed(1)}`)
                      .join("")}
                    stroke={AXIS_COLORS[s.axis]}
                    className="tune-line"
                  />
                ))}
              </>
            )}
          </Plot>
        </div>
        <div className="kv">
          {steps.map((s) => {
            const v = stepVerdict(s.step);
            return (
              <span key={s.axis} style={{ display: "contents" }}>
                <span style={{ color: AXIS_COLORS[s.axis] }}>{t(AXIS_LABELS[s.axis])}</span>
                <span>
                  <span className="mono">
                    {t("{dps} °/с · до 90 % за {ms} мс · перелёт {os} %", { dps: Math.round(s.stepDps), ms: Math.round(s.step.rise * 1000), os: Math.round(s.step.overshoot * 100) })}
                  </span>
                  <br />
                  <span className={v === "ok" ? "ok-text" : "warn-text"} data-testid={`pid-step-${s.axis}`}>
                    {t(VERDICT_TEXT[v])}
                  </span>
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <p className="hint">{t("Модель знает коптер с точностью около ±30 %: проверить на деле — вкладка «Измерение и автонастройка».")}</p>
    </div>
  );
}

function PidBody() {
  const board = useCopterBoard();
  const source = board.params.tune_source;
  const inTable = new Set(PID_COLUMNS.flatMap((c) => AXES.map((a) => c.name(a))));
  const sliders = PID_SLIDERS.filter(([n]) => board.params[n]).map(([n, title]): [CopterParam, string] => [board.params[n], t(title)]);
  const rest = tabParams(board, "pid", ["tune_source", "profile_name", "simplified_pids_mode", ...PID_SLIDERS.map(([n]) => n), ...inTable]);
  const topics = PID_TOPICS.map((tp) => ({ ...tp, params: [] as CopterParam[] }));
  const other: CopterParam[] = [];
  for (const p of rest) {
    const tp = topics.find((x) => x.match(p.name));
    (tp ? tp.params : other).push(p);
  }
  return (
    <div className="copter-grid">
      <div className="card wide">
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <h3 className="grow" style={{ margin: 0 }}>
            {t("PID-профиль")}
          </h3>
          <ProfilePicker kind="profile" />
        </div>
        {source && <ParamRow p={source} title={t("Откуда настройка")} />}
        <p className="hint">
          {board.header?.source === "MODEL"
            ? t("MODEL: PID и фильтры посчитаны из описания коптера (масса, моторы, винты — вкладка «Прочее»). Любую клетку можно поменять руками; вернуть посчитанное — tune_source или «по умолчанию» в CLI.")
            : t("BETAFLIGHT: умолчания Betaflight 4.5 — как на родной прошивке.")}
        </p>
        <AxisTable board={board} columns={PID_COLUMNS} />
        {board.params.profile_name && <ParamRow p={board.params.profile_name} />}
      </div>
      <SliderCard
        board={board}
        title={t("Ползунки PID")}
        sub={t("Как ползунки Betaflight: множители поверх посчитанного (100 % — как есть). Числа, заданные в таблице руками, они не трогают. Полоса справа — запас устойчивости для того, что получилось.")}
        mode={board.params.simplified_pids_mode ? [[board.params.simplified_pids_mode, t("Ползунки работают на осях")]] : []}
        sliders={sliders}
      />
      <StepCard board={board} />
      {topics.map((tp) => (
        <ParamList key={tp.title} title={t(tp.title)} sub={tp.sub ? t(tp.sub) : undefined} params={tp.params} />
      ))}
      <ParamList title={t("Прочее")} params={other} />
    </div>
  );
}

export function FiltersTab() {
  return (
    <NeedBoard>
      <FiltersBody />
    </NeedBoard>
  );
}

function FiltersBody() {
  const board = useCopterBoard();
  const names = FILTER_SLIDERS.flatMap(([n, mode]) => [n, mode]);
  const sliders = FILTER_SLIDERS.filter(([n]) => board.params[n]).map(([n, , title]): [CopterParam, string] => [board.params[n], t(title)]);
  const modes = FILTER_SLIDERS.filter(([, mode]) => board.params[mode]).map(([, mode, , title]): [CopterParam, string] => [board.params[mode], t(title)]);
  return (
    <div className="copter-grid">
      <SliderCard
        board={board}
        title={t("Фильтры")}
        sub={t("Срезы фильтров гироскопа и D посчитаны из модели коптера (обороты, рама). Ползунок — множитель: меньше — тише моторы и сильнее задержка, больше — быстрее отклик, но вибрации проходят в моторы.")}
        mode={modes}
        sliders={sliders}
      />
      <FilterChart />
      <ParamList
        title={t("Гироскоп")}
        sub={t("Две ступени ФНЧ (тип и срез, первая — может расти с газом) и два режектора под резонанс рамы. Имена — как в Betaflight.")}
        params={FILTER_PARAMS.gyro.filter((n) => board.params[n]).map((n) => board.params[n])}
      />
      <ParamList
        title={t("D")}
        sub={t("D усиливает шум сильнее всего — его фильтры ниже. Свои в каждом PID-профиле.")}
        params={FILTER_PARAMS.dterm.filter((n) => board.params[n]).map((n) => board.params[n])}
      />
      <SpectrumChart />
      {FILTER_PARAMS.notch.some((n) => board.params[n]) && (
        <div className="wide">
          <ParamList
            title={t("Режекторы за вибрацией")}
            sub={t("Динамический режектор едет за пиками спектра; RPM-фильтр — за оборотами моторов: с двунаправленным DShot (dshot_bidir) — точные обороты каждого мотора, без него — по модели. Имена — как в Betaflight.")}
            params={FILTER_PARAMS.notch.filter((n) => board.params[n]).map((n) => board.params[n])}
          />
        </div>
      )}
      <div className="wide">
        <ParamList title={t("Ещё")} params={tabParams(board, "filters", [...names, ...FILTER_PARAMS.gyro, ...FILTER_PARAMS.dterm, ...FILTER_PARAMS.notch])} />
      </div>
    </div>
  );
}

export function RatesTab() {
  return (
    <NeedBoard>
      <RatesBody />
    </NeedBoard>
  );
}

const AXIS_COLORS = { roll: "#39d0ff", pitch: "#3fb950", yaw: "#e3b341" };

/** Кривые «стик → °/с» по осям (любая формула rates_type) и сводка под ними. */
export function RateChart({ board, sticks }: { board: CopterBoard; sticks?: Sticks }) {
  const curves = AXES.map((a) => ({ axis: a, spec: rateSpec(board, a) }));
  const top = Math.max(200, ...curves.map((c) => rateCurve(c.spec, 1)));
  const w = 360;
  const h = 220;
  const path = (c: (typeof curves)[number]) =>
    Array.from({ length: 51 }, (_, i) => {
      const s = i / 50;
      return `${i ? "L" : "M"} ${(s * w).toFixed(1)} ${(h - (rateCurve(c.spec, s) / top) * h).toFixed(1)}`;
    }).join(" ");
  return (
    <>
      <svg className="rate-svg" viewBox={`-40 -10 ${w + 60} ${h + 34}`}>
        <line x1={0} y1={h} x2={w} y2={h} className="axis" />
        <line x1={0} y1={0} x2={0} y2={h} className="axis" />
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={0} y1={h - f * h} x2={w} y2={h - f * h} className="grid" />
            <text x={-6} y={h - f * h + 4} textAnchor="end" className="tick">
              {Math.round(top * f)}
            </text>
          </g>
        ))}
        <text x={w} y={h + 18} textAnchor="end" className="tick">
          {t("стик до упора")}
        </text>
        <text x={0} y={h + 18} className="tick">
          {t("центр")}
        </text>
        {curves.map((c) => (
          <path key={c.axis} d={path(c)} stroke={AXIS_COLORS[c.axis]} className="curve" />
        ))}
        {sticks &&
          curves.map((c) => {
            const s = Math.min(1, Math.abs(sticks[c.axis]));
            return (
              <circle key={c.axis} data-testid={`stick-dot-${c.axis}`} cx={s * w} cy={h - (Math.abs(rateCurve(c.spec, s)) / top) * h} r={5} fill={AXIS_COLORS[c.axis]} stroke="#0b1520" strokeWidth={1.5} />
            );
          })}
      </svg>
      <div className="kv">
        {curves.map((c) => (
          <span key={c.axis} style={{ display: "contents" }}>
            <span style={{ color: AXIS_COLORS[c.axis] }}>{t(AXIS_LABELS[c.axis])}</span>
            <span className="mono">
              {t("до {dps} °/с", { dps: Math.round(rateCurve(c.spec, 1)) })} · {t("у центра {dps} °/с", { dps: Math.round(rateCurve(c.spec, 0.1) * 10) })}
            </span>
          </span>
        ))}
      </div>
    </>
  );
}

/** Кривая газа: стик → газ (thr_mid, thr_expo, throttle_limit_*), висение — точкой. */
export function ThrottleChart({ board }: { board: CopterBoard }) {
  const mid = num(board, "thr_mid", 50);
  const expo = num(board, "thr_expo");
  const ty = String(board.params.throttle_limit_type?.value ?? "OFF");
  const lim = num(board, "throttle_limit_percent", 100);
  const w = 360;
  const h = 180;
  const d = Array.from({ length: 51 }, (_, i) => {
    const s = i / 50;
    return `${i ? "L" : "M"} ${(s * w).toFixed(1)} ${(h - throttleAt(mid, expo, ty, lim, s) * h).toFixed(1)}`;
  }).join(" ");
  const my = h - throttleAt(mid, expo, ty, lim, mid / 100) * h;
  return (
    <svg className="rate-svg" viewBox={`-40 -10 ${w + 60} ${h + 34}`} data-testid="throttle-chart">
      <line x1={0} y1={h} x2={w} y2={h} className="axis" />
      <line x1={0} y1={0} x2={0} y2={h} className="axis" />
      <line x1={0} y1={h} x2={w} y2={0} className="grid" />
      {[0.5, 1].map((f) => (
        <text key={f} x={-6} y={h - f * h + 4} textAnchor="end" className="tick">
          {Math.round(f * 100)} %
        </text>
      ))}
      <text x={w} y={h + 18} textAnchor="end" className="tick">
        {t("газ до упора")}
      </text>
      <text x={0} y={h + 18} className="tick">
        {t("газ 0")}
      </text>
      <path d={d} stroke="#39d0ff" className="curve" />
      <circle cx={(mid / 100) * w} cy={my} r={4} fill="#e3b341" />
    </svg>
  );
}

/** Выбор формулы rates_type: числа пересчитываются, чтобы стик ощущался так же. */
function RatesTypePicker({ board }: { board: CopterBoard }) {
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const [busy, setBusy] = useState(false);
  if (!board.params.rates_type) return null;
  const current = rateSpec(board, "roll").type;
  const pick = async (to: RatesType) => {
    if (to === current) return;
    setBusy(true);
    try {
      const next = AXES.map((a) => ({ a, v: convertRates(rateSpec(board, a), to) }));
      await set("rates_type", to);
      for (const { a, v } of next) {
        await set(`${a}_rc_rate`, v.rc);
        await set(`${a}_srate`, v.srate);
        await set(`${a}_expo`, v.expo);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="seg" data-testid="rates-type">
      {RATES_TYPES.map((ty) => (
        <button key={ty} className={ty === current ? "on" : ""} disabled={armed || busy} onClick={() => void pick(ty)}>
          {ty === "BETAFLIGHT" ? "Betaflight" : ty.charAt(0) + ty.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  );
}

const THROTTLE_PARAMS = ["thr_mid", "thr_expo", "throttle_limit_type", "throttle_limit_percent"];

/**
 * Виртуальный стик: тянуть мышью, отпустил — пружиной в центр. onlyX — левый
 * стик (рысканье, газ не трогаем), иначе правый: крен и тангаж (от себя — плюс).
 */
function StickPad({ x, y, onlyX, label, onMove }: { x: number; y: number; onlyX?: boolean; label: string; onMove: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cl = (v: number) => Math.max(-1, Math.min(1, v));
    const nx = cl(((e.clientX - r.left) / r.width) * 2 - 1);
    const ny = onlyX ? 0 : cl(1 - ((e.clientY - r.top) / r.height) * 2);
    onMove(nx, ny);
  };
  const up = () => {
    drag.current = false;
    onMove(0, 0);
  };
  return (
    <div className="stick-pad-wrap">
      <div
        ref={ref}
        className="stick-pad"
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(x * 100)}
        onPointerDown={(e) => {
          drag.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          move(e);
        }}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <span className="stick-dot" style={{ left: `${50 + x * 50}%`, top: `${50 - y * 50}%` }} />
      </div>
      <span className="tick">{label}</span>
    </div>
  );
}

/** Коптер крутится с расходами: от стиков пульта (живой кадр) или виртуальных. */
function SpinCard({ board, sticks, fromRadio, onVirtual }: { board: CopterBoard; sticks: Sticks; fromRadio: boolean; onVirtual: (s: Sticks) => void }) {
  const rates = useRef<Sticks>(CENTER_STICKS);
  rates.current = spinRates(board, sticks);
  const [reset, setReset] = useState(0);
  const flips = AXES.map((a) => ({ a, s: flipSeconds(board, a) }));
  return (
    <div className="card" data-testid="rates-spin">
      <div className="row" style={{ gap: 12 }}>
        <h3 className="grow" style={{ margin: 0 }}>
          {t("Как будет крутиться")}
        </h3>
        <button className="btn small" onClick={() => setReset((n) => n + 1)}>
          {t("В горизонт")}
        </button>
      </div>
      {hasWebGL() ? (
        <Suspense fallback={<div className="rates-3d" />}>
          <RatesSpin3D rates={rates} reset={reset} />
        </Suspense>
      ) : null}
      <div className="kv">
        {flips.map(({ a, s }) => (
          <span key={a} style={{ display: "contents" }}>
            <span style={{ color: AXIS_COLORS[a] }}>{t(AXIS_LABELS[a])}</span>
            <span className="mono">
              {Math.round(rates.current[a])} °/с · {s ? t("оборот за {s} с", { s: s.toFixed(2) }) : "—"}
            </span>
          </span>
        ))}
      </div>
      {fromRadio ? (
        <p className="hint">{t("Двигайте стики пульта: модель крутится так, как коптер в акро с этими расходами.")}</p>
      ) : (
        <>
          <div className="row stick-pads">
            <StickPad x={sticks.yaw} y={0} onlyX label={t("Рысканье")} onMove={(x) => onVirtual({ ...sticks, yaw: x })} />
            <StickPad x={sticks.roll} y={sticks.pitch} label={t("Крен и тангаж")} onMove={(x, y) => onVirtual({ ...sticks, roll: x, pitch: y })} />
          </div>
          <p className="hint">{t("Пульт не на связи — тяните стики мышью. Отпустили — коптер стоит, через секунду модель встаёт в горизонт.")}</p>
        </>
      )}
    </div>
  );
}

function RatesBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const [virt, setVirt] = useState<Sticks>(CENTER_STICKS);
  const fromRadio = !!live && live.rx === "ok" && live.ch.length >= 4;
  const [db, ydb] = deadbands(board);
  const sticks = fromRadio ? liveSticks(live.ch, board.rc?.map ?? "AETR1234", db, ydb) : virt;
  const type = rateSpec(board, "roll").type;
  const L = RATE_TYPE_LABELS[type];
  const columns = [
    { key: "rc", title: L.rc, hint: L.rcHint, name: (a: (typeof AXES)[number]) => `${a}_rc_rate` },
    { key: "srate", title: L.srate, hint: L.srateHint, name: (a: (typeof AXES)[number]) => `${a}_srate` },
    { key: "expo", title: L.expo, hint: N_("мягче у центра, %"), name: (a: (typeof AXES)[number]) => `${a}_expo` },
    ...(board.params.roll_rate_limit
      ? [{ key: "limit", title: N_("Потолок"), hint: N_("°/с — выше не будет при любой формуле"), name: (a: (typeof AXES)[number]) => `${a}_rate_limit` }]
      : []),
  ];
  const inTable = new Set(columns.flatMap((c) => AXES.map((a) => c.name(a))));
  const thr = THROTTLE_PARAMS.map((n) => board.params[n]).filter((p): p is CopterParam => !!p);
  return (
    <div className="copter-grid">
      <div className="card">
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <h3 className="grow" style={{ margin: 0 }}>
            {t("Расходы")}
          </h3>
          <ProfilePicker kind="rateprofile" />
        </div>
        <RatesTypePicker board={board} />
        <p className="hint">
          {type === "ACTUAL"
            ? t("Кривая Actual: «Центр» — чувствительность у центра стика, «Максимум» — скорость вращения при стике до упора, «Экспо» — насколько мягче у центра.")
            : t("Числа — как в конфигураторе Betaflight для этой формулы. При смене формулы Studio пересчитывает их, чтобы стик ощущался так же.")}
        </p>
        <AxisTable board={board} columns={columns} />
        {board.params.rateprofile_name && <ParamRow p={board.params.rateprofile_name} />}
      </div>
      <div className="card">
        <h3>{t("Стик → скорость вращения")}</h3>
        <RateChart board={board} sticks={sticks} />
        <p className="hint">{t("Новичку: 400–500 °/с максимума и экспо 30–50 % — спокойно; фристайл — 700–850.")}</p>
      </div>
      <SpinCard board={board} sticks={sticks} fromRadio={fromRadio} onVirtual={setVirt} />
      {thr.length > 0 && (
        <div className="card">
          <h3>{t("Стик газа → газ")}</h3>
          <ThrottleChart board={board} />
          {thr.map((p) => (
            <ParamRow key={p.name} p={p} />
          ))}
          <p className="hint">{t("thr_mid — на газ висения, thr_expo 20–40 % — висеть и снимать кино точнее. Предел газа — для обучения или мощной батареи на маленьком коптере.")}</p>
        </div>
      )}
      <div className="wide">
        <ParamList title={t("Ещё")} params={tabParams(board, "rates", ["rateprofile_name", "rates_type", ...THROTTLE_PARAMS, ...inTable])} />
      </div>
    </div>
  );
}
