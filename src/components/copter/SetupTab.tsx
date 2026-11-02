// «Подготовка»: как стоит коптер (горизонт), можно ли армить и почему нет,
// калибровки (клавиши консоли платы: i, o, c) и ответ платы на них.

import { CircleCheck, Compass, Crosshair, Gauge } from "lucide-react";

import { api, errorText } from "../../api";
import { ARM_BENCH_OK } from "../../core/copterParams";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Horizon } from "../live/LiveWidgets";
import { ArmWhyList } from "./ArmWhy";
import { NeedBoard, useCopterLink, useCopterLive } from "./common";
import { PreflightCard } from "./Preflight";
import { GoTo } from "./Search";

const CALIBRATIONS: { key: string; title: string; hint: string; icon: typeof Gauge }[] = [
  { key: "i", title: "Гироскоп", hint: "коптер неподвижен ~2 с; делается и сама при каждом включении", icon: Gauge },
  {
    key: "o",
    title: "Установка платы",
    hint: "три позы по подсказкам ниже: ровно, нос вверх, правый борт вниз — как плата стоит в раме",
    icon: Crosshair,
  },
  { key: "c", title: "Компас", hint: "15 с вращать коптер по всем осям; нужен модуль GPS с компасом", icon: Compass },
];

export function SetupTab({ onGo }: { onGo?: GoTo }) {
  return (
    <NeedBoard>
      <SetupBody onGo={onGo} />
    </NeedBoard>
  );
}

function SetupBody({ onGo }: { onGo?: GoTo }) {
  const live = useCopterLive();
  const blocks = live?.block ?? [];
  const serious = blocks.filter((b) => !ARM_BENCH_OK.includes(b));

  return (
    <div className="copter-grid">
      <PreflightCard />
      <div className="card">
        <h3>{t("Как стоит коптер")}</h3>
        <div className="row" style={{ gap: 18, alignItems: "center" }}>
          <Horizon roll={live?.att[0]} pitch={live?.att[1]} size={170} />
          <div className="kv">
            <span>{t("Крен")}</span>
            <span className="mono">{live ? `${live.att[0].toFixed(1)}°` : "—"}</span>
            <span>{t("Тангаж")}</span>
            <span className="mono">{live ? `${live.att[1].toFixed(1)}°` : "—"}</span>
            <span>{t("Курс")}</span>
            <span className="mono">{live ? `${Math.round(live.hdg)}°` : "—"}</span>
            <span>{t("Высота")}</span>
            <span className="mono">{live ? `${live.alt.toFixed(1)} ${t("м")}` : "—"}</span>
          </div>
        </div>
        <p className="hint">{t("Наклоните коптер вправо — горизонт должен уйти влево, крен — стать больше нуля; нос вверх — тангаж больше нуля. Не так — откалибруйте установку платы.")}</p>
      </div>

      <div className="card">
        <h3>{t("Можно ли армить")}</h3>
        {!live && <p className="muted">{t("Жду живые кадры с платы…")}</p>}
        {live && blocks.length === 0 && (
          <div className="issue ok">
            <CircleCheck size={17} color="var(--ok)" />
            <div>{live.arm ? t("Заармлен — моторы крутятся!") : t("Ничего не мешает: ARM — тумблером.")}</div>
          </div>
        )}
        <ArmWhyList codes={blocks} armed={!!live?.arm} onGo={onGo} />
        {live && serious.length === 0 && blocks.length > 0 && <p className="hint">{t("Оставшееся — обычное дело на столе: газ, тумблер ARM, первые секунды после включения.")}</p>}
        {live && (
          <div className="kv" style={{ marginTop: 10 }}>
            <span>{t("Режим")}</span>
            <span className="mono">{live.mode}</span>
            <span>{t("Пульт")}</span>
            <span className="mono">
              {live.rx === "ok" ? t("на связи") : live.rx === "fs" ? "FAILSAFE" : t("нет связи")}
              {live.lq !== undefined ? ` · LQ ${live.lq}%` : ""}
            </span>
            <span>{t("Батарея")}</span>
            <span className="mono">
              {live.v > 0.5 ? `${live.v.toFixed(2)} ${t("В")}${live.cell ? ` · ${live.cell.toFixed(2)} ${t("В/банка")}` : ""}${live.bat ? ` · ${live.bat}` : ""}` : t("нет (питание от USB)")}
            </span>
            <span>{t("Цикл")}</span>
            <span className="mono">
              {live.hz} {t("Гц")} · CPU {live.cpu}%
            </span>
            {live.gps && (
              <>
                <span>GPS</span>
                <span className="mono">
                  {live.gps.fix ? t("фикс") : t("нет фикса")} · {live.gps.sats} {t("спутн.")}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <Calibrations />
    </div>
  );
}

/** Калибровки клавишами консоли платы и её ответ. */
export function Calibrations() {
  const lines = useApp((s) => s.consoleLines);
  const toast = useApp((s) => s.toast);
  const { armed } = useCopterLink();
  const calibrate = async (key: string) => {
    try {
      await api.linkSend(key);
    } catch (e) {
      toast("err", errorText(e));
    }
  };
  return (
    <div className="card wide">
      <h3>{t("Калибровки")}</h3>
      <p className="sub">{t("Калибровки хранятся на плате отдельно от настроек и прошивки — перепрошивка их не стирает.")}</p>
      <div className="calib-grid">
        {CALIBRATIONS.map((c) => (
          <div key={c.key} className="calib">
            <c.icon size={20} color="var(--accent)" />
            <div className="grow">
              <div>{t(c.title)}</div>
              <div className="hint">{t(c.hint)}</div>
            </div>
            <button className="btn" disabled={armed} onClick={() => void calibrate(c.key)}>
              {t("Начать")}
            </button>
          </div>
        ))}
      </div>
      <div className="cli console-tail">
        {lines.slice(-10).map((l, i) => (
          <div key={i} className="mono">
            {l}
          </div>
        ))}
        {!lines.length && <div className="hint">{t("Ответы платы появятся здесь.")}</div>}
      </div>
    </div>
  );
}
