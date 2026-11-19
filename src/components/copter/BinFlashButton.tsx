// Телефон (P48): «Прошить файлом» — готовый .bin из релиза или экспорт с ПК.
// Выбор файла — обычный <input type=file>: Android WebView открывает системный
// выбор файлов (RustWebChromeClient.onShowFileChooser), плагин не нужен.
// accept не ставим: у .bin нет своего MIME, файл проверяет checkBin.

import { CloudDownload, FileUp } from "lucide-react";
import { useRef } from "react";
import { releaseEnv } from "../../core/binFile";
import { runBinFlash } from "../../flash";
import { t } from "../../i18n";
import { useApp } from "../../store";

export function BinFlashButton({ copterId, disabled }: { copterId: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  // сборка для релиза: плата на связи (@id), иначе выбранная у коптера
  const env = useApp((s) => {
    const port = s.link.state === "open" ? s.link.port : null;
    const copter = s.copters.find((c) => c.id === copterId);
    return releaseEnv(port ? s.ports[port]?.identity?.board : null, copter?.board);
  });
  return (
    <>
      {env && (
        <button className="btn primary" disabled={disabled} title={t("firmware-{env}.bin из последнего релиза OpenPlane Studio на GitHub", { env })} onClick={() => void runBinFlash(copterId, { release: true })}>
          <CloudDownload size={16} />
          {t("Скачать и прошить")}
        </button>
      )}
      <button className={env ? "btn" : "btn primary"} disabled={disabled} title={t("Готовый .bin: из релиза на GitHub или «Экспорт для телефона» в Studio на компьютере")} onClick={() => input.current?.click()}>
        <FileUp size={16} />
        {t("Прошить файлом")}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        data-testid="bin-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // тот же файл ещё раз — снова onChange
          if (file) void runBinFlash(copterId, file);
        }}
      />
    </>
  );
}
