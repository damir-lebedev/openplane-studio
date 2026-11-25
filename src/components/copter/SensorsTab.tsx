// «Датчики» (P61): что прямо сейчас шлют гироскоп, акселерометр, барометр,
// компас и GPS — числа и графики за 10 с, как Sensors в Betaflight. Числа —
// из живого кадра ("sens", "mag", "gps" — CopterLink.h прошивки).

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CopterLive } from "../../api";
import { accVerdict, emptyTrace, magnitude, pushTrace, Trace, tracePath, traceRange, traceStats } from "../../core/sensorTrace";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, useCopterLive } from "./common";

const W = 520;
const H = 120;
const AXES3 = [N_("X · крен"), N_("Y · тангаж"), N_("Z · рысканье")];
const ACC_AXES = [N_("X · к носу"), N_("Y · влево"), N_("Z · вверх")];
const MAG_AXES = ["X", "Y", "Z"];

interface Traces {
  gyro: Trace;
  acc: Trace;
  baro: Trace;
  mag: Trace;
}

const empty = (): Traces => ({ gyro: emptyTrace(3), acc: emptyTrace(3), baro: emptyTrace(1), mag: emptyTrace(3) });

export function SensorsTab() {
  return (
    <NeedBoard>
      <SensorsBody />
    </NeedBoard>
  );
}

function useTraces(live: CopterLive | null, paused: boolean): Traces {
  const at = useApp((s) => s.cliveAt);
  const [tr, setTr] = useState<Traces>(empty);
  const last = useRef(0);
  useEffect(() => {
    if (!live || paused || at === last.current) return;
    last.current = at;
    const s = live.sens;
    setTr((p) => ({
      gyro: s ? pushTrace(p.gyro, at, s.g) : p.gyro,
      acc: s ? pushTrace(p.acc, at, s.a) : p.acc,
      baro: s?.baro ? pushTrace(p.baro, at, [s.baro[2]]) : p.baro,
      mag: live.mag ? pushTrace(p.mag, at, live.mag.raw) : p.mag,
    }));
  }, [live, at, paused]);
  return tr;
}

function SensorsBody() {
  const live = useCopterLive();
  const [paused, setPaused] = useState(false);
  const tr = useTraces(live, paused);
  const s = live?.sens;
  const still = !!live && !live.arm;

  if (live && !s) {
    return (
      <div className="card">
        <h3>{t("Датчики")}</h3>
        <p className="sub">{t("Прошивка на плате старее приложения и не шлёт показания датчиков. Обновите прошивку на вкладке «Коптер».")}</p>
      </div>
    );
  }

  const acc = accVerdict(s?.a, still);
  return (
    <div className="copter-grid sensors-tab">
      <div className="card sensors-head">
        <h3>{t("Что видят датчики")}</h3>
        <div className="sensors-present">
          <Present name={t("Гироскоп")} on={!!s?.ok} />
          <Present name={t("Акселерометр")} on={!!s?.ok} />
          <Present name={t("Барометр")} on={!!s?.baro} />
          <Present name={t("Компас")} on={!!live?.mag} />
          <Present name={t("GPS")} on={!!live?.gps} />
        </div>
        <p className="hint">
          {t("Оси — рамы коптера, после поворота платы (align_board_*) и нуля акселерометра. Питот (датчик воздушной скорости) коптеру не нужен — скорость берётся по GPS.")}
        </p>
        <button className="btn" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={15} /> : <Pause size={15} />}
          {paused ? t("Дальше") : t("Пауза")}
        </button>
      </div>

      <TraceCard
        title={t("Гироскоп")}
        units={t("°/с")}
        trace={tr.gyro}
        axes={AXES3}
        minSpan={4}
        digits={1}
        extra={s?.it !== undefined ? `${t("чип")} ${s.it.toFixed(0)} °C` : undefined}
        note={still ? t("На столе все три оси должны стоять у нуля, шум — в пределах ±0.5 °/с. Покрутите коптер рукой — линия отвечает своей оси.") : undefined}
      />
      <TraceCard
        title={t("Акселерометр")}
        units="g"
        trace={tr.acc}
        axes={ACC_AXES}
        minSpan={0.4}
        digits={3}
        extra={s ? `|a| = ${magnitude(s.a).toFixed(3)} g` : undefined}
        note={
          acc === "off"
            ? t("Коптер стоит, а полная перегрузка далека от 1 g: акселерометр врёт или коптер трясут — проверьте нуль на «Подготовке».")
            : still
              ? t("Ровно на столе: Z ≈ +1 g, X и Y ≈ 0. Нос вверх — X к +1 g.")
              : undefined
        }
        bad={acc === "off"}
      />
      {s?.baro ? (
        <TraceCard
          title={t("Барометр")}
          units={t("м")}
          trace={tr.baro}
          axes={[N_("высота над морем")]}
          minSpan={1}
          digits={2}
          extra={`${(s.baro[0] / 100).toFixed(1)} ${t("гПа")} · ${s.baro[1].toFixed(1)} °C`}
          note={t("Поднимите коптер на метр — линия поднимется на метр. Стоя на столе гуляет на 10–30 см — это нормально.")}
        />
      ) : (
        <div className="card">
          <h3>{t("Барометр")}</h3>
          <p className="sub">{t("Барометр не ответил. Без него держать высоту коптер не сможет — только по GPS.")}</p>
        </div>
      )}
      {live?.mag ? (
        <TraceCard
          title={t("Компас")}
          units={t("мкТл")}
          trace={tr.mag}
          axes={MAG_AXES}
          minSpan={10}
          digits={1}
          extra={`|B| = ${live.mag.f.toFixed(1)} ${t("мкТл")}${live.mag.cal ? "" : " · " + t("не откалиброван")}`}
          note={t("Сырое поле в осях датчика. Поверните коптер — оси меняются плавно, модуль после калибровки держится 25–65 мкТл.")}
        />
      ) : (
        <div className="card">
          <h3>{t("Компас")}</h3>
          <p className="sub">{t("Компаса нет или он не ответил — курс берётся по GPS в полёте.")}</p>
        </div>
      )}
      <div className="card">
        <h3>{t("GPS")}</h3>
        {live?.gps ? (
          <div className="kv">
            <span>{t("Фикс")}</span>
            <span className="mono">{live.gps.fix ? t("есть") : t("нет")}</span>
            <span>{t("Спутники")}</span>
            <span className="mono">{live.gps.sats}</span>
            <span>{t("Скорость")}</span>
            <span className="mono">{live.gps.spd.toFixed(1)} {t("м/с")}</span>
            <span>{t("Координаты")}</span>
            <span className="mono">{live.gps.fix ? `${live.gps.lat.toFixed(6)}, ${live.gps.lon.toFixed(6)}` : "—"}</span>
          </div>
        ) : (
          <p className="sub">{t("GPS не подключён или молчит.")}</p>
        )}
      </div>
    </div>
  );
}

function Present({ name, on }: { name: string; on: boolean }) {
  return <span className={"sensors-chip" + (on ? " on" : "")}>{name}</span>;
}

function TraceCard(props: {
  title: string;
  units: string;
  trace: Trace;
  axes: string[];
  minSpan: number;
  digits: number;
  extra?: string;
  note?: string;
  bad?: boolean;
}) {
  const { trace, axes, digits } = props;
  const range = traceRange(trace, props.minSpan);
  const zero = range[0] < 0 && range[1] > 0 ? H - (-range[0] / (range[1] - range[0])) * H : null;
  return (
    <div className="card sensors-card">
      <div className="sensors-title">
        <h3>{props.title}</h3>
        <span className="hint">{props.units}</span>
        {props.extra && <span className={"mono sensors-extra" + (props.bad ? " bad" : "")}>{props.extra}</span>}
      </div>
      <svg className="sensors-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={props.title}>
        {zero !== null && <line x1={0} x2={W} y1={zero} y2={zero} className="sensors-zero" />}
        {axes.map((_, i) => (
          <path key={i} d={tracePath(trace, i, range, W, H)} className={`sensors-line a${i}`} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="sensors-scale hint mono">
        <span>{range[1].toFixed(digits)}</span>
        <span>{t("10 с")}</span>
        <span>{range[0].toFixed(digits)}</span>
      </div>
      <div className="sensors-legend">
        {axes.map((name, i) => {
          const st = traceStats(trace, i);
          const last = trace.v[i][trace.v[i].length - 1];
          return (
            <div key={i} className={`sensors-axis a${i}`}>
              <i />
              <span>{t(name)}</span>
              <b className="mono">{Number.isFinite(last) ? last.toFixed(digits) : "—"}</b>
              {st && <span className="hint mono">±{st.sd.toFixed(digits)}</span>}
            </div>
          );
        })}
      </div>
      {props.note && <p className="hint">{props.note}</p>}
    </div>
  );
}
