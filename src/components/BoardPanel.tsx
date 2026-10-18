// Панель платы (кнопка-плашка в шапке): связь, что плата видит прямо сейчас,
// консоль. Порт держит приложение — свой монитор порта не нужен.

import { Cable, LoaderCircle, Power, SendHorizontal, Trash, TriangleAlert, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, errorText } from "../api";
import { armBlockHint } from "../core/live";
import { t } from "../i18n";
import { useApp } from "../store";
import { Horizon, SensorChip, useLive } from "./live/LiveWidgets";

const OUT_NAMES = ["Элерон Л", "Элерон П", "Руль выс.", "Руль напр.", "Газ", "AUX1", "AUX2"];
const CH_NAMES = ["крен", "тангаж", "газ", "курс", "SwA", "SwB", "SwC", "SwD", "VrA", "VrB"];

function Bars({ values, names }: { values: number[]; names: string[] }) {
  return (
    <div className="bars">
      {values.map((v, i) => {
        const frac = Math.max(0, Math.min(1, (v - 1000) / 1000));
        return (
          <div key={i} className="bar-row" title={`${names[i] ?? ""}: ${v} мкс`}>
            <span className="bar-name">{names[i] ?? `CH${i + 1}`}</span>
            <span className="bar-track">
              <span className="bar-mid" />
              <span className="bar-fill" style={{ width: `${frac * 100}%` }} />
            </span>
            <span className="bar-val mono">{v}</span>
          </div>
        );
      })}
    </div>
  );
}

function LinkBlock() {
  const link = useApp((s) => s.link);
  const linkHold = useApp((s) => s.linkHold);
  const devices = useApp((s) => s.devices);
  const ports = useApp((s) => s.ports);
  const connect = useApp((s) => s.connect);
  const disconnect = useApp((s) => s.disconnect);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const identity = link.port ? ports[link.port]?.identity : null;
  const candidates = devices.filter((d) => d.port && d.kind !== "stm32-dfu");
  const dfu = devices.some((d) => d.kind === "stm32-dfu");

  const freePort = async () => {
    setBusy(true);
    try {
      const holders = await api.portHolders();
      if (!holders.length) {
        toast("info", t("Порт держит не монитор порта — закройте программу, которая его открыла"));
        return;
      }
      const n = await api.portHoldersKill(holders.map((h) => h.pid));
      toast("ok", t("Закрыто программ: {n}", { n }));
      if (link.port) await connect(link.port, devices.find((d) => d.port === link.port)?.kind === "stm32-cdc");
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (link.state === "open" && link.port) {
    return (
      <div className="drawer-block">
        <div className="row">
          <Cable size={16} color="var(--ok)" />
          <b>{link.port}</b>
          <span className="muted">{identity ? identity.board : t("плата отвечает")}</span>
          <div className="grow" />
          <button className="btn small" onClick={() => void disconnect(true)} title={t("Освободить порт для другой программы")}>
            <Power size={14} />
            {t("Отключить")}
          </button>
        </div>
        {identity && (
          <div className="kv" style={{ marginTop: 10 }}>
            <span>{t("Самолёт")}</span>
            <span>{identity.plane || t("не из приложения")}</span>
            <span>{t("Прошивка")}</span>
            <span className="mono">
              {identity.commit} · {t("конфигурация")} {identity.config || "—"}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="drawer-block">
      {link.state === "connecting" && (
        <div className="row">
          <LoaderCircle size={16} className="spin" />
          {t("Подключаюсь к {port}…", { port: link.port ?? "" })}
        </div>
      )}
      {link.state === "error" && (
        <div className="issue warning" style={{ marginBottom: 10 }}>
          <TriangleAlert size={16} color="var(--warn)" />
          <div className="grow">
            {link.error?.startsWith("PORT_BUSY")
              ? t("{port} занят другой программой — скорее всего, открыт монитор порта.", { port: link.port ?? "" })
              : t("Не подключиться к {port}: {e}", { port: link.port ?? "", e: link.error ?? "" })}
            {link.error?.startsWith("PORT_BUSY") && (
              <div style={{ marginTop: 8 }}>
                <button className="btn small" disabled={busy} onClick={() => void freePort()}>
                  {t("Закрыть монитор порта")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {link.state === "idle" && !candidates.length && (
        <p className="muted" style={{ margin: 0 }}>
          {dfu ? t("Плата в режиме прошивки (DFU): прошейте её — потом она появится здесь.") : t("Плата не подключена. Подключите её по USB.")}
        </p>
      )}
      {link.state !== "connecting" &&
        candidates.map((d) => (
          <div key={d.port} className="row" style={{ padding: "4px 0" }}>
            <Cable size={15} color="var(--text-3)" />
            <span>
              <b>{d.port}</b> <span className="muted">{d.title}</span>
            </span>
            <div className="grow" />
            <button className="btn small" onClick={() => void connect(d.port!, d.kind === "stm32-cdc")}>
              {t("Подключить")}
            </button>
          </div>
        ))}
      {linkHold && link.state === "idle" && (
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("От {port} вы отключились сами — приложение не подключится к нему, пока не нажмёте «Подключить» или не переткнёте плату.", { port: linkHold })}
        </p>
      )}
    </div>
  );
}

function LiveBlock() {
  const live = useLive();
  const link = useApp((s) => s.link);
  if (link.state !== "open") return null;
  if (!live) {
    return (
      <div className="drawer-block muted">
        {link.noLive
          ? t("Прошивка на плате старше приложения и не шлёт живые данные. Прошейте самолёт — и здесь появятся пульт, датчики и причины запрета ARM.")
          : t("Живых данных нет: плата занята (калибровка) или только что подключилась.")}
      </div>
    );
  }
  const hint = live.block ? armBlockHint(live.block) : null;
  return (
    <div className="drawer-block">
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        <span className={`badge ${live.arm ? "err" : ""}`}>{live.arm ? "ARM" : "DISARM"}</span>
        <span className="badge accent">{live.mode}</span>
        <span className={`badge ${live.rx === "ok" ? "ok" : "err"}`}>
          {live.rx === "ok" ? t("пульт: связь") : live.rx === "fs" ? t("пульт: failsafe") : t("пульт: нет кадров")}
        </span>
        {live.feat.map((f) => (
          <span key={f} className="badge">
            {f}
          </span>
        ))}
        <div className="grow" />
        <span className="hint mono">{live.hz} Гц</span>
      </div>
      {live.block && !live.arm && (
        <div className="arm-block">
          <b>{t("ARM не включится:")}</b> {live.block}
          {hint?.text && <div className="hint">{hint.text}</div>}
        </div>
      )}
      <div className="row" style={{ marginTop: 12, alignItems: "flex-start", gap: 14 }}>
        <Horizon roll={live.att?.[0]} pitch={live.att?.[1]} size={112} />
        <div className="grow" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <SensorChip name="IMU" state={live.imu} value={live.att ? `${live.att[0].toFixed(0)}° / ${live.att[1].toFixed(0)}°` : undefined} />
          <SensorChip name={t("Баро")} state={live.baro} value={live.alt !== undefined ? `${live.alt.toFixed(1)} м` : undefined} />
          <SensorChip name={t("Компас")} state={live.mag} value={live.hdg !== undefined ? `${live.hdg}°` : undefined} />
          <SensorChip name="GPS" state={live.gps} value={live.sats !== undefined ? t("{n} спутн.", { n: live.sats }) : undefined} />
          <SensorChip name={t("Пито")} state={live.pitot} value={live.ias !== undefined ? `${live.ias.toFixed(1)} м/с` : undefined} />
        </div>
      </div>
      <div className="drawer-cols">
        <div>
          <div className="drawer-sub">{t("Каналы пульта")}</div>
          <Bars values={live.ch} names={CH_NAMES} />
        </div>
        <div>
          <div className="drawer-sub">{t("Выходы")}</div>
          <Bars values={live.out} names={OUT_NAMES} />
        </div>
      </div>
    </div>
  );
}

function ConsoleBlock() {
  const lines = useApp((s) => s.consoleLines);
  const link = useApp((s) => s.link);
  const sendRaw = useApp((s) => s.sendRaw);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && stick.current) box.scrollTop = box.scrollHeight;
  }, [lines]);

  const send = (s: string) => {
    if (link.state !== "open") return;
    void sendRaw(s).catch(() => {});
  };

  const keys: [string, string, string][] = [
    ["h", t("Меню"), t("меню консоли")],
    ["s", t("Статус"), t("состояние датчиков")],
    ["b", t("Шина I2C"), t("кто отвечает на шине")],
    ["l", t("Лог"), t("меню отладочного лога")],
    [" ", t("Пауза"), t("пауза лога")],
  ];

  return (
    <div className="drawer-block console-block">
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <div className="drawer-sub" style={{ margin: 0 }}>
          {t("Консоль")}
        </div>
        <div className="grow" />
        {keys.map(([k, label, title]) => (
          <button key={label} className="btn small" disabled={link.state !== "open"} title={title} onClick={() => send(k)}>
            {label}
          </button>
        ))}
        <button className="btn small ghost" title={t("Очистить")} onClick={() => useApp.setState({ consoleLines: [] })}>
          <Trash size={14} />
        </button>
      </div>
      <div
        className="console"
        ref={boxRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
        }}
      >
        {lines.length ? lines.slice(-400).join("\n") : <span className="muted">{t("Пока тихо.")}</span>}
      </div>
      <form
        className="row"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          send(`${text}\n`);
          setText("");
        }}
      >
        <input
          className="input grow mono"
          value={text}
          placeholder={t("Клавиша или команда консоли — Enter")}
          disabled={link.state !== "open"}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn" type="submit" disabled={link.state !== "open"}>
          <SendHorizontal size={15} />
        </button>
      </form>
    </div>
  );
}

export function BoardPanel() {
  const open = useApp((s) => s.boardPanel);
  const setOpen = useApp((s) => s.setBoardPanel);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="drawer-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <aside className="drawer">
        <div className="drawer-head">
          <h3>{t("Плата")}</h3>
          <div className="grow" />
          <button className="btn ghost small" onClick={() => setOpen(false)} aria-label={t("Закрыть")}>
            <X size={16} />
          </button>
        </div>
        <LinkBlock />
        <LiveBlock />
        <ConsoleBlock />
      </aside>
    </div>
  );
}
