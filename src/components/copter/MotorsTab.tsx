// «Моторы»: схема рамы (номера как в Betaflight, куда крутится каждый),
// проверка моторов ползунками — только с подтверждением «пропеллеры сняты»;
// команда повторяется каждые 0,4 с, плата держит её 1 с: приложение
// закрылось или связь пропала — моторы встали сами. У регуляторов DShot —
// направление мотора и «пискнуть» командой (dshot N 7|8 12, как мастер
// направления конфигуратора BF): мотор выбирается кликом по схеме.

import { TriangleAlert, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FrameMotor, tabParams } from "../../core/copterParams";
import { t } from "../../i18n";
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

function MotorsBody() {
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

  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Рама")}</h3>
        <FrameDiagram motors={motors} out={live?.motors} reversed={!!live?.turtle} selected={dshot ? picked : undefined} onPick={dshot ? setPicked : undefined} />
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

      {dshot && <DirectionCard motors={motors} picked={picked} busy={armed || spinning} />}

      <div className="wide">
        <ParamList title={t("Моторы и регуляторы")} params={tabParams(board, "motors")} />
      </div>
    </div>
  );
}

/** Где мотор на раме, словами: «передний правый». */
export function motorWhere(m: FrameMotor): string {
  const fore = m[0] > 0.2 ? t("передний") : m[0] < -0.2 ? t("задний") : "";
  const side = m[1] > 0.2 ? t("правый") : m[1] < -0.2 ? t("левый") : "";
  return [fore, side].filter(Boolean).join(" ") || t("в центре");
}

// Направление мотора командой DShot: «обычное» (7) или «обратное» (8) и
// «сохранить» (12) — регулятор запоминает; «пискнуть» (1) — найти мотор.
function DirectionCard({ motors, picked, busy }: { motors: FrameMotor[]; picked: number; busy: boolean }) {
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
}: {
  motors: FrameMotor[];
  out?: number[];
  size?: number;
  reversed?: boolean;
  selected?: number;
  onPick?: (i: number) => void;
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
              {reversed ? (level > 0 ? t("наоборот") : t("стоит")) : cw ? t("по часовой") : t("против")}
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
