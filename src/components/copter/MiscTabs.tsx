// Вкладки-списки: безопасность и failsafe, питание (с калибровкой
// по мультиметру), видео (частота по полосе и каналу), GPS, чёрный ящик,
// прочее (описание коптера — из него считается настройка) и CLI.

import { Download, Send, Terminal, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorText } from "../../api";
import { VTX_BANDS, vtxFrequency } from "../../core/copter";
import { CopterParam, CopterTab, num, tabParams, yawSpinThreshold } from "../../core/copterParams";
import { batteryPlan, capacityBar, CellScale, cellScale, CellZone, scalePos } from "../../core/battery";
import { BOARD_ALIGN_PARAMS } from "../../core/imuAlign";
import { OVERLOAD_TEXT } from "../../core/parts";
import { isGeofenceParam } from "../../core/geofence";
import { isTrainingParam } from "../../core/training";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamList, shown, useCopterBoard, useCopterLink, useCopterLive } from "./common";
import { FailsafeDrillCard } from "./FailsafeDrill";
import { FindLostCard } from "./FindLost";
import { GeofenceCard } from "./GeofenceCard";
import { GpsSpoofCard } from "./GpsSpoof";
import { TrainingCard } from "./TrainingCard";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TITLES: Partial<Record<CopterTab, { title: string; sub: string }>> = {
  gps: { title: "GPS", sub: "Дом ставится при ARM, если спутников достаточно; стрелка домой и расстояние — на OSD." },
  blackbox: { title: "Чёрный ящик", sub: "Журнал полёта на флеш платы; выгрузить — раздел «Ящик» слева, открыть можно и в Blackbox Explorer (.bfl)." },
};

/** Простая вкладка: заголовок и все настройки её группы. */
export function ListTab({ tab }: { tab: CopterTab }) {
  return (
    <NeedBoard>
      <ListBody tab={tab} />
    </NeedBoard>
  );
}

function ListBody({ tab }: { tab: CopterTab }) {
  const board = useCopterBoard();
  const meta = TITLES[tab];
  return (
    <div className="copter-grid">
      <div className="wide">
        <ParamList title={meta ? t(meta.title) : undefined} sub={meta ? t(meta.sub) : undefined} params={tabParams(board, tab)} />
      </div>
    </div>
  );
}

// ---------------- безопасность ----------------

export function FailsafeTab() {
  return (
    <NeedBoard>
      <FailsafeBody />
    </NeedBoard>
  );
}

function FailsafeBody() {
  const board = useCopterBoard();
  const all = tabParams(board, "failsafe");
  const fs = all.filter((p) => p.name.startsWith("failsafe"));
  const crash = all.filter((p) => p.name.startsWith("crash_"));
  const spin = all.filter((p) => p.name.startsWith("yaw_spin_"));
  const arm = all.filter(
    (p) => !p.name.startsWith("failsafe") && !p.name.startsWith("crash_") && !p.name.startsWith("yaw_spin_") && !isTrainingParam(p.name) && !isGeofenceParam(p.name),
  );
  const spinAt = yawSpinThreshold(board);
  const crashMode = String(board.params.crash_recovery?.value ?? "OFF");
  const delay = num(board, "failsafe_delay", 15) / 10;
  const landing = num(board, "failsafe_landing_time", 60);
  const procedure = String(board.params.failsafe_procedure?.value ?? "AUTO-LAND");
  return (
    <div className="copter-grid">
      <div className="card wide">
        <h3>{t("Связь пропала — что будет")}</h3>
        <div className="fs-timeline">
          <div className="fs-stage">
            <b>0–0.3 {t("с")}</b>
            <span>{t("последние положения стиков")}</span>
          </div>
          <div className="fs-stage">
            <b>
              {t("до {s} с", { s: delay.toFixed(1) })}
            </b>
            <span>{t("этап 1: ровно и держит высоту — связь вернётся, управление сразу ваше")}</span>
          </div>
          <div className="fs-stage last">
            <b>{procedure}</b>
            <span>
              {procedure === "DROP"
                ? t("этап 2: моторы выключаются — коптер падает")
                : procedure === "GPS-RESCUE"
                  ? t("этап 2: возврат домой по GPS (схема — вкладка «GPS»)")
                  : t("этап 2: снижение и посадка, не дольше {s} с", { s: landing })}
            </span>
          </div>
        </div>
        {procedure !== "GPS-RESCUE" && <p className="hint">{t("Летаете далеко (7\")? Выберите failsafe_procedure = GPS-RESCUE — по потере связи коптер вернётся домой сам.")}</p>}
      </div>
      <GeofenceCard />
      <FailsafeDrillCard />
      <FindLostCard />
      <GpsSpoofCard />
      <TrainingCard />
      <ParamList title={t("Failsafe")} params={fs} />
      <ParamList title={t("ARM и защита")} params={arm} />
      {crash.length > 0 && (
        <ParamList
          title={t("Удар в воздухе (crash recovery)")}
          sub={
            crashMode === "OFF"
              ? t("Выключено, как в Betaflight. ON — после удара в ACRO коптер сам выровняется за треть секунды и вернёт управление; флип стиком ударом не считается.")
              : crashMode === "DISARM"
                ? t("DISARM: удар — моторы стоп сразу.")
                : t("Включено: удар в ACRO/HORIZON — коптер сам выравнивается и возвращает управление, как только ровно.")
          }
          params={crash}
        />
      )}
      {spin.length > 0 && (
        <ParamList
          title={t("Раскрутка по рысканью (yaw spin recovery)")}
          sub={
            spinAt === null
              ? t("Выключено: раскрутку до упора гироскопа (удар винтом, ветер в пропы) коптер сам не гасит.")
              : t("Рысканье быстрее {n} °/с — коптер гасит вращение: крен и тангаж отпускает, рысканье тормозит всем ходом; на {m} °/с ниже порога — управление снова ваше.", {
                  n: spinAt,
                  m: Math.max(0, spinAt - 100),
                }) +
                (String(board.params.yaw_spin_recovery?.value ?? "AUTO").toUpperCase() === "AUTO"
                  ? " " + t("Порог AUTO — от ваших рейтов: пируэт полным стиком защиту не включает.")
                  : "")
          }
          params={spin}
        />
      )}
    </div>
  );
}

// ---------------- питание ----------------

export function PowerTab() {
  return (
    <NeedBoard>
      <PowerBody />
    </NeedBoard>
  );
}

function PowerBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const [volts, setVolts] = useState("");
  const [amps, setAmps] = useState("");
  const all = tabParams(board, "power");
  const cells = all.filter((p) => p.name.includes("cell") || p.name.startsWith("bat_") || p.name.includes("alert") || p.name.includes("cutoff") || p.name.includes("duration"));
  const meter = all.filter((p) => !cells.includes(p));
  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Сейчас")}</h3>
        <div className="kv">
          <span>{t("Напряжение")}</span>
          <span className="mono">{live && live.v > 0.5 ? `${live.v.toFixed(2)} ${t("В")}` : t("нет батареи")}</span>
          <span>{t("На банку")}</span>
          <span className="mono">{live?.cell ? `${live.cell.toFixed(2)} ${t("В")}` : "—"}</span>
          <span>{t("Ток")}</span>
          <span className="mono">{live?.amps !== undefined ? `${live.amps.toFixed(1)} ${t("А")} · ${Math.round(live.mah ?? 0)} ${t("мА·ч")}` : t("не измеряется")}</span>
          <span>{t("Состояние")}</span>
          <span className="mono">{live?.bat ?? "—"}</span>
          {live?.mma !== undefined && (
            <>
              <span>{t("Перегрузка по току")}</span>
              <span className={`mono${live.ovl ? " warn-text" : ""}`}>
                {live.ovl ? (OVERLOAD_TEXT[live.ovl] ?? live.ovl) : t("нет")} ·{" "}
                {t("до {a} А на мотор за полёт", { a: live.mma.toFixed(1) })}
              </span>
            </>
          )}
        </div>
        <p className="hint">{t("Ток регулятора и C батареи — на вкладке «Что подключено»: по ним прошивка предупреждает в очках ESC OVERLOAD и BATT OVERLOAD.")}</p>
      </div>
      <div className="card">
        <h3>{t("Калибровка по мультиметру")}</h3>
        <p className="sub">{t("Измерьте напряжение батареи мультиметром и впишите — плата подгонит vbat_scale. Ток — по ваттметру при постоянной нагрузке от 0.5 А.")}</p>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ width: 100 }} placeholder={t("В")} value={volts} onChange={(e) => setVolts(e.target.value)} />
          <button className="btn" disabled={armed || !(Number(volts) > 1)} onClick={() => void cmd(`calibrate vbat ${Number(volts).toFixed(2)}`)}>
            {t("Напряжение")}
          </button>
          <input className="input" style={{ width: 100 }} placeholder={t("А")} value={amps} onChange={(e) => setAmps(e.target.value)} />
          <button className="btn" disabled={armed || !(Number(amps) >= 0.5)} onClick={() => void cmd(`calibrate ibat ${Number(amps).toFixed(1)}`)}>
            {t("Ток")}
          </button>
        </div>
      </div>
      <CellScaleCard scale={cellScale(board, live && live.v > 0.5 ? live.cell : undefined)} mah={live?.mah} />
      <ParamList title={t("Батарея и предупреждения")} params={cells} />
      <ParamList title={t("Датчики напряжения и тока")} params={meter} />
    </div>
  );
}

const ZONE_TEXT: Record<CellZone, string> = {
  critical: N_("пусто — CRITICAL"),
  warning: N_("домой — WARNING"),
  ok: N_("летать"),
  full: N_("полная"),
};

const TICKS: [keyof Pick<CellScale, "min" | "warn" | "full" | "max">, string][] = [
  ["min", "min"],
  ["warn", "warning"],
  ["full", "full"],
  ["max", "max"],
];

/** 127: шкала банки с порогами тревог, расход ёмкости и ход разряда. */
function CellScaleCard({ scale: s, mah }: { scale: CellScale; mah?: number }) {
  const board = useCopterBoard();
  const plan = batteryPlan(board);
  const cap = capacityBar(board, mah);
  const pack = (v: number) => (s.cells > 0 ? ` (${(v * s.cells).toFixed(1)} ${t("В")})` : "");
  return (
    <div className="card wide">
      <h3>{t("Банка: пороги и тревоги")}</h3>
      <p className="sub">
        {s.cells > 0
          ? t("Батарея {n}S: пороги на банку, в скобках — на всю батарею.", { n: s.cells })
          : t("Число банок не задано — battery_cells на вкладке «Что подключено» или force_battery_cell_count.")}
      </p>
      <div className="cell-scale">
        {s.zones.map((z, i) => (
          <div key={z.zone} className={`cell-zone ${z.zone}${i === s.zones.length - 1 ? " last" : ""}`} style={{ width: `${((z.to - z.from) / (s.hi - s.lo)) * 100}%` }}>
            <span>{t(ZONE_TEXT[z.zone])}</span>
          </div>
        ))}
        {s.pos !== undefined && s.cell !== undefined && (
          <div className={`cell-mark ${s.zone}`} style={{ left: `${(s.pos * 100).toFixed(2)}%` }} title={t("сейчас")}>
            <b className="mono">{s.cell.toFixed(2)}</b>
          </div>
        )}
      </div>
      <div className="cell-ticks">
        {TICKS.map(([key, name]) => (
          <span key={key} className="mono" style={{ left: `${(scalePos(s, s[key]) * 100).toFixed(2)}%` }}>
            {s[key].toFixed(2)}
            <i>{name}</i>
          </span>
        ))}
      </div>
      <ol className="bat-steps">
        {plan.steps.map((st) => (
          <li key={st.at} className={st.at}>
            <b>{st.at === "warning" ? "WARNING" : "CRITICAL"}</b>{" "}
            {t("банка ниже {v} В{pack} дольше {s} с", { v: st.volts.toFixed(2), pack: pack(st.volts), s: st.delay.toFixed(1) })}
            {" — "}
            {st.at === "warning"
              ? t("пора домой; ниже без нагрузки — ARM не даётся")
              : plan.cutoff < 100
                ? t("батарея пуста; газ за 10 с плавно ограничивается до {p}%", { p: plan.cutoff })
                : t("батарея пуста; газ не ограничивается (vbat_cutoff_percent = 100)")}
          </li>
        ))}
      </ol>
      {!plan.alerts && <p className="hint warn-text">{t("Тревоги выключены (use_vbat_alerts = OFF): ни писка, ни надписи в очках.")}</p>}
      <p className="hint">{t("Провал под газом короче задержки — не тревога; поднимется выше порога на {h} В — тревога снимается.", { h: plan.hysteresis.toFixed(2) })}</p>
      {cap && (
        <>
          <h4>{t("Расход ёмкости")}</h4>
          <div className="cap-bar">
            <div className={`cap-fill ${cap.zone}`} style={{ width: `${(cap.left * 100).toFixed(1)}%` }} />
            {cap.alerts && <div className="cap-alert" style={{ left: `${(cap.alertAt * 100).toFixed(1)}%` }} />}
            <span className="mono">{t("осталось {p}% · {u} из {c} мА·ч", { p: Math.round(cap.left * 100), u: Math.round(cap.used), c: cap.capacity })}</span>
          </div>
          {!cap.alerts && <p className="hint">{t("По расходу не предупреждает: use_cbat_alerts = ON — тревога при {p}% остатка.", { p: Math.round(cap.alertAt * 100) })}</p>}
        </>
      )}
    </div>
  );
}

// ---------------- видео ----------------

export function VtxTab() {
  return (
    <NeedBoard>
      <VtxBody />
    </NeedBoard>
  );
}

function VtxBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const band = num(board, "vtx_band");
  const channel = num(board, "vtx_channel");
  const mhz = vtxFrequency(band, channel);
  const letter = VTX_BANDS.find((b) => b.id === band)?.letter;
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const lowPower = board.params.vtx_low_power_disarm;
  const hotOnBench = lowPower && String(shown(lowPower.name, lowPower)).toUpperCase() === "OFF";
  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Передатчик")}</h3>
        <div className="kv">
          <span>{t("Канал")}</span>
          <span className="mono">{letter ? `${letter}${channel} · ${mhz} ${t("МГц")}` : t("частота задана vtx_freq")}</span>
          <span>{t("На связи")}</span>
          <span className="mono">{live?.vtx ? (live.vtx.on ? t("да") : t("нет ответа")) : "—"}</span>
          {live?.vtx?.on && (
            <>
              <span>{t("Сейчас")}</span>
              <span className="mono">
                {live.vtx.mhz} {t("МГц")} · {live.vtx.mw} {t("мВт")}
                {live.vtx.pit ? " · PIT" : ""}
              </span>
              <span>{t("Потолок")}</span>
              <span className="mono">
                {live.vtx.cap} {t("мВт")}
              </span>
            </>
          )}
        </div>
        <p className="hint">{t("Полоса: 1 A, 2 B, 3 E, 4 F, 5 R (Raceband), 6 L… Мощность с тумблера — на вкладке «Коптер» → «Тумблеры».")}</p>
        {hotOnBench && (
          <div className="parts-meter">
            <p className="hint warn-text">{t("Без ARM передатчик не обдувается и греется: через минуту на мощности очки покажут VTX HOT. Лучше без ARM — самый слабый уровень (или режим VTX PIT MODE).")}</p>
            <button className="btn small" disabled={armed} onClick={() => void set("vtx_low_power_disarm", "ON")}>
              {t("Слабее без ARM")}
            </button>
          </div>
        )}
      </div>
      <ParamList title={t("Настройки")} params={tabParams(board, "vtx")} />
    </div>
  );
}

// ---------------- прочее ----------------

export function OtherTab() {
  return (
    <NeedBoard>
      <OtherBody />
    </NeedBoard>
  );
}

function OtherBody() {
  const board = useCopterBoard();
  const all = tabParams(board, "other", ["props_out", ...BOARD_ALIGN_PARAMS]);
  const model = all.filter((p: CopterParam) => p.group === "copter");
  const rest = all.filter((p: CopterParam) => p.group !== "copter");
  return (
    <div className="copter-grid">
      <ParamList
        title={t("Описание коптера")}
        sub={t("Из массы, моторов, винтов и батареи прошивка считает PID, фильтры и расходы (tune_source = MODEL). Поменяли — сохраните, настройка пересчитается.")}
        params={model}
      />
      <ParamList title={t("Прочее")} params={rest} />
      <FlashCard flash={board.header?.flash} />
    </div>
  );
}

/** Флеш настроек платы: сколько занято — заданное руками, тумблеры, калибровки. */
export function FlashCard({ flash }: { flash?: [number, number] }) {
  if (!flash) return null;
  const [used, total] = flash;
  const share = total ? used / total : 0;
  const level = share > 0.9 ? "bad" : share > 0.7 ? "warn" : "ok";
  const kb = (n: number) => (n / 1024).toFixed(1);
  return (
    <div className="card">
      <h3>{t("Память настроек")}</h3>
      <div className={`margin-bar ${level}`}>
        <div className="row" style={{ gap: 8 }}>
          <span className="grow">{t("Занято")}</span>
          <span className="mono">{t("{used} из {total} КБ", { used: kb(used), total: kb(total) })}</span>
        </div>
        <div className="margin-track">
          <div className={`margin-zone ${level}`} style={{ width: `${Math.min(100, share * 100)}%` }} />
        </div>
        <div className="hint">{t("Заданное руками, тумблеры и калибровки — после «Сохранить». Diff Betaflight на сотни строк помещается.")}</div>
      </div>
    </div>
  );
}

// ---------------- CLI ----------------

/** Что сохранить «В файл»: вывод последнего diff / dump (с его строки «# diff…»), без хвоста
 *  «# exit»/«Выход из CLI»; ни того ни другого не было — пусто. */
export function cliCapture(lines: string[]): string[] {
  let from = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^#\s*(diff|dump)\b/.test(lines[i].trim())) {
      from = i;
      break;
    }
  }
  if (from < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(from)) {
    const s = l.replace(/\r$/, "");
    if (s.startsWith("@")) continue;   // кадры приложения посреди вывода
    if (out.length && /^#\s*(exit|save|diff|dump)\b|^Выход из CLI/.test(s.trim())) break;
    out.push(s);
  }
  return out;
}

export function CliTab() {
  const lines = useApp((s) => s.consoleLines);
  const { open, armed } = useCopterLink();
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState("");
  const [paste, setPaste] = useState("");
  const end = useRef<HTMLDivElement>(null);
  // фигурные скобки обязательны: в новом WebView scrollIntoView() возвращает Promise,
  // React принимает его за функцию очистки и роняет всё приложение при уходе с вкладки
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length]);

  const send = async (line: string) => {
    try {
      await api.linkSend(`${line}\r\n`);
    } catch (e) {
      toast("err", errorText(e));
    }
  };
  const file = useRef<HTMLInputElement>(null);
  const copter = useApp((s) => s.copters.find((c) => c.id === s.copterId));
  const saveFile = async () => {
    const out = cliCapture(lines);
    if (!out.length) {
      toast("info", t("Сначала diff all или dump — сохранится их вывод."));
      return;
    }
    const name = `${(copter?.name ?? "copter").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60)}-${new Date().toISOString().slice(0, 10)}.txt`;
    try {
      const path = await api.textExport(name, out.join("\n") + "\n");
      toast("ok", t("Сохранено: {path}", { path }));
    } catch (e) {
      toast("err", errorText(e));
    }
  };
  const loadFile = async (f: File | undefined) => {
    if (!f) return;
    setPaste(await f.text());
    toast("info", t("Файл «{name}» — в поле ниже: проверьте и нажмите «Отправить».", { name: f.name }));
  };
  const sendPaste = async () => {
    // как вставка в CLI BF: строка за строкой; батч сам скажет, что не перенеслось
    for (const l of paste.split(/\r?\n/)) {
      if (!l.trim()) continue;
      await send(l);
      await sleep(25);
    }
    setPaste("");
  };

  return (
    <div className="copter-grid">
      <div className="card wide">
        <div className="row" style={{ gap: 8 }}>
          <Terminal size={18} color="var(--accent)" />
          <h3 className="grow" style={{ margin: 0 }}>
            {t("CLI как в Betaflight")}
          </h3>
          <button className="btn small" disabled={!open || armed} onClick={() => void api.linkSend("#")}>
            {t("Войти (#)")}
          </button>
          <button className="btn small" disabled={!open} onClick={() => void send("diff all")}>
            diff all
          </button>
          <button className="btn small" disabled={!open} onClick={() => void send("status")}>
            status
          </button>
          <button className="btn small" disabled={!open} onClick={() => void send("exit")}>
            exit
          </button>
          <button className="btn small" title={t("Вывод последнего diff / dump — файлом в «Загрузки»")} onClick={() => void saveFile()}>
            <Download size={14} /> {t("В файл")}
          </button>
          <button className="btn small" title={t("diff из файла (наш или Betaflight) — в поле вставки")} onClick={() => file.current?.click()}>
            <Upload size={14} /> {t("Из файла")}
          </button>
          <input
            ref={file}
            type="file"
            accept=".txt,text/plain"
            style={{ display: "none" }}
            onChange={(e) => {
              void loadFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        <p className="hint">{t("Пока CLI открыт, ARM запрещён и вкладки не меняют настройки; exit — выйти без сохранения, save — сохранить и выйти.")}</p>
        <div className="cli console">
          {lines.map((l, i) => (
            <div key={i} className="mono">
              {l}
            </div>
          ))}
          <div ref={end} />
        </div>
        <form
          className="row"
          style={{ gap: 8, marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            void send(text);
            setText("");
          }}
        >
          <input className="input grow mono" disabled={!open} placeholder="get rate" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn primary" disabled={!open}>
            <Send size={15} />
          </button>
        </form>
      </div>
      <div className="card wide">
        <h3>{t("Вставить diff из Betaflight")}</h3>
        <p className="sub">{t("Сначала «Войти (#)». Понятное нашей прошивке применится, железные строки (resource, timer, dma) пропускаются — сводка будет в конце; save — в конце вставки.")}</p>
        <textarea className="input mono" rows={6} style={{ width: "100%" }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="# diff all" />
        <button className="btn" style={{ marginTop: 8 }} disabled={!open || !paste.trim()} onClick={() => void sendPaste()}>
          {t("Отправить")}
        </button>
      </div>
    </div>
  );
}
