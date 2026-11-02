// «Пищалка»: что пищит (условия Betaflight галочками, «послушать» — плата
// пискнет этим рисунком), маяк моторами DShot (найти коптер в траве),
// пищалка на плате (уровень, открытый сток, частота пассивной). Команды
// стиками — схема на вкладке «Режимы».

import { Volume2 } from "lucide-react";

import { BEACON_CONDITIONS, BEEPER_CONDITIONS, isOn, toggled } from "../../core/beeper";
import { tabParams } from "../../core/copterParams";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamList, ParamRow, useCopterBoard, useCopterLink } from "./common";

const MASKS = ["beeper_off_flags", "dshot_beacon_off_flags", "beeper_dshot_beacon_tone"];

export function BeeperTab() {
  return (
    <NeedBoard>
      <BeeperBody />
    </NeedBoard>
  );
}

function BeeperBody() {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const off = Number(board.params.beeper_off_flags?.value ?? 0);
  const beaconOff = Number(board.params.dshot_beacon_off_flags?.value ?? 514);
  const tone = board.params.beeper_dshot_beacon_tone;
  const dshot = board.header?.dshotCommands !== false;
  const error = board.errors.beep;
  return (
    <div className="copter-grid">
      <div className="card wide">
        <h3>{t("Что пищит")}</h3>
        <p className="sub">
          {t("Условия как «beeper» в Betaflight. Снимите галочку — этого писка не будет. «Послушать» — плата пискнет так, как пищит это условие (без ARM).")}
        </p>
        {error && <p className="hint warn-text">{error}</p>}
        <div className="beeper-list">
          {BEEPER_CONDITIONS.map((c) => {
            const on = isOn(off, c.n);
            const beacon = BEACON_CONDITIONS.includes(c.name);
            return (
              <div key={c.name} className={`beeper-row${c.kind === "never" ? " dim" : ""}`} data-param="beeper_off_flags">
                <label className="row grow" style={{ gap: 8 }}>
                  <input type="checkbox" checked={on} disabled={armed} onChange={(e) => void set("beeper_off_flags", toggled(off, c.n, e.target.checked))} />
                  <span>
                    <span className="mono">{c.name}</span>
                    <span className="hint"> — {t(c.text)}</span>
                  </span>
                </label>
                {beacon && (
                  <label className="row hint" style={{ gap: 6 }} title={t("Регуляторы DShot пищат моторами — слышно издалека")} data-param="dshot_beacon_off_flags">
                    <input type="checkbox" checked={isOn(beaconOff, c.n)} disabled={armed || !dshot} onChange={(e) => void set("dshot_beacon_off_flags", toggled(beaconOff, c.n, e.target.checked))} />
                    {t("и моторами")}
                  </label>
                )}
                {c.kind !== "never" && (
                  <button className="btn ghost small" disabled={armed} title={t("Послушать")} onClick={() => void cmd(`beep ${c.name}`)}>
                    <Volume2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <h3>{t("Маяк моторами")}</h3>
        <p className="sub">
          {t("Упал в траву — выключите пульт (RX_LOST) или включите режим BEEPER (RX_SET): регуляторы DShot пищат моторами, громче пищалки. Только без ARM и через 1.2 с после DISARM; ARM после маяка — через 1.2 с.")}
        </p>
        {!dshot && <p className="hint warn-text">{t("Регуляторы не DShot — маяка моторами нет.")}</p>}
        {tone && <ParamRow p={tone} title={t("Тон")} />}
        <button className="btn ghost small" disabled={armed || !dshot} onClick={() => void cmd(`dshot all ${tone?.value ?? 1}`)}>
          <Volume2 size={14} />
          {t("Пискнуть моторами (без пропеллеров не обязательно — моторы не крутятся)")}
        </button>
      </div>
      <ParamList title={t("Пищалка на плате")} sub={t("Обычно менять не нужно: умолчание — от платы.")} params={tabParams(board, "beeper", MASKS)} />
    </div>
  );
}
