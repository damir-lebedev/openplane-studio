// «Подстройки»: подстройки в полёте крутилками и тумблерами (adjrange, как
// вкладка Adjustments в BF). Карточка на строку: когда действует (канал и
// диапазон), что меняет, чем (канал) и как — шагом, ручкой от центра или
// профиль положением тумблера; схема хода ручки с живой меткой канала.
// В прошивке меняется сразу (RAM), во флеш — без ARM, когда ручки секунду
// не трогали; в очках — элемент OSD «подстройка» (2 с).

import { Plus, Trash2 } from "lucide-react";

import {
  ADJ_FUNCTIONS,
  ADJ_GROUPS,
  ADJ_MAX_US,
  ADJ_MIN_US,
  ADJ_STEP_DOWN_US,
  ADJ_STEP_UP_US,
  AdjRow,
  adjAbsoluteValue,
  adjActive,
  adjCommand,
  adjFunction,
  adjMode,
  adjSelectProfile,
  adjStep,
  clearAdjCommand,
  freeAdjSlot,
  newAdjRow,
} from "../../core/adjustments";
import { auxLabel, AuxRow } from "../../core/copterParams";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, useCopterBoard, useCopterLink, useCopterLive } from "./common";
import { RangeRow } from "./ModesTab";

export function AdjustTab() {
  return (
    <NeedBoard>
      <AdjustBody />
    </NeedBoard>
  );
}

function AdjustBody() {
  const board = useCopterBoard();
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const auxCount = Math.max(1, (board.rc?.channels || 8) - 4);
  const rows = board.adj;
  const slot = freeAdjSlot(rows);
  const error = board.errors.adjrange;

  return (
    <div className="modes">
      <div className="card">
        <h3>{t("Подстройки в полёте")}</h3>
        <p className="sub" style={{ margin: 0 }}>
          {t("Крутилка или тумблер пульта меняет настройку прямо в полёте — подобрать P или расходы, не садясь. Запоминается само после посадки (без ARM, когда ручку секунду не трогали). В очках на 2 с — что и сколько (OSD → «подстройка»).")}
        </p>
        {error && <p className="hint warn-text">{error}</p>}
      </div>
      {rows.map((r) => (
        <AdjCard key={r[0]} row={r} auxCount={auxCount} disabled={armed} onChange={(n) => void cmd(adjCommand(n))} onRemove={() => void cmd(clearAdjCommand(r[0]))} />
      ))}
      <button className="btn ghost small" disabled={armed || slot < 0} onClick={() => void cmd(adjCommand(newAdjRow(slot, auxCount)))}>
        <Plus size={14} />
        {t("Подстройка")}
      </button>
    </div>
  );
}

function AdjCard({ row, auxCount, disabled, onChange, onRemove }: { row: AdjRow; auxCount: number; disabled: boolean; onChange: (r: AdjRow) => void; onRemove: () => void }) {
  const board = useCopterBoard();
  const live = useCopterLive();
  const [slot, rangeCh, from, to, fn, adjCh, center, scale] = row;
  const func = adjFunction(fn);
  const mode = adjMode(row);
  const rangeUs = live?.ch[rangeCh + 4];
  const adjUs = live?.ch[adjCh + 4];
  const on = adjActive(row, rangeUs);
  const set = (i: number, v: number) => {
    const next = [...row] as AdjRow;
    next[i] = v;
    onChange(next);
  };
  const paramValue = (name: string) => board.params[name]?.value;
  const setMode = (absolute: boolean) => {
    const next = [...row] as AdjRow;
    const first = func?.params[0];
    next[6] = absolute ? Math.max(1, Math.round(Number(first ? paramValue(first) : 50) || 50)) : 0;
    next[7] = absolute ? 20 : 0;
    onChange(next);
  };
  // диапазон — строкой aux, чтобы взять ползунок вкладки «Режимы»
  const asAux: AuxRow = [slot, 0, rangeCh, from, to, 0, 0];

  return (
    <div className={`card mode-card${on ? " on" : ""}`}>
      <div className="mode-head">
        <div className="row" style={{ gap: 8 }}>
          <select className="select" disabled={disabled} value={fn} onChange={(e) => set(4, Number(e.target.value))}>
            {!func && <option value={fn}>{`#${fn}`}</option>}
            {ADJ_GROUPS.map((g) => (
              <optgroup key={g.id} label={t(g.title)}>
                {ADJ_FUNCTIONS.filter((x) => x.group === g.id).map((x) => (
                  <option key={x.id} value={x.id} disabled={x.kind === "none"}>
                    {t(x.title)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {func && <span className="mono hint">{func.name}</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {live && <span className={`pill${on ? " ok" : ""}`}>{on ? t("действует") : t("не действует")}</span>}
          <button className="btn ghost small" disabled={disabled} title={t("Убрать подстройку")} onClick={onRemove}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="hint">{t("Когда действует — канал в диапазоне (900–2100 — всегда):")}</div>
      <RangeRow row={asAux} auxCount={auxCount} us={rangeUs} disabled={disabled} onChange={(a) => onChange([slot, a[2], a[3], a[4], fn, adjCh, center, scale])} />

      <div className="row" style={{ gap: 8, marginTop: 18, flexWrap: "wrap" }}>
        <span className="hint">{t("Чем:")}</span>
        <select className="select" style={{ width: 96 }} disabled={disabled} value={adjCh} onChange={(e) => set(5, Number(e.target.value))}>
          {Array.from({ length: auxCount }, (_, i) => (
            <option key={i} value={i}>
              {auxLabel(i)}
            </option>
          ))}
        </select>
        {(mode === "step" || mode === "absolute") && (
          <>
            <span className="hint">{t("Как:")}</span>
            <div className="seg" role="group" aria-label={t("Как")}>
              <button className={mode === "step" ? "on" : ""} disabled={disabled} onClick={() => mode !== "step" && setMode(false)}>
                {t("шагом")}
              </button>
              <button className={mode === "absolute" ? "on" : ""} disabled={disabled} onClick={() => mode !== "absolute" && setMode(true)}>
                {t("ручкой от центра")}
              </button>
            </div>
          </>
        )}
        {mode === "absolute" && (
          <>
            <span className="hint">{t("центр")}</span>
            <input className="input compact" style={{ width: 64 }} type="number" min={1} max={2000} disabled={disabled} defaultValue={center} key={`c${center}`} onBlur={(e) => set(6, Math.max(1, Math.min(2000, Math.round(Number(e.target.value) || 1))))} />
            <span className="hint">±</span>
            <input className="input compact" style={{ width: 64 }} type="number" min={0} max={2000} disabled={disabled} defaultValue={scale} key={`s${scale}`} onBlur={(e) => set(7, Math.max(0, Math.min(2000, Math.round(Number(e.target.value) || 0))))} />
          </>
        )}
      </div>

      <AdjPicture row={row} us={adjUs} />

      <p className="hint" style={{ margin: 0 }}>
        {mode === "step" && t("Ручка вверх — +1, вниз — −1, держать — ещё шаг каждые 0.5 с; в середине — ничего.")}
        {mode === "absolute" && t("Положение ручки — значение: середина — центр, края — центр ± масштаб.")}
        {mode === "select" && t("Тумблер на три положения: вниз — профиль 1, середина — 2, вверх — 3.")}
        {mode === "none" && t("Этой функции в OpenPlane нет: строка хранится, но ничего не делает.")}
        {func && func.params.length > 0 && (
          <>
            {" "}
            {t("Сейчас:")} <span className="mono">{func.params.map((n) => `${n} ${paramValue(n) ?? "—"}`).join(" · ")}</span>
          </>
        )}
        {mode === "select" && Number.isFinite(fn === 12 ? board.header?.rateprofile : board.header?.profile) && (
          <>
            {" "}
            {t("Сейчас:")} <span className="mono">{t("профиль")} {Number(fn === 12 ? board.header?.rateprofile : board.header?.profile) + 1}</span>
          </>
        )}
      </p>
    </div>
  );
}

const W = 640;
const X0 = 10;
const X1 = W - 10;
const x = (us: number) => X0 + ((Math.min(ADJ_MAX_US, Math.max(ADJ_MIN_US, us)) - ADJ_MIN_US) / (ADJ_MAX_US - ADJ_MIN_US)) * (X1 - X0);

/** Ход ручки 900–2100: что она делает в каждом месте; метка — где она сейчас. */
export function AdjPicture({ row, us }: { row: AdjRow; us?: number }) {
  const mode = adjMode(row);
  const zones: { from: number; to: number; label: string; on: boolean }[] = [];
  if (mode === "step") {
    const step = us === undefined ? null : adjStep(us);
    zones.push({ from: ADJ_MIN_US, to: ADJ_STEP_DOWN_US, label: "−1", on: step === -1 });
    zones.push({ from: ADJ_STEP_DOWN_US, to: ADJ_STEP_UP_US, label: t("ничего"), on: step === 0 });
    zones.push({ from: ADJ_STEP_UP_US, to: ADJ_MAX_US, label: "+1", on: step === 1 });
  } else if (mode === "select") {
    const p = us === undefined ? 0 : adjSelectProfile(us);
    for (let i = 0; i < 3; i++) zones.push({ from: ADJ_MIN_US + i * 400, to: ADJ_MIN_US + (i + 1) * 400, label: `${t("профиль")} ${i + 1}`, on: p === i + 1 });
  }
  const lo = adjAbsoluteValue(row, 1000);
  const hi = adjAbsoluteValue(row, 2000);
  return (
    <svg className="adj-pic" viewBox={`0 0 ${W} 52`} width="100%" height={52} role="img" aria-label={t("Ход ручки")}>
      <rect x={X0} y={6} width={X1 - X0} height={26} rx={6} className="adj-track" />
      {zones.map((z, i) => (
        <g key={i}>
          <rect x={x(z.from) + 1} y={9} width={x(z.to) - x(z.from) - 2} height={20} rx={4} className={`adj-zone${z.on ? " on" : ""}`} />
          <text x={(x(z.from) + x(z.to)) / 2} y={23} className="adj-text" textAnchor="middle">
            {z.label}
          </text>
        </g>
      ))}
      {mode === "absolute" && (
        <>
          <polygon points={`${x(1000)},29 ${x(2000)},9 ${x(2000)},29`} className="adj-zone" />
          <text x={x(1000)} y={46} className="adj-text" textAnchor="middle">
            {lo}
          </text>
          <text x={x(1500)} y={46} className="adj-text" textAnchor="middle">
            {row[6]}
          </text>
          <text x={x(2000)} y={46} className="adj-text" textAnchor="middle">
            {hi}
          </text>
        </>
      )}
      {mode !== "absolute" &&
        [1000, 1500, 2000].map((v) => (
          <text key={v} x={x(v)} y={46} className="adj-text dim" textAnchor="middle">
            {v}
          </text>
        ))}
      {us !== undefined && (
        <g>
          <rect x={x(us) - 1.5} y={2} width={3} height={34} rx={1.5} className="adj-mark" />
          {mode === "absolute" && (
            <text x={us > 1700 ? x(us) - 6 : x(us) + 6} y={23} className="adj-text strong" textAnchor={us > 1700 ? "end" : "start"}>
              {adjAbsoluteValue(row, us)}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}
