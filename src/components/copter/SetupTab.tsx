// «Подготовка»: как стоит коптер (горизонт), можно ли армить и почему нет,
// калибровки (клавиши консоли платы: i, o) и ответ платы на них, компас —
// мастером со сферой точек (CompassCard).

import { CircleCheck, Crosshair, Gauge } from "lucide-react";
import { Fragment } from "react";

import { api, errorText } from "../../api";
import { ARM_BENCH_OK } from "../../core/copterParams";
import { gyroReport } from "../../core/gyros";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Horizon } from "../live/LiveWidgets";
import { ArmWhyList } from "./ArmWhy";
import { CompassCard } from "./CompassCard";
import { NeedBoard, ParamRow, useCopterBoard, useCopterLink, useCopterLive } from "./common";
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
            {live?.gbias && (
              <>
                <span title={t("Фильтр ориентации сам находит, на сколько врёт нуль гироскопа, и вычитает это. Рысканье без компаса не видно.")}>{t("Нуль гироскопа")}</span>
                <span className="mono">
                  {live.gbias.slice(0, 2).map((b) => (b >= 0 ? "+" : "") + b.toFixed(2)).join(" / ")} {t("°/с")}
                </span>
                <span title={t("Насколько фильтр ориентации сейчас верит акселерометру: на манёвре — почти нет, в спокойном висении и на земле — полностью.")}>{t("Вера акселерометру")}</span>
                <span className="mono">{live.atrust ?? 0}%</span>
              </>
            )}
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

      <GyrosCard />
      <Calibrations />
      <CompassCard />
    </div>
  );
}

/** Два гироскопа на плате (SLIM V4): какой в деле, запасной, выбор gyro_to_use. Один — карточки нет. */
function GyrosCard() {
  const live = useCopterLive();
  const board = useCopterBoard();
  if (!live?.gyros) return null;
  const r = gyroReport(live.gyros);
  const p = board.params["gyro_to_use"];
  const color = (tone: string) => (tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : undefined);
  return (
    <div className="card" data-card="gyros">
      <h3>{t("Гироскопы")}</h3>
      <div className="kv">
        {r.lines.map((l) => (
          <Fragment key={l.name}>
            <span>{t(l.name)}</span>
            <span className="mono" style={{ color: color(l.tone) }}>
              {t(l.state)}
            </span>
          </Fragment>
        ))}
      </div>
      {r.hint && (
        <p className="hint" style={{ color: color(r.hintTone) }}>
          {t(r.hint)}
        </p>
      )}
      {p && <ParamRow p={p} title={t("Какой гироскоп брать")} />}
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
