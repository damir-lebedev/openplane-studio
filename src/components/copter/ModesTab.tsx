// «Режимы»: режимы на тумблерах как вкладка Modes в BF — у каждого режима
// диапазоны (канал AUX, от–до), живая метка канала и подсветка «включён».
// Своя таблица aux заменяет тумблеры прошивки целиком: при первой правке
// приложение переносит их в таблицу, чтобы ARM не пропал. У FLIP OVER
// AFTER CRASH (turtle mode) — схема: какие моторы закрутятся от стиков пульта.
// Внизу — команды стиками картинками (калибровки, профили, горизонт; ARM
// стиками — если ARM нет в таблице).

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { gimbals, STICK_ARM, STICK_COMBOS, StickCombo } from "../../core/beeper";
import { AuxRow, auxCommand, auxLabel, clearAuxCommand, freeAuxSlot, MAIN_MODES } from "../../core/copterParams";
import { sticksFromChannels, turtleMix } from "../../core/turtle";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamRow, useCopterBoard, useCopterLink, useCopterLive } from "./common";
import { FrameDiagram } from "./MotorsTab";

const TURTLE_MODE = 35;

const MODE_HINTS: Record<number, string> = {
  0: N_("моторы включены; ExpressLRS передаёт без задержки только AUX1"),
  1: N_("самовыравнивание: стик — угол, отпустил — ровно"),
  2: N_("как ANGLE у центра, у края стика — флипы"),
  13: N_("пищит, чтобы найти упавший коптер (и моторами — вкладка «Пищалка»)"),
  37: N_("пищит числом спутников GPS"),
  51: N_("команды стиками не работают (ARM стиками — работает)"),
  27: N_("сразу failsafe — проверка без выключения пульта"),
  28: N_("моторы держат управление на нуле газа"),
  35: N_("turtle mode: упал на спину — ARM с этим режимом, и стик переворачивает коптер моторами (только DShot)"),
  46: N_("возврат домой по GPS — как при потере связи (схема — вкладка «GPS»)"),
  47: N_("ACRO с ограничением наклона — учиться акро (предел — «PID» → acro_trainer_angle_limit)"),
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
            {id === TURTLE_MODE && <TurtlePreview />}
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
      <StickCommandsCard armFromSticks={!rows.some((r) => r[1] === 0)} />
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

// Команды стиками, как в BF: две ручки пульта (Mode 2) на каждую команду.
function StickCommandsCard({ armFromSticks }: { armFromSticks: boolean }) {
  const board = useCopterBoard();
  const combos = armFromSticks ? [...STICK_ARM, ...STICK_COMBOS] : STICK_COMBOS;
  return (
    <div className="card">
      <h3>{t("Команды стиками")}</h3>
      <p className="sub">
        {t("Без ARM: поставьте стики в углы, как на картинке, и подержите — плата пискнет в ответ (профиль N — N раз). Газ слева (Mode 2).")}
        {armFromSticks && " " + t("ARM нет в таблице режимов — армится стиками, как в Betaflight.")}
      </p>
      <div className="stick-combos">
        {combos.map((c, i) => (
          <div key={i} className="stick-combo">
            <Gimbals combo={c} />
            <div className="hint">
              {t(c.title)}
              {c.when === "level" && <span className="prow-scope">ANGLE</span>}
              {c.when === "acro" && <span className="prow-scope">ACRO</span>}
            </div>
          </div>
        ))}
      </div>
      {board.params.min_check && <ParamRow p={board.params.min_check} title={t("Стик ниже — «низ»")} />}
      {board.params.max_check && <ParamRow p={board.params.max_check} title={t("Стик выше — «верх»")} />}
    </div>
  );
}

function Gimbals({ combo }: { combo: StickCombo }) {
  const g = gimbals(combo);
  const box = (x0: number, [x, y]: [number, number]) => (
    <g>
      <rect x={x0} y={2} width={36} height={36} rx={6} className="gimbal-box" />
      <line x1={x0 + 20} y1={20} x2={x0 + 20 + x * 13} y2={20 - y * 13} className="gimbal-line" />
      <circle cx={x0 + 20 + x * 13} cy={20 - y * 13} r={4} className="gimbal-dot" />
    </g>
  );
  return (
    <svg viewBox="0 0 84 40" width={84} height={40}>
      {box(0, g.left)}
      {box(46, g.right)}
    </svg>
  );
}

// Turtle mode: схема рамы — какие моторы закрутятся (наоборот) от стиков
// пульта прямо сейчас; сила — по crashflip_expo и crashflip_motor_percent.
function TurtlePreview() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const motors = board.header?.frame?.motors ?? [];
  if (!motors.length) return null;
  const expo = Number(board.params.crashflip_expo?.value ?? 35) / 100;
  const other = Number(board.params.crashflip_motor_percent?.value ?? 0) / 100;
  const sticks = live ? sticksFromChannels(live.ch, board.rc?.map ?? "AETR1234") : { roll: 0, pitch: 0, yaw: 0 };
  const out = turtleMix(motors, sticks.roll, sticks.pitch, sticks.yaw, expo, other);
  const flipping = out.some((v) => v > 0);
  return (
    <div className="turtle">
      {board.header?.dshotCommands === false && (
        <p className="hint warn-text">{t("Регуляторы не DShot: крутить наоборот их нечем — режим ничего не делает.")}</p>
      )}
      <div className="turtle-body">
        <FrameDiagram motors={motors} out={out} size={170} reversed />
        <div className="turtle-text">
          <p className="hint">
            {t("Коптер лежит на спине: включите режим и ARM (наклон не проверяется). Стик вправо — крутятся правые моторы, и коптер встаёт через левый бок; от себя — передние; по диагонали — один угол; рысканье — пара моторов, развернуться на месте. Газ не нужен.")}
          </p>
          <p className="hint">
            {live?.turtle
              ? t("Сейчас заармлен в turtle mode: моторы крутятся наоборот. Перевернулся — DISARM, режим выключить, ARM как обычно.")
              : live
                ? flipping
                  ? t("Со стиками как сейчас закрутились бы моторы на схеме.")
                  : t("Отклоните стик — схема покажет, какие моторы закрутятся.")
                : t("Подключите пульт — схема покажет моторы от стиков.")}
          </p>
        </div>
      </div>
      {board.params.crashflip_expo && <ParamRow p={board.params.crashflip_expo} title={t("Экспо стика")} />}
      {board.params.crashflip_motor_percent && <ParamRow p={board.params.crashflip_motor_percent} title={t("Остальные моторы")} />}
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
