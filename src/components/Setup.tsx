// Подготовка компьютера: PlatformIO (с Python), исходники прошивки,
// инструменты сборки STM32, драйвер режима прошивки (Windows). Те же шаги, что
// у галочки установщика Windows (setup.rs); на macOS — первое включение.

import { CircleCheck, Circle, Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorText, onTaskLog, SetupStatus } from "../api";
import { getLanguage, t } from "../i18n";
import { useApp } from "../store";

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button type="button" className={`toggle${on ? " on" : ""}`} disabled={disabled} onClick={() => onChange(!on)} />;
}

function Item({ done, title, sub }: { done: boolean; title: string; sub: string }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
      {done ? <CircleCheck size={18} color="var(--ok)" /> : <Circle size={18} color="var(--text-3)" />}
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="hint mono" style={{ wordBreak: "break-all" }}>
          {sub}
        </div>
      </div>
    </div>
  );
}

/** Нужна ли подготовка: нет PlatformIO или исходников прошивки. */
function needsSetup(pio: string | null | undefined, source: string | undefined): boolean {
  return !pio || !source;
}

export function SetupPanel({ onDone }: { onDone?: () => void }) {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const refreshInfo = useApp((s) => s.refreshInfo);
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [tools, setTools] = useState(true);
  const [driver, setDriver] = useState(true);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    const s = await api.setupStatus();
    setStatus(s);
    setTools(!s.tools);
  };

  useEffect(() => {
    void refresh().catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, showLog]);

  const run = async () => {
    setBusy(true);
    setLog([]);
    const unlisten = await onTaskLog((l) => l.task === "setup" && setLog((prev) => [...prev.slice(-400), l.line]));
    try {
      const report = await api.setupRun({ tools: tools && !status?.tools, driver: driver && !!status?.driver_needed, lang: getLanguage() });
      if (!settings.firmwareSource) await saveSettings({ firmwareSource: report.source });
      await refreshInfo();
      await refresh();
      toast("ok", t("Компьютер готов: можно собирать и прошивать."));
      for (const w of report.warnings) toast("info", t(w));
      onDone?.();
    } catch (e) {
      toast("err", errorText(e));
      setShowLog(true);
    } finally {
      unlisten();
      setBusy(false);
    }
  };

  const source = settings.firmwareSource ?? status?.source ?? null;
  const ready = !!status?.pio && !!source;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Item
        done={!!status?.pio}
        title={t("PlatformIO и Python")}
        sub={status?.pio ?? t("Им приложение собирает прошивку. Python — своя копия для PlatformIO, системный не трогается.")}
      />
      <Item done={!!source} title={t("Исходники прошивки")} sub={source ?? t("Скачаются с GitHub — около мегабайта.")} />
      <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
        <div className="grow">
          <Item
            done={!!status?.tools}
            title={t("Инструменты сборки STM32")}
            sub={status?.tools ? t("уже скачаны") : t("Компилятор и ядро — около 2 ГБ на диске. Не скачать сейчас — скачаются при первой прошивке.")}
          />
        </div>
        {!status?.tools && <Toggle on={tools} onChange={setTools} disabled={busy} />}
      </div>
      {status?.driver_needed && (
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <div className="grow">
            <Item
              done={false}
              title={t("Драйвер режима прошивки STM32")}
              sub={t("WinUSB для «STM32 BOOTLOADER»: Windows один раз спросит разрешение. Плата для этого не нужна.")}
            />
          </div>
          <Toggle on={driver} onChange={setDriver} disabled={busy} />
        </div>
      )}

      <div className="row" style={{ gap: 10 }}>
        <button className="btn primary" disabled={busy || !status} onClick={() => void run()}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
          {busy ? t("Готовлю…") : ready ? t("Проверить и докачать") : t("Подготовить компьютер")}
        </button>
        {(busy || log.length > 0) && (
          <button className="link" onClick={() => setShowLog(!showLog)}>
            {showLog ? t("Скрыть журнал") : t("Показать журнал ({n} строк)", { n: log.length })}
          </button>
        )}
      </div>
      {busy && !showLog && log.length > 0 && <div className="hint mono">{log[log.length - 1]}</div>}
      {showLog && (
        <div className="log mono" ref={logRef}>
          {log.join("\n") || t("пусто")}
        </div>
      )}
    </div>
  );
}

/** Первое включение без PlatformIO или исходников (macOS, или галочку в установщике сняли). */
export function SetupDialog() {
  const ready = useApp((s) => s.ready);
  const info = useApp((s) => s.info);
  const source = useApp((s) => s.settings.firmwareSource);
  const [closed, setClosed] = useState(false);
  if (!ready || !info || closed || !needsSetup(info.pio, source)) return null;
  return (
    <div className="overlay">
      <div className="modal">
        <h2>{t("Подготовка компьютера")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t("Чтобы собирать и прошивать платы, приложению нужны инструменты. Поставит всё само, в папку пользователя, без прав администратора. Нужен интернет.")}
        </p>
        <SetupPanel onDone={() => setClosed(true)} />
        <div className="modal-actions">
          <button className="btn" onClick={() => setClosed(true)}>
            {t("Позже")}
          </button>
        </div>
      </div>
    </div>
  );
}
