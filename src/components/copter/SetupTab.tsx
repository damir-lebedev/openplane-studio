// «Подготовка»: как стоит коптер (горизонт), можно ли армить и почему нет,
// калибровки (клавиши консоли платы: i, a, o) и ответ платы на них, плата на
// раме (align_board_*, нули — BoardAlignCard), компас — мастером со сферой точек (CompassCard).

import { CircleCheck, Crosshair, Gauge, Ruler } from "lucide-react";
import { Fragment } from "react";

import { api, errorText } from "../../api";
import { ARM_BENCH_OK } from "../../core/copterParams";
import { gyroReport } from "../../core/gyros";
import { accZeroTiltDeg, boardRotated, dragText, gyroCalibration, mahonyActive, parseAccCalibration } from "../../core/imuAlign";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Horizon } from "../live/LiveWidgets";
import { ArmWhyList } from "./ArmWhy";
import { CompassCard } from "./CompassCard";
import { NeedBoard, ParamRow, useCopterBoard, useCopterLink, useCopterLive } from "./common";
import { PreflightCard } from "./Preflight";
import { GoTo } from "./Search";

const CALIBRATIONS: { key: string; title: string; hint: string; icon: typeof Gauge }[] = [
  { key: "i", title: "Гироскоп", hint: "коптер неподвижен (gyro_calib_duration, 1.25 с); делается и сама при каждом включении", icon: Gauge },
  {
    key: "a",
    title: "Нуль акселерометра",
    hint: "коптер стоит ровно на столе ~0.5 с → acc_calibration; то же стиками: газ верх + рысканье влево + тангаж на себя",
    icon: Ruler,
  },
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
            {live?.kdrag && (
              <>
                <span title={t("Сопротивление винтов: фильтр ориентации меряет его в полёте по GPS и после посадки записывает в attitude_drag. Чем точнее, тем ровнее горизонт в разгоне.")}>{t("Сопротивление винтов")}</span>
                <span className="mono">{dragText(live.kdrag, t("1/с"))}</span>
              </>
            )}
            {live?.amag !== undefined && (
              <>
                <span title={t("Компас поправляет курс в фильтре ориентации. Нет — курс держит гироскоп и GPS в движении.")}>{t("Компас в фильтре")}</span>
                <span className="mono">{live.amag ? t("да") : t("нет")}</span>
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
      <BoardAlignCard />
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

/** Плата на раме: поворот align_board_* с картинкой (сверху и сбоку), нуль акселерометра, калибровка гироскопа. */
function BoardAlignCard() {
  const board = useCopterBoard();
  const p = board.params;
  if (!p.align_board_yaw) return null;
  const roll = Number(p.align_board_roll?.value ?? 0);
  const pitch = Number(p.align_board_pitch?.value ?? 0);
  const yaw = Number(p.align_board_yaw?.value ?? 0);
  const acc = parseAccCalibration(p.acc_calibration?.value);
  const gyro = gyroCalibration(board);
  const rows = (names: string[]) => names.map((n) => p[n] && <ParamRow key={n} p={p[n]} />);
  return (
    <div className="card wide" data-card="board-align">
      <h3>{t("Плата на раме")}</h3>
      <p className="sub">{t("Полётник стоит развёрнутым или наклонённым — скажите это числами, перепаивать и переставлять не нужно. Поверх калибровки установки (три позы).")}</p>
      <div className="row" style={{ gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <BoardTopView yaw={yaw} />
        <BoardSideView pitch={pitch} roll={roll} />
        <div className="kv">
          <span>{t("Поворот")}</span>
          <span className="mono">{boardRotated(board) ? `${roll}° / ${pitch}° / ${yaw}°` : t("нет")}</span>
          <span title={t("Нуль акселерометра в осях платы, 1/2048 g (как у Betaflight). Пишет калибровка «Нуль акселерометра».")}>{t("Нуль акселерометра")}</span>
          <span className="mono">
            {acc === null
              ? t("записан не так")
              : acc.done
                ? t("{x} / {y} / {z} · горизонт ±{deg}°", { x: acc.zero[0], y: acc.zero[1], z: acc.zero[2], deg: accZeroTiltDeg(acc).toFixed(1) })
                : t("не калиброван")}
          </span>
          <span>{t("Калибровка гироскопа")}</span>
          <span className="mono">
            {gyro.seconds.toFixed(2)} {t("с")}
            {gyro.noiseDps !== null ? ` · ${t("трясут > {dps} °/с — заново", { dps: gyro.noiseDps.toFixed(1) })}` : ` · ${t("без проверки тряски")}`}
          </span>
        </div>
      </div>
      {rows(["align_board_yaw", "align_board_pitch", "align_board_roll", "acc_calibration", "gyro_calib_duration", "gyro_calib_noise_limit", "gyro_offset_yaw"])}
      {mahonyActive(board) && rows(["imu_dcm_kp", "imu_dcm_ki"])}
    </div>
  );
}

/** Вид сверху: рама крестом, плата со стрелкой, повёрнутая на align_board_yaw (по часовой). */
function BoardTopView({ yaw }: { yaw: number }) {
  return (
    <svg width={130} height={130} viewBox="-65 -65 130 130" role="img" aria-label={t("Вид сверху")}>
      <g stroke="currentColor" strokeOpacity={0.35} strokeWidth={5} strokeLinecap="round">
        <line x1={-42} y1={-42} x2={42} y2={42} />
        <line x1={42} y1={-42} x2={-42} y2={42} />
      </g>
      {[[-42, -42], [42, -42], [-42, 42], [42, 42]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={14} fill="none" stroke="currentColor" strokeOpacity={0.3} />
      ))}
      <text x={0} y={-52} textAnchor="middle" fontSize={10} fill="currentColor" stroke="none" opacity={0.6}>
        {t("нос")}
      </text>
      <g transform={`rotate(${yaw})`}>
        <rect x={-18} y={-18} width={36} height={36} rx={4} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" />
        <path d="M0 10 V-12 M-6 -6 L0 -13 L6 -6" fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Вид сбоку (нос вправо): плата с наклоном align_board_pitch; крен — подписью. */
function BoardSideView({ pitch, roll }: { pitch: number; roll: number }) {
  return (
    <svg width={150} height={90} viewBox="-75 -45 150 90" role="img" aria-label={t("Вид сбоку")}>
      <line x1={-60} y1={18} x2={60} y2={18} stroke="currentColor" strokeOpacity={0.35} strokeWidth={4} strokeLinecap="round" />
      <text x={62} y={34} textAnchor="end" fontSize={10} fill="currentColor" stroke="none" opacity={0.6}>
        {t("нос")} →
      </text>
      <g transform={`rotate(${-pitch})`}>
        <rect x={-26} y={-5} width={52} height={10} rx={2} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" />
        <path d="M20 -12 L30 0 L20 12" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" />
      </g>
      {roll % 360 !== 0 && (
        <text x={-70} y={-32} fontSize={10} fill="currentColor" stroke="none" opacity={0.75}>
          {t("крен {deg}°", { deg: roll })}
        </text>
      )}
    </svg>
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
