// «Настройка с пульта» (188): PID, расходы, VTX из Lua-скриптов Betaflight на
// EdgeTX — прошивка отвечает на их MSP через CRSF (plane: copter/CrsfMsp.h).
// Здесь — что для этого должно быть на плате, по шагам.

import { N_ } from "../i18n";
import { CopterBoard } from "./copterParams";

export interface RadioStep {
  key: "crsf" | "telemetry" | "lua" | "menu";
  /** null — проверить нельзя (на стороне пульта) */
  ok: boolean | null;
  title: string;
  hint: string;
  /** одна настройка исправляет шаг */
  fix?: { name: string; value: string; label: string };
}

const val = (b: CopterBoard, name: string) => String(b.params[name]?.value ?? "").toUpperCase();

export function radioSetupSteps(b: CopterBoard): RadioStep[] {
  const crsf = val(b, "serialrx_provider") === "CRSF";
  const telemetry = val(b, "crsf_telemetry") !== "OFF";
  return [
    {
      key: "crsf",
      ok: crsf,
      title: N_("Приёмник по CRSF"),
      hint: crsf
        ? N_("ExpressLRS или Crossfire — запросы с пульта идут тем же проводом, что и стики.")
        : N_("Настройка с пульта работает только с CRSF (ExpressLRS, Crossfire). С SBUS и IBUS обратного канала нет."),
    },
    {
      key: "telemetry",
      ok: telemetry,
      title: N_("Телеметрия в пульт"),
      hint: telemetry
        ? N_("Ответы идут вместо кадров телеметрии. В ELRS Lua «Telem Ratio» 1:2–1:8 — страницы грузятся быстрее.")
        : N_("Без телеметрии полётник не отвечает пульту: страницы в Lua не загрузятся."),
      fix: telemetry ? undefined : { name: "crsf_telemetry", value: "ON", label: N_("Включить телеметрию") },
    },
    {
      key: "lua",
      ok: null,
      title: N_("Lua-скрипты Betaflight на SD пульта"),
      hint: N_("Пульт по USB — режим «USB Storage (SD)». Скрипты кладутся в SCRIPTS/TOOLS, свои файлы на карте остаются."),
    },
    {
      key: "menu",
      ok: null,
      title: N_("На пульте: SYS → Tools → Betaflight setup"),
      hint: N_("PID, расходы, фильтры, VTX — изменения сохраняются кнопкой «Save» в меню скрипта; без ARM. VTX Administrator в ELRS Lua тоже работает."),
    },
  ];
}

/** Всё на плате готово (остальное — на пульте). */
export const radioReady = (b: CopterBoard) => radioSetupSteps(b).every((s) => s.ok !== false);
