// «Настройка полёта» (режим «Новичок»): шесть ползунков понятными словами —
// без единого имени настройки. Под ними — запас устойчивости (прошивка
// пересчитывает его на каждую правку) и кривая «стик → скорость вращения».
// Каждый ползунок — одна или несколько настроек (core/copterParams.ts
// sliderCommands); посередине — «как из коробки», посчитанное из модели.

import { RotateCcw } from "lucide-react";

import { CopterBoard, flightSliders, FlightSlider, ParamValue, SLIDER_PARAMS, sliderCommands, sliderText, sliderValue } from "../../core/copterParams";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { CommitRange, MarginBar, NeedBoard, useCopterBoard, useCopterLink } from "./common";
import { RateChart } from "./TuneTabs";

export function FlightTab() {
  return (
    <NeedBoard>
      <FlightBody />
    </NeedBoard>
  );
}

function send(cmds: [string, ParamValue][]) {
  const set = useApp.getState().copterSet;
  for (const [name, v] of cmds) void set(name, v);
}

/** Всё, из чего складывается ползунок, — к умолчаниям. */
function resetCommands(b: CopterBoard, id: FlightSlider["id"]): [string, ParamValue][] {
  return SLIDER_PARAMS[id].filter((n) => b.params[n] && String(b.params[n].value) !== String(b.params[n].default)).map((n) => [n, b.params[n].default]);
}

function FlightBody() {
  const board = useCopterBoard();
  const { armed } = useCopterLink();
  const sliders = flightSliders(board);
  const changed = sliders.filter((s) => resetCommands(board, s.id).length > 0);
  return (
    <div className="copter-grid">
      <div className="card wide">
        <div className="row" style={{ gap: 12 }}>
          <h3 className="grow" style={{ margin: 0 }}>
            {t("Настройка полёта")}
          </h3>
          <button className="btn ghost small" disabled={armed || !changed.length} onClick={() => changed.forEach((s) => send(resetCommands(board, s.id)))}>
            <RotateCcw size={14} />
            {t("Как из коробки")}
          </button>
        </div>
        <p className="sub">{t("Всё уже посчитано из описания коптера — летать можно сразу. Двигайте по одному ползунку и пробуйте в полёте; после — «Сохранить» вверху.")}</p>
        {!sliders.length && <p className="hint warn-text">{t("Прошивка на плате старая — ползунков в ней нет. Обновите её кнопкой «Прошить».")}</p>}
        <div className="flight-sliders">
          {sliders.map((s) => (
            <FlightSliderRow key={s.id} s={s} board={board} disabled={armed} />
          ))}
        </div>
      </div>
      <div className="card">
        <h3>{t("Устойчивость")}</h3>
        <MarginBar margin={board.header?.margin} />
        <p className="hint">{t("Отзывчивость и фильтры двигают запас: чем правее, тем коптер точнее, но ближе к дрожи. Красное — не летать, сдвиньте назад.")}</p>
      </div>
      <div className="card">
        <h3>{t("Стик → скорость вращения")}</h3>
        <RateChart board={board} />
      </div>
    </div>
  );
}

function FlightSliderRow({ s, board, disabled }: { s: FlightSlider; board: CopterBoard; disabled: boolean }) {
  const value = sliderValue(board, s.id);
  const def = sliderValue(board, s.id, "default");
  return (
    <div className="flight-slider">
      <div className="row" style={{ gap: 8 }}>
        <b className="grow">{t(s.title)}</b>
        <span className="mono">{sliderText(s, value)}</span>
        {Math.round(value) !== Math.round(def) && <span className="hint">{t("из коробки {v}", { v: sliderText(s, def) })}</span>}
      </div>
      <div className="row flight-track" style={{ gap: 10 }}>
        <span className="hint">{t(s.left)}</span>
        <CommitRange label={t(s.title)} value={value} min={s.min} max={s.max} step={s.step} disabled={disabled} onCommit={(v) => send(sliderCommands(board, s.id, v))} />
        <span className="hint">{t(s.right)}</span>
      </div>
      <p className="hint">{t(s.hint)}</p>
    </div>
  );
}
