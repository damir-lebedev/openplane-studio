// «Режимы»: режимы на тумблерах как вкладка Modes в BF — у каждого режима
// диапазоны (канал AUX, от–до), живая метка канала и подсветка «включён».
// Своя таблица aux заменяет тумблеры прошивки целиком: при первой правке
// приложение переносит их в таблицу, чтобы ARM не пропал.

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { AuxRow, auxCommand, auxLabel, clearAuxCommand, freeAuxSlot, MAIN_MODES } from "../../core/copterParams";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, useCopterBoard, useCopterLink, useCopterLive } from "./common";

const MODE_HINTS: Record<number, string> = {
  0: "моторы включены; ExpressLRS передаёт без задержки только AUX1",
  1: "самовыравнивание: стик — угол, отпустил — ровно",
  2: "как ANGLE у центра, у края стика — флипы",
  13: "пищит, чтобы найти упавший коптер",
  27: "сразу failsafe — проверка без выключения пульта",
  28: "моторы держат управление на нуле газа",
};

export function ModesTab() {
  return (
    <NeedBoard>
      <ModesBody />
    </NeedBoard>
  );
}

function ModesBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const [extra, setExtra] = useState<number[]>([]);
  const rc = board.rc;
  if (!rc) return null;
  const rows = rc.usingFallback ? rc.fallback : rc.aux;
  const auxCount = Math.max(1, (rc.channels || 8) - 4);
  const active = new Set(live?.modes ?? []);

  // Первая правка своей таблицы: тумблеры прошивки — в таблицу, иначе они пропадут.
  const ensureOwn = async () => {
    if (!rc.usingFallback) return;
    for (const r of rc.fallback) await cmd(auxCommand(r));
  };
  const write = async (r: AuxRow) => {
    await ensureOwn();
    await cmd(auxCommand(r));
  };
  const remove = async (slot: number) => {
    await ensureOwn();
    await cmd(clearAuxCommand(slot));
  };
  const add = async (mode: number) => {
    await ensureOwn();
    const slot = freeAuxSlot(rc.usingFallback ? rc.fallback : rc.aux);
    if (slot >= 0) await cmd(auxCommand([slot, mode, 0, 1700, 2100, 0, 0]));
  };

  const used = new Set(rows.map((r) => r[1]));
  const shownModes = board.modes
    .filter(([id, , works]) => works && (used.has(id) || MAIN_MODES.includes(id) || extra.includes(id)))
    .sort((a, b) => (MAIN_MODES.indexOf(a[0]) + 100) % 100 - (MAIN_MODES.indexOf(b[0]) + 100) % 100);
  const others = board.modes.filter(([id, , works]) => works && !shownModes.some((m) => m[0] === id));

  return (
    <div className="modes">
      {rc.usingFallback && (
        <div className="card">
          <p className="sub" style={{ margin: 0 }}>
            {t("Сейчас действуют тумблеры прошивки (CopterConfig.h). Первая правка перенесёт их в таблицу платы — дальше всё здесь.")}
          </p>
        </div>
      )}
      {shownModes.map(([id, name]) => {
        const ranges = rows.filter((r) => r[1] === id);
        return (
          <div key={id} className={`card mode-card${active.has(id) ? " on" : ""}`}>
            <div className="mode-head">
              <div>
                <h3>{name}</h3>
                {MODE_HINTS[id] && <div className="hint">{t(MODE_HINTS[id])}</div>}
              </div>
              <span className={`pill${active.has(id) ? " ok" : ""}`}>{active.has(id) ? t("включён") : t("выключен")}</span>
            </div>
            {ranges.length === 0 && <p className="hint">{t("Не на тумблере.")}</p>}
            {ranges.map((r) => (
              <RangeRow key={r[0]} row={r} auxCount={auxCount} us={live?.ch[r[2] + 4]} disabled={armed} onChange={(n) => void write(n)} onRemove={() => void remove(r[0])} />
            ))}
            <button className="btn ghost small" disabled={armed} onClick={() => void add(id)}>
              <Plus size={14} />
              {t("Диапазон")}
            </button>
          </div>
        );
      })}
      {others.length > 0 && (
        <div className="card">
          <div className="row" style={{ gap: 8 }}>
            <span className="grow hint">{t("Ещё режимы:")}</span>
            <select className="select" value="" onChange={(e) => setExtra([...extra, Number(e.target.value)])}>
              <option value="">{t("добавить…")}</option>
              {others.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

const MIN_US = 900;
const MAX_US = 2100;
const pct = (us: number) => ((us - MIN_US) / (MAX_US - MIN_US)) * 100;
const snap = (us: number) => Math.round(us / 25) * 25;

function RangeRow({
  row,
  auxCount,
  us,
  disabled,
  onChange,
  onRemove,
}: {
  row: AuxRow;
  auxCount: number;
  us?: number;
  disabled: boolean;
  onChange: (r: AuxRow) => void;
  onRemove: () => void;
}) {
  const [, , ch, from, to] = row;
  const inside = us !== undefined && us >= from && us < to;
  const set = (i: number, v: number) => {
    const next = [...row] as AuxRow;
    next[i] = v;
    if (next[4] <= next[3]) return;
    onChange(next);
  };
  return (
    <div className="range-row">
      <select className="select" style={{ width: 96 }} disabled={disabled} value={ch} onChange={(e) => set(2, Number(e.target.value))}>
        {Array.from({ length: auxCount }, (_, i) => (
          <option key={i} value={i}>
            {auxLabel(i)}
          </option>
        ))}
      </select>
      <div className="range-track">
        <div className={`range-band${inside ? " on" : ""}`} style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` }} />
        {us !== undefined && <div className="range-mark" style={{ left: `${pct(Math.max(MIN_US, Math.min(MAX_US, us)))}%` }} title={`${us}`} />}
        <span className="range-scale" style={{ left: `${pct(1000)}%` }}>1000</span>
        <span className="range-scale" style={{ left: `${pct(1500)}%` }}>1500</span>
        <span className="range-scale" style={{ left: `${pct(2000)}%` }}>2000</span>
      </div>
      <input className="input compact" style={{ width: 64 }} disabled={disabled} type="number" step={25} min={MIN_US} max={MAX_US} defaultValue={from} key={`f${from}`} onBlur={(e) => set(3, snap(Number(e.target.value)))} />
      <input className="input compact" style={{ width: 64 }} disabled={disabled} type="number" step={25} min={MIN_US} max={MAX_US} defaultValue={to} key={`t${to}`} onBlur={(e) => set(4, snap(Number(e.target.value)))} />
      <span className="mono hint" style={{ width: 40 }}>
        {us ?? "—"}
      </span>
      <button className="btn ghost small" disabled={disabled} title={t("Убрать диапазон")} onClick={onRemove}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}
