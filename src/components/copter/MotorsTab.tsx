// «Моторы»: схема рамы (номера как в Betaflight, куда крутится каждый),
// проверка моторов ползунками — только с подтверждением «пропеллеры сняты»;
// команда повторяется каждые 0,4 с, плата держит её 1 с: приложение
// закрылось или связь пропала — моторы встали сами.

import { TriangleAlert } from "lucide-react";
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

  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Рама")}</h3>
        <FrameDiagram motors={motors} out={live?.motors} />
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

      <div className="wide">
        <ParamList title={t("Моторы и регуляторы")} params={tabParams(board, "motors")} />
      </div>
    </div>
  );
}

/** Рама сверху: x — к носу (вверх на картинке), y — вправо. */
function FrameDiagram({ motors, out }: { motors: FrameMotor[]; out?: number[] }) {
  const size = 260;
  const c = size / 2;
  const arm = 88;
  const pos = (m: FrameMotor) => ({ x: c + m[1] * arm, y: c - m[0] * arm });
  return (
    <svg className="frame-svg" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <polygon points={`${c},${c - 34} ${c - 12},${c - 14} ${c + 12},${c - 14}`} className="frame-nose" />
      {motors.map((m, i) => {
        const p = pos(m);
        return <line key={`a${i}`} x1={c} y1={c} x2={p.x} y2={p.y} className="frame-arm" />;
      })}
      <rect x={c - 22} y={c - 22} width={44} height={44} rx={8} className="frame-body" />
      {motors.map((m, i) => {
        const p = pos(m);
        const level = out ? Math.max(0, Math.min(1, out[i] ?? 0)) : 0;
        const cw = m[2] === "cw";
        return (
          <g key={i} transform={`translate(${p.x} ${p.y})`}>
            <circle r={30} className="frame-prop" style={{ fillOpacity: 0.08 + level * 0.6 }} />
            <path d={cw ? "M -18 -18 A 26 26 0 0 1 18 -18" : "M 18 -18 A 26 26 0 0 0 -18 -18"} className="frame-spin" markerEnd="url(#arrow)" />
            <text y={6} textAnchor="middle" className="frame-num">
              {i + 1}
            </text>
            <text y={46} textAnchor="middle" className="frame-dir">
              {cw ? t("по часовой") : t("против")}
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
