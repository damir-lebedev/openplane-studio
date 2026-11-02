// Вкладки-списки: безопасность и failsafe, питание (с калибровкой
// по мультиметру), видео (частота по полосе и каналу), GPS, чёрный ящик,
// прочее (описание коптера — из него считается настройка) и CLI.

import { Send, Terminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorText } from "../../api";
import { VTX_BANDS, vtxFrequency } from "../../core/copter";
import { CopterParam, CopterTab, num, tabParams } from "../../core/copterParams";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamList, useCopterBoard, useCopterLink, useCopterLive } from "./common";

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
  const arm = all.filter((p) => !p.name.startsWith("failsafe") && !p.name.startsWith("crash_"));
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
        <p className="hint">{t("Проверьте без пропеллеров: выключите пульт — на OSD FAILSAFE, моторы встают.")}</p>
      </div>
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
                {live.ovl === "ESC" ? "ESC OVERLOAD" : live.ovl === "BATT" ? "BATT OVERLOAD" : t("нет")} ·{" "}
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
      <ParamList title={t("Батарея и предупреждения")} params={cells} />
      <ParamList title={t("Датчики напряжения и тока")} params={meter} />
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
  const all = tabParams(board, "other", ["props_out"]);
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

export function CliTab() {
  const lines = useApp((s) => s.consoleLines);
  const { open, armed } = useCopterLink();
  const toast = useApp((s) => s.toast);
  const [text, setText] = useState("");
  const [paste, setPaste] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [lines.length]);

  const send = async (line: string) => {
    try {
      await api.linkSend(`${line}\r\n`);
    } catch (e) {
      toast("err", errorText(e));
    }
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
        </div>
        <p className="hint">{t("Пока CLI открыт, ARM запрещён и вкладки не меняют настройки; exit — выйти без сохранения, save — сохранить и выйти.")}</p>
        <div className="cli console">
          {lines.slice(-400).map((l, i) => (
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
