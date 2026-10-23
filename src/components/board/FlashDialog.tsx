import { Check, ChevronRight, CircleAlert, CircleCheck, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { api, errorText } from "../../api";
import { runAnyFlash } from "../../flash";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Modal } from "../ui";

function StepIcon({ status }: { status: string }) {
  if (status === "run") return <LoaderCircle size={17} className="spin" color="var(--accent)" />;
  if (status === "ok") return <Check size={17} />;
  if (status === "fail") return <X size={17} />;
  return <span style={{ width: 8, height: 8, borderRadius: 8, background: "var(--line-2)" }} />;
}

function BootloaderHelp({ copter }: { copter: boolean }) {
  const plane = useApp((s) => s.current());
  const stm32 = plane?.board.startsWith("stm32");
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{t("Как включить режим прошивки")}</h3>
      {copter ? (
        <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
          <li>{t("Отключите батарею и USB.")}</li>
          <li>{t("Зажмите кнопку BOOT на полётнике и, не отпуская, вставьте USB.")}</li>
          <li>{t("Windows покажет «STM32 BOOTLOADER» — нажмите «Повторить».")}</li>
          <li>{t("Дальше приложение само перезагружает плату в режим прошивки.")}</li>
        </ol>
      ) : stm32 ? (
        <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
          <li>{t("Соедините проводом пин BT0 с 3V3 (на DevEBox кнопки BOOT0 нет).")}</li>
          <li>{t("Нажмите и отпустите RST.")}</li>
          <li>{t("Windows покажет «STM32 BOOTLOADER» — нажмите «Повторить».")}</li>
          <li>{t("После прошивки провод можно убрать: дальше приложение само перезагружает плату в режим прошивки.")}</li>
        </ol>
      ) : (
        <ol style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.7 }}>
          <li>{t("Зажмите кнопку BOOT.")}</li>
          <li>{t("Нажмите и отпустите RESET (EN).")}</li>
          <li>{t("Отпустите BOOT и нажмите «Повторить».")}</li>
        </ol>
      )}
    </div>
  );
}

function DriverHelp() {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{t("Драйвер нужен один раз на этот компьютер")}</h3>
      <p className="sub">
        {t(
          "Windows видит плату в режиме прошивки, но без драйвера WinUSB прошивальщик не может с ней говорить. Кнопка «Установить драйвер» поставит его сама — как Zadig, только без настроек. Windows спросит разрешение (окно с щитом) — нажмите «Да».",
        )}
      </p>
    </div>
  );
}

export function FlashDialog() {
  const flash = useApp((s) => s.flash)!;
  const closeFlash = useApp((s) => s.closeFlash);
  const setStep = useApp((s) => s.setStep);
  const toast = useApp((s) => s.toast);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [flash.log.length, showLog]);

  const retry = () => void runAnyFlash(flash.planeId);
  const installDriver = async () => {
    setBusy(true);
    try {
      const r = await api.dfuDriverInstall();
      toast(r.ok ? "ok" : "err", t(r.message));
      if (r.ok) retry();
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const killAndRetry = async () => {
    setBusy(true);
    try {
      const pids = (flash.error?.holders ?? []).map((h) => h.pid);
      const killed = await api.portHoldersKill(pids);
      toast("info", t("Монитор порта закрыт ({n}). Откройте его снова после прошивки.", { n: killed }));
      await new Promise((r) => setTimeout(r, 600));
      retry();
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={flash.running ? undefined : closeFlash} width={680}>
      <div className="row">
        <h2 className="grow">{t("Прошивка")}</h2>
        {!flash.running && (
          <button className="btn ghost small" onClick={closeFlash}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="flash-steps">
        {flash.steps.map((s) => (
          <div key={s.id} className={`flash-step ${s.status}`}>
            <span className="ic">
              <StepIcon status={s.status} />
            </span>
            <span className="grow">{t(s.title)}</span>
            {s.detail && <span className="hint mono">{s.detail}</span>}
          </div>
        ))}
      </div>

      {flash.running && (
        <div>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="grow muted">{flash.activity}</span>
            {flash.progress !== null && <span className="mono hint">{Math.round(flash.progress * 100)}%</span>}
          </div>
          <div className={`progress${flash.progress === null ? " indeterminate" : ""}`}>
            <div style={flash.progress !== null ? { width: `${Math.round(flash.progress * 100)}%` } : undefined} />
          </div>
        </div>
      )}

      {flash.error && (
        <div className="issue error" style={{ marginTop: 6 }}>
          <CircleAlert size={18} color="var(--err)" />
          <div className="grow">
            <div style={{ fontWeight: 650 }}>{flash.error.title}</div>
            <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {flash.error.text}
            </div>
            {flash.error.holders && flash.error.holders.length > 0 && (
              <div className="hint mono" style={{ marginTop: 4 }}>
                {flash.error.holders.map((h) => `${h.name} (PID ${h.pid})`).join(", ")}
              </div>
            )}
          </div>
        </div>
      )}
      {flash.error?.action === "bootloader" && <BootloaderHelp copter={flash.vehicle === "copter"} />}
      {flash.error?.action === "driver" && <DriverHelp />}

      {flash.done && (
        <div className={`issue ${flash.done.verified ? "" : "warning"}`} style={{ marginTop: 6, borderColor: flash.done.verified ? "rgba(63,185,80,.45)" : undefined }}>
          {flash.done.verified ? <CircleCheck size={18} color="var(--ok)" /> : <TriangleAlert size={18} color="var(--warn)" />}
          <div className="grow">
            <div style={{ fontWeight: 650 }}>{flash.done.verified ? t("Готово") : t("Залито, но не подтверждено")}</div>
            <div className="muted">{flash.done.text}</div>
          </div>
        </div>
      )}
      {flash.done?.verified && !flash.calib && flash.vehicle !== "copter" && (
        <div className="hint row" style={{ marginTop: 8, gap: 8 }}>
          <LoaderCircle size={14} className="spin" />
          {t("Смотрю, на месте ли калибровки…")}
        </div>
      )}
      {flash.calib && (flash.calib.lost.length > 0 || flash.calib.kept.length > 0 || flash.calib.missing.length > 0) && (
        <div className={`issue ${flash.calib.lost.length ? "warning" : ""}`} style={{ marginTop: 8 }}>
          {flash.calib.lost.length ? <TriangleAlert size={17} color="var(--warn)" /> : <CircleCheck size={17} color="var(--ok)" />}
          <div className="grow">
            {flash.calib.lost.length > 0 && t("После прошивки пропало: {list}. Повторите в «Наладке».", { list: flash.calib.lost.join(", ") })}
            {!flash.calib.lost.length && flash.calib.kept.length > 0 && t("Калибровки пережили прошивку: {list}.", { list: flash.calib.kept.join(", ") })}
            {flash.calib.missing.length > 0 && !flash.calib.lost.length && (
              <div className={flash.calib.kept.length ? "hint" : undefined}>{t("Ещё не сделано: {list} — это в «Наладке».", { list: flash.calib.missing.join(", ") })}</div>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <button className="link" onClick={() => setShowLog(!showLog)}>
          {showLog ? t("Скрыть журнал") : t("Показать журнал ({n} строк)", { n: flash.log.length })}
        </button>
        {showLog && (
          <div className="log mono" ref={logRef}>
            {flash.log.join("\n") || t("пусто")}
          </div>
        )}
      </div>

      <div className="modal-actions">
        {flash.error?.action === "kill-monitor" && (
          <button className="btn primary" disabled={busy} onClick={() => void killAndRetry()}>
            {t("Закрыть монитор и продолжить")}
          </button>
        )}
        {flash.error?.action === "driver" && (
          <button className="btn primary" disabled={busy} onClick={() => void installDriver()}>
            {busy ? t("Ставлю драйвер…") : t("Установить драйвер")}
          </button>
        )}
        {flash.error && flash.error.action !== "kill-monitor" && (
          <button className={flash.error.action === "driver" ? "btn" : "btn primary"} disabled={busy} onClick={retry}>
            {t("Повторить")}
          </button>
        )}
        {flash.done && (
          <button
            className="btn primary"
            onClick={() => {
              closeFlash();
              setStep("setup");
            }}
          >
            {t("К наладке")} <ChevronRight size={16} />
          </button>
        )}
        {!flash.running && (
          <button className="btn ghost" onClick={closeFlash}>
            {t("Закрыть")}
          </button>
        )}
      </div>
    </Modal>
  );
}
