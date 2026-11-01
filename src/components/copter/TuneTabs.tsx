// «PID» и «Расходы»: таблицы по осям как в BF, профили, кривая
// «стик → °/с»; остальные настройки группы — списками по темам.

import { AXES, AXIS_LABELS, CopterBoard, CopterParam, num, PID_COLUMNS, RATE_COLUMNS, rateAt, tabParams } from "../../core/copterParams";
import { t } from "../../i18n";
import { NeedBoard, ParamInput, ParamList, ParamRow, ProfilePicker, useCopterBoard } from "./common";

/** Темы настроек PID-профиля по началу имени. */
const PID_TOPICS: { title: string; sub?: string; match: (n: string) => boolean }[] = [
  { title: "D max / D min", sub: "D сильнее на резких движениях, мягче в покое", match: (n) => n.startsWith("d_max") || n.startsWith("d_min") },
  { title: "I-term", sub: "интеграл: держит курс при ветре и смещённом центре тяжести", match: (n) => n.startsWith("iterm") },
  { title: "Feedforward", sub: "отклик на движение стика без ожидания ошибки", match: (n) => n.startsWith("feedforward") },
  { title: "Anti-gravity и throttle boost", sub: "не клевать при резком газе", match: (n) => n.startsWith("anti_gravity") || n.startsWith("throttle_boost") },
  { title: "TPA", sub: "PID слабее на большом газе", match: (n) => n.startsWith("tpa") },
  { title: "Рысканье и absolute control", match: (n) => n.includes("yaw") || n.startsWith("abs_control") },
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

function PidBody() {
  const board = useCopterBoard();
  const source = board.params.tune_source;
  const inTable = new Set(PID_COLUMNS.flatMap((c) => AXES.map((a) => c.name(a))));
  const rest = tabParams(board, "pid", ["tune_source", "profile_name", ...inTable]);
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
      {topics.map((tp) => (
        <ParamList key={tp.title} title={t(tp.title)} sub={tp.sub ? t(tp.sub) : undefined} params={tp.params} />
      ))}
      <ParamList title={t("Прочее")} params={other} />
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

function RatesBody() {
  const board = useCopterBoard();
  const inTable = new Set(RATE_COLUMNS.flatMap((c) => AXES.map((a) => c.name(a))));
  const curves = AXES.map((a) => ({
    axis: a,
    center: num(board, `${a}_rc_rate`),
    max: num(board, `${a}_srate`),
    expo: num(board, `${a}_expo`),
  }));
  const top = Math.max(200, ...curves.map((c) => rateAt(c.center, c.max, c.expo, 1)));
  const w = 360;
  const h = 220;
  const path = (c: (typeof curves)[number]) =>
    Array.from({ length: 51 }, (_, i) => {
      const s = i / 50;
      return `${i ? "L" : "M"} ${(s * w).toFixed(1)} ${(h - (rateAt(c.center, c.max, c.expo, s) / top) * h).toFixed(1)}`;
    }).join(" ");
  return (
    <div className="copter-grid">
      <div className="card">
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <h3 className="grow" style={{ margin: 0 }}>
            {t("Расходы")}
          </h3>
          <ProfilePicker kind="rateprofile" />
        </div>
        <p className="hint">{t("Кривая Actual: «Центр» — чувствительность у центра стика, «Максимум» — скорость вращения при стике до упора, «Экспо» — насколько мягче у центра.")}</p>
        <AxisTable board={board} columns={RATE_COLUMNS} />
        {board.params.rateprofile_name && <ParamRow p={board.params.rateprofile_name} />}
      </div>
      <div className="card">
        <h3>{t("Стик → скорость вращения")}</h3>
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
        </svg>
        <div className="kv">
          {curves.map((c) => (
            <span key={c.axis} style={{ display: "contents" }}>
              <span style={{ color: AXIS_COLORS[c.axis] }}>{t(AXIS_LABELS[c.axis])}</span>
              <span className="mono">
                {t("до {dps} °/с", { dps: Math.round(rateAt(c.center, c.max, c.expo, 1)) })} · {t("у центра {dps} °/с", { dps: Math.round(rateAt(c.center, c.max, c.expo, 0.1) * 10) })}
              </span>
            </span>
          ))}
        </div>
        <p className="hint">{t("Новичку: 400–500 °/с максимума и экспо 30–50 % — спокойно; фристайл — 700–850.")}</p>
      </div>
      <div className="wide">
        <ParamList title={t("Ещё")} params={tabParams(board, "rates", ["rateprofile_name", ...inTable])} />
      </div>
    </div>
  );
}
