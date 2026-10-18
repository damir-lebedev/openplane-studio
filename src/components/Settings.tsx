import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { api, errorText } from "../api";
import { t } from "../i18n";
import { useApp } from "../store";
import { Section } from "./ui";

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

  const fetchGithub = async () => {
    setFetching(true);
    setFetchError(null);
    try {
      const dir = await api.firmwareFetchGithub();
      setSource(dir);
      await saveSettings({ firmwareSource: dir });
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
            <button className="btn" disabled={!source.trim() || source === settings.firmwareSource} onClick={() => void saveSettings({ firmwareSource: source.trim() })}>
              {t("Сохранить")}
            </button>
            <button className="btn ghost" onClick={() => void reloadManifest()} title={t("Перечитать описание прошивки")}>
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
            </button>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" disabled={fetching} onClick={() => void fetchGithub()}>
              <RefreshCw size={13} className={fetching ? "spin" : undefined} />
              {t("Взять с GitHub")}
            </button>
            <span className="hint">{t("скачает OpenPlaneProject в папку приложения (нужен git) — если своей копии исходников нет")}</span>
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
            {t(
              "Приложение не меняет файлы в этой папке: для сборки оно копирует исходники в свою папку и записывает конфигурацию туда.",
            )}
          </p>
        </div>
      </Section>

      <Section title={t("Инструменты")}>
        <div className="card kv">
          <span>PlatformIO</span>
          <span className="mono">{info?.pio ?? t("не найден — установите PlatformIO")}</span>
          <span>Python</span>
          <span className="mono">{info?.python ?? t("не найден")}</span>
          <span>{t("Папка ангара")}</span>
          <span className="mono">{info?.hangar_dir}</span>
          <span>{t("Папка сборок")}</span>
          <span className="mono">{info?.cache_dir}</span>
          <span>{t("Версия")}</span>
          <span>OpenPlane Studio {info?.version}</span>
        </div>
      </Section>
    </div>
  );
}
