import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { api, DriverStatus, errorText, onTaskLog } from "../api";
import { t } from "../i18n";
import { useApp } from "../store";
import { Section } from "./ui";

function PlatformioCard() {
  const info = useApp((s) => s.info);
  const refreshInfo = useApp((s) => s.refreshInfo);
  const toast = useApp((s) => s.toast);
  const [installing, setInstalling] = useState(false);
  const [line, setLine] = useState("");

  const install = async () => {
    setInstalling(true);
    setLine(t("Готовлю установку…"));
    const unlisten = await onTaskLog((l) => l.task === "pio-install" && setLine(l.line));
    try {
      await api.platformioInstall();
      toast("ok", t("PlatformIO установлен. Первая сборка докачает компилятор — это несколько минут."));
      await refreshInfo();
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      unlisten();
      setInstalling(false);
    }
  };

  if (info?.pio) {
    return (
      <div className="kv">
        <span>PlatformIO</span>
        <span className="mono">{info.pio}</span>
        <span>Python</span>
        <span className="mono">{info.python ?? t("не найден")}</span>
      </div>
    );
  }
  return (
    <div>
      <div className="row">
        <div className="grow">
          <div style={{ fontWeight: 600 }}>{t("PlatformIO не найден")}</div>
          <div className="hint">
            {t("Им приложение собирает прошивку. Поставит сам: официальный установщик, а если нет Python — сначала Python. Нужен интернет, ~5 минут.")}
          </div>
        </div>
        <button className="btn primary" disabled={installing} onClick={() => void install()}>
          <Download size={15} className={installing ? "spin" : undefined} />
          {installing ? t("Ставлю…") : t("Установить PlatformIO")}
        </button>
      </div>
      {installing && (
        <div className="log mono" style={{ maxHeight: 60 }}>
          {line}
        </div>
      )}
    </div>
  );
}

function DriverCard() {
  const devices = useApp((s) => s.devices);
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<DriverStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const dfuPresent = devices.some((d) => d.kind === "stm32-dfu");

  useEffect(() => {
    if (!dfuPresent) {
      setStatus(null);
      return;
    }
    void api.dfuDriverStatus().then(setStatus).catch(() => setStatus(null));
  }, [dfuPresent]);

  const install = async () => {
    setBusy(true);
    try {
      const r = await api.dfuDriverInstall();
      toast(r.ok ? "ok" : "err", t(r.message));
      setStatus(await api.dfuDriverStatus());
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row">
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{t("Драйвер режима прошивки STM32")}</div>
        <div className="hint">
          {!dfuPresent
            ? t("Нужен один раз на компьютер. Проверить можно, когда плата в режиме прошивки — приложение само предложит его поставить при прошивке.")
            : status?.ok
              ? t("Установлен — плата в режиме прошивки видна прошивальщику.")
              : t("Плата в режиме прошивки видна Windows, но драйвера нет — без него не прошить.")}
        </div>
      </div>
      {dfuPresent && status && !status.ok && (
        <button className="btn primary" disabled={busy} onClick={() => void install()}>
          {busy ? t("Ставлю…") : t("Установить драйвер")}
        </button>
      )}
      {dfuPresent && status?.ok && <span className="badge ok">{t("установлен")}</span>}
    </div>
  );
}

export function Settings() {
  const info = useApp((s) => s.info);
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const reloadManifest = useApp((s) => s.reloadManifest);
  const manifest = useApp((s) => s.manifest);
  const manifestError = useApp((s) => s.manifestError);
  const loading = useApp((s) => s.manifestLoading);
  const [source, setSource] = useState(settings.firmwareSource ?? "");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [versions, setVersions] = useState<string[] | null>(null);
  const [version, setVersion] = useState(settings.firmwareVersion ?? "");

  const loadVersions = async () => {
    try {
      setVersions(await api.firmwareVersions());
    } catch (e) {
      setFetchError(errorText(e));
      setVersions([]);
    }
  };

  const fetchGithub = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      // Пусто — последний выпуск; выпусков нет — main.
      let want = version;
      if (!want) {
        const list = versions ?? (await api.firmwareVersions().catch(() => []));
        want = list[0] ?? "main";
      }
      const dir = await api.firmwareFetchGithub(want);
      setSource(dir);
      await saveSettings({ firmwareSource: dir, firmwareVersion: version || undefined });
    } catch (e) {
      setFetchError(errorText(e));
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1>{t("Настройки")}</h1>
          <p>{t("Где лежат исходники прошивки и чем её собирать.")}</p>
        </div>
      </div>

      <Section title={t("Исходники прошивки")} sub={t("папка репозитория plane (OpenPlaneProject)")}>
        <div className="card">
          <div className="row">
            <input className="input grow mono" value={source} onChange={(e) => setSource(e.target.value)} />
            <button
              className="btn"
              disabled={!source.trim() || source === settings.firmwareSource}
              onClick={() => void saveSettings({ firmwareSource: source.trim() })}
            >
              {t("Сохранить")}
            </button>
            <button className="btn ghost" onClick={() => void reloadManifest()} title={t("Перечитать описание прошивки")}>
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
            </button>
          </div>
          <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            <select
              className="select"
              value={version}
              onFocus={() => versions === null && void loadVersions()}
              onChange={(e) => setVersion(e.target.value)}
              title={t("Какую версию прошивки взять")}
            >
              <option value="">{versions?.length ? t("последний выпуск ({v})", { v: versions[0] }) : t("последний выпуск")}</option>
              {(versions ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              <option value="main">{t("main — самое свежее, без выпуска")}</option>
            </select>
            <button className="btn small" disabled={fetching} onClick={() => void fetchGithub()}>
              <RefreshCw size={13} className={fetching ? "spin" : undefined} />
              {t("Взять с GitHub")}
            </button>
            <span className="hint">
              {versions && !versions.length
                ? t("выпусков пока нет — возьмётся main")
                : t("скачает OpenPlaneProject в папку приложения (нужен git) — если своей копии исходников нет")}
            </span>
          </div>
          {fetchError && <p className="locked-note">{fetchError}</p>}
          {info?.firmware_guess && info.firmware_guess !== source && (
            <p className="hint">
              {t("Найдено автоматически:")}{" "}
              <button className="link" onClick={() => setSource(info.firmware_guess!)}>
                {info.firmware_guess}
              </button>
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            {manifest ? (
              <span className="badge ok">
                {t("прошивка прочитана: плат {b}, параметров {p}, режимов {m}", {
                  b: manifest.boards.length,
                  p: manifest.params.length,
                  m: manifest.modes.length,
                })}
              </span>
            ) : (
              <span className="badge err">{manifestError ?? t("не прочитана")}</span>
            )}
          </div>
          <p className="hint">
            {t("Приложение не меняет файлы в этой папке: для сборки оно копирует исходники в свою папку и записывает конфигурацию туда.")}
          </p>
        </div>
      </Section>

      <Section title={t("Сборка и прошивка")}>
        <div className="card" style={{ display: "grid", gap: 16 }}>
          <PlatformioCard />
          <DriverCard />
        </div>
      </Section>

      <Section title={t("Папки")}>
        <div className="card kv">
          <span>{t("Ангар")}</span>
          <span className="mono">{info?.hangar_dir}</span>
          <span>{t("Сборки")}</span>
          <span className="mono">{info?.cache_dir}</span>
          <span>{t("Версия")}</span>
          <span>OpenPlane Studio {info?.version}</span>
        </div>
      </Section>
    </div>
  );
}
