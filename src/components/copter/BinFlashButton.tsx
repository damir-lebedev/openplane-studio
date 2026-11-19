// Телефон (P48): «Прошить файлом» — готовый .bin из релиза или экспорт с ПК.
// Выбор файла — обычный <input type=file>: Android WebView открывает системный
// выбор файлов (RustWebChromeClient.onShowFileChooser), плагин не нужен.
// accept не ставим: у .bin нет своего MIME, файл проверяет checkBin.

import { FileUp } from "lucide-react";
import { useRef } from "react";
import { runBinFlash } from "../../flash";
import { t } from "../../i18n";

export function BinFlashButton({ copterId, disabled }: { copterId: string; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn primary" disabled={disabled} title={t("Готовый .bin: из релиза на GitHub или «Экспорт для телефона» в Studio на компьютере")} onClick={() => input.current?.click()}>
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
