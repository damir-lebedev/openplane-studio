import { CircleCheck, Download, LoaderCircle, RefreshCw, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { bytesText, checkOnStart, etaSeconds, fraction, notesLines, UpdateState } from "../core/update";
import { t } from "../i18n";
import { useApp } from "../store";

const size = (n: number) => bytesText(n, t("МБ"), t("КБ"));

function etaText(s: number): string {
  if (s < 60) return t("меньше минуты");
  const m = Math.round(s / 60);
  return m < 60 ? t("≈ {n} мин", { n: m }) : t("≈ {h} ч {m} мин", { h: Math.floor(m / 60), m: m % 60 });
}

function Progress({ u }: { u: UpdateState }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const eta = etaSeconds(u.done ?? 0, u.total ?? 0, Date.now() - (u.startedAt ?? Date.now()));
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="progress">
        <div style={{ width: `${Math.round(fraction(u.done, u.total) * 100)}%` }} />
      </div>
      <div className="hint">
        {t("{done} из {total}", { done: size(u.done ?? 0), total: size(u.total ?? 0) })}
        {eta !== null && ` · ${t("осталось {eta}", { eta: etaText(eta) })}`}
        {" · "}
        {t("можно работать дальше")}
      </div>
    </div>
  );
}

/** Карточка в углу: вышла новая версия → скачать → установить и перезапустить. */
export function UpdateCard() {
  const u = useApp((s) => s.update);
  const platform = useApp((s) => s.info?.platform);
  const download = useApp((s) => s.downloadUpdate);
  const install = useApp((s) => s.installUpdate);
  const dismiss = useApp((s) => s.dismissUpdate);
  const saveSettings = useApp((s) => s.saveSettings);
  const [notesOpen, setNotesOpen] = useState(false);
  const shown = !u.hidden && !!u.info?.newer && ["available", "downloading", "ready", "installing", "error"].includes(u.phase);
  if (!shown || !u.info) return null;
  const info = u.info;
  const notes = notesLines(info.notes);

  return (
    <div className="update-card" role="dialog" aria-label={t("Обновление")}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Download size={18} style={{ color: "var(--accent)", marginTop: 2 }} />
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{t("Вышла OpenPlane Studio {v}", { v: info.version })}</div>
          <div className="hint">
            {t("у вас {v}", { v: info.current })}
            {info.asset && ` · ${t("установщик {size}", { size: size(info.asset.size) })}`}
          </div>
        </div>
        {u.phase !== "installing" && (
          <button className="btn ghost small" title={t("Позже")} aria-label={t("Позже")} onClick={() => void dismiss(false)}>
            <X size={14} />
          </button>
        )}
      </div>

      {notes.lines.length > 0 && (
        <div>
          <button className="link" onClick={() => setNotesOpen(!notesOpen)}>
            {notesOpen ? t("Скрыть, что нового") : t("Что нового")}
          </button>
          {notesOpen && (
            <ul className="update-notes">
              {notes.lines.map((l, i) => (
                <li key={i}>{l.replace(/^[-*]\s*/, "")}</li>
              ))}
              {notes.more && <li className="hint">{t("…и ещё — на странице выпуска")}</li>}
            </ul>
          )}
        </div>
      )}

      {u.phase === "downloading" && <Progress u={u} />}
      {u.phase === "error" && <p className="locked-note">{u.error}</p>}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {!info.asset ? (
          <span className="hint">
            {t("Установщика для этой системы нет — страница выпуска:")} <span className="mono">{info.page}</span>
          </span>
        ) : u.phase === "available" || u.phase === "error" ? (
          <>
            <button className="btn primary small" onClick={() => void download()}>
              <Download size={13} />
              {u.phase === "error" ? t("Скачать ещё раз") : t("Скачать обновление")}
            </button>
            <button className="btn small" onClick={() => void dismiss(true)}>
              {t("Пропустить эту версию")}
            </button>
            <button
              className="btn ghost small"
              title={t("Не проверять обновления при запуске — включается снова в «Настройках»")}
              onClick={() => {
                void dismiss(false);
                void saveSettings({ updateCheck: false });
              }}
            >
              {t("Больше не спрашивать")}
            </button>
          </>
        ) : u.phase === "ready" || u.phase === "installing" ? (
          <>
            <button className="btn primary small" disabled={u.phase === "installing"} onClick={() => void install()}>
              {u.phase === "installing" ? <LoaderCircle size={13} className="spin" /> : <RotateCw size={13} />}
              {platform === "windows" ? t("Установить и перезапустить") : t("Открыть установщик")}
            </button>
            <span className="hint">{platform === "windows" ? t("Проекты и настройки останутся") : t("Перетащите в «Программы»")}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** «Настройки» → «Обновления». */
export function UpdateSettings() {
  const u = useApp((s) => s.update);
  const settings = useApp((s) => s.settings);
  const info = useApp((s) => s.info);
  const saveSettings = useApp((s) => s.saveSettings);
  const check = useApp((s) => s.checkUpdate);
  const show = useApp((s) => s.showUpdate);
  const busy = u.phase === "checking";

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <label className="row" style={{ gap: 8, cursor: "pointer" }}>
        <input type="checkbox" checked={checkOnStart(settings)} onChange={(e) => void saveSettings({ updateCheck: e.target.checked })} />
        <span>
          {t("Проверять обновления при запуске")}
          <span className="hint" style={{ display: "block" }}>
            {t("Новая версия — карточкой в углу; скачивается и ставится только по кнопке. Без интернета — ничего не мешает.")}
          </span>
        </span>
      </label>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn small" disabled={busy || u.phase === "downloading" || u.phase === "installing"} onClick={() => void check(true)}>
          <RefreshCw size={13} className={busy ? "spin" : undefined} />
          {t("Проверить сейчас")}
        </button>
        <span className="hint grow">
          {busy
            ? t("Спрашиваю GitHub…")
            : u.phase === "none"
              ? (
                  <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <CircleCheck size={14} style={{ color: "var(--ok)" }} />
                    {t("У вас последняя версия — {v}", { v: info?.version ?? "" })}
                  </span>
                )
              : u.info?.newer
                ? t("Доступна версия {v}", { v: u.info.version })
                : u.phase === "error" && u.manual
                  ? u.error
                  : t("Установлена версия {v}", { v: info?.version ?? "" })}
        </span>
        {u.info?.newer && u.hidden && (
          <button className="btn primary small" onClick={show}>
            <Download size={13} />
            {u.phase === "downloading" ? t("Показать загрузку") : u.phase === "ready" ? t("Установить") : t("Обновить")}
          </button>
        )}
      </div>
      {settings.updateSkip && (
        <p className="hint">
          {t("Пропущена версия {v} — при запуске не предлагается.", { v: settings.updateSkip })}{" "}
          <button className="link" onClick={() => void saveSettings({ updateSkip: undefined })}>
            {t("Снова предлагать")}
          </button>
        </p>
      )}
    </div>
  );
}
