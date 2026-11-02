// «Готов к полёту» (P08): список перед вылетом в «Подготовке» и строка,
// которую до ARM покажут очки.

import { CircleCheck, CircleHelp, CircleX, Glasses } from "lucide-react";
import { useState } from "react";

import { preflight, preflightOsd, preflightReady } from "../../core/preflight";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { useCopterBoard, useCopterLive } from "./common";
import { FrameDiagram } from "./MotorsTab";

export function PreflightCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const [props, setProps] = useState(false);
  const failsafeChecked = useApp((s) => !!s.currentCopter()?.failsafeCheckedAt);
  if (!live || live.arm) return null;
  const rc = board.rc;
  const items = preflight(live, rc ? (rc.usingFallback ? rc.fallback : rc.aux) : [], props, failsafeChecked);
  const ready = preflightReady(items);
  const motors = board.header?.frame?.motors ?? [];
  return (
    <div className="card wide preflight">
      <h3>{ready ? t("Готов к полёту") : t("Перед полётом")}</h3>
      <div className="preflight-body">
        <div className="preflight-list">
          {items.map((x) => (
            <div key={x.id} className={`preflight-item ${x.ok === true ? "ok" : x.ok === false ? "bad" : "ask"}`}>
              {x.ok === true ? <CircleCheck size={17} /> : x.ok === false ? <CircleX size={17} /> : <CircleHelp size={17} />}
              {x.id === "props" ? (
                <label className="grow">
                  <input type="checkbox" checked={props} onChange={(e) => setProps(e.target.checked)} /> {t(x.text)}
                </label>
              ) : (
                <span className="grow">{t(x.text, x.vars)}</span>
              )}
            </div>
          ))}
          <div className="preflight-osd">
            <Glasses size={16} />
            <span className="hint">{t("В очках до ARM:")}</span>
            <span className="mono">{preflightOsd(live)}</span>
          </div>
        </div>
        {motors.length > 0 && <FrameDiagram motors={motors} size={170} />}
      </div>
    </div>
  );
}
