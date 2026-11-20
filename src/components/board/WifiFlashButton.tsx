// Самолёт на ESP32 (P50): прошивка по WiFi — по точке доступа самолёта.
// ПК: «По WiFi» — собрать и отправить (компьютер подключают к сети самолёта сами),
// «Экспорт для телефона» — `<самолёт>-<env>.bin` в «Загрузки».
// Телефон: «Прошить по WiFi» — готовый файл; к сети Studio подключается сама.

import { Download, Wifi } from "lucide-react";
import { useRef } from "react";
import { isMobile } from "../../api";
import { isEspEnv, planeWifi } from "../../core/wifiFlash";
import { PlaneProject } from "../../core/project";
import { runWifiFlash } from "../../flash";
import { t } from "../../i18n";
import { useApp } from "../../store";

export function WifiFlashButton({ plane, disabled, blocker }: { plane: PlaneProject; disabled?: boolean; blocker?: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const manifest = useApp((s) => s.manifest);
  if (!manifest || !isEspEnv(plane.board)) return null;
  const { ssid } = planeWifi(manifest, plane);
  const how = t("Плата принимает прошивку только без ARM и с открытым окном: жест стиков (газ вниз, рысканье вправо, тангаж на себя — 3 с, рули кивнут 4 раза) или клавиша u в консоли. Окно живёт 5 минут.");

  if (isMobile()) {
    return (
      <>
        <button className="btn" disabled={disabled} title={t("Файл .bin — «Экспорт для телефона» в Studio на компьютере. Сеть «{ssid}». {how}", { ssid, how })} onClick={() => input.current?.click()}>
          <Wifi size={16} />
          {t("Прошить по WiFi")}
        </button>
        <input
          ref={input}
          type="file"
          hidden
          data-testid="wifi-bin-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void runWifiFlash(plane.id, file);
          }}
        />
      </>
    );
  }
  return (
    <>
      <button
        className="btn"
        disabled={disabled || !!blocker}
        title={blocker ?? t("Собрать и отправить по WiFi: подключите компьютер к сети «{ssid}». {how}", { ssid, how })}
        onClick={() => void runWifiFlash(plane.id, "build")}
      >
        <Wifi size={16} />
        {t("По WiFi")}
      </button>
      <button className="btn ghost small" disabled={disabled || !!blocker} title={blocker ?? t("Собрать файл .bin и прошить самолёт с телефона по WiFi")} onClick={() => void runWifiFlash(plane.id, "export")}>
        <Download size={16} />
        {t("Экспорт для телефона")}
      </button>
    </>
  );
}
