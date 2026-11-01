// Страница коптера: вкладки как в конфигураторе Betaflight — «Коптер»
// (сборка, переход с BF, первая настройка), «Подготовка», «Приёмник»,
// «Режимы», «Моторы», «PID», «Расходы», «Фильтры», «Безопасность»,
// «Питание», «Видео», «OSD», «GPS», «Чёрный ящик», «Прочее», «CLI». Настройки живут
// на плате: правка уходит на плату сразу, «Сохранить» — во флеш.

import { CircleDot, Zap } from "lucide-react";
import { useState } from "react";

import { findCopterEnv } from "../core/copter";
import { CopterTab, TABS } from "../core/copterParams";
import { betaflightPort, runCopterFlash } from "../flash";
import { t } from "../i18n";
import { useApp } from "../store";
import { FlashDialog } from "./board/FlashDialog";
import { UnsavedBar, useCopterLink, useCopterLive } from "./copter/common";
import { GpsTab } from "./copter/GpsTab";
import { CliTab, FailsafeTab, ListTab, OtherTab, PowerTab, VtxTab } from "./copter/MiscTabs";
import { ModesTab } from "./copter/ModesTab";
import { MotorsTab } from "./copter/MotorsTab";
import { OsdTab } from "./copter/OsdTab";
import { OverviewTab } from "./copter/OverviewTab";
import { ReceiverTab } from "./copter/ReceiverTab";
import { SetupTab } from "./copter/SetupTab";
import { PidTab, RatesTab } from "./copter/TuneTabs";

export function CopterView() {
  const copter = useApp((s) => s.currentCopter());
  const manifest = useApp((s) => s.manifest);
  const flash = useApp((s) => s.flash);
  const setSection = useApp((s) => s.setSection);
  const [tab, setTab] = useState<CopterTab>("overview");
  const link = useCopterLink();
  const live = useCopterLive();
  const fc = useApp((s) => s.fc);

  if (!copter) {
    return (
      <div className="page">
        <p className="muted">{t("Коптер не выбран.")}</p>
        <button className="btn" onClick={() => setSection("hangar")}>
          {t("В ангар")}
        </button>
      </div>
    );
  }

  const env = findCopterEnv(manifest, copter.board);
  const bfPort = betaflightPort();
  const blocker = !manifest
    ? t("Нет описания прошивки — укажите папку исходников в «Настройках».")
    : !env
      ? t("Выберите сборку прошивки.")
      : env.needsBoardDump && !copter.boardDump && !bfPort
        ? t("Подключите плату с родным Betaflight — распиновку приложение снимет само.")
        : null;
  const status = link.copter
    ? live?.arm
      ? { cls: "err", text: t("ARM — моторы крутятся") }
      : { cls: "ok", text: t("На связи: {board}", { board: link.identity!.board }) }
    : bfPort
      ? { cls: "warn", text: t("Betaflight {v} на {port}", { v: fc[bfPort]?.version ?? "", port: bfPort }) }
      : { cls: "off", text: t("Не подключён") };

  return (
    <div className="page copter-page">
      <div className="page-head">
        <div>
          <h1>{copter.name}</h1>
          <p>
            {t("Квадрокоптер")}
            {env ? ` · ${t(env.title)}` : ""}
            <span className={`link-chip ${status.cls}`}>
              <CircleDot size={11} />
              {status.text}
            </span>
          </p>
        </div>
        <button className="btn primary" disabled={!!blocker || !!flash?.running || link.armed} title={blocker ?? undefined} onClick={() => void runCopterFlash(copter.id)}>
          <Zap size={16} />
          {t("Прошить")}
        </button>
      </div>
      <UnsavedBar />
      <div className="copter-layout">
        <nav className="copter-tabs">
          {TABS.map((x) => (
            <button key={x.id} className={`copter-tab${tab === x.id ? " on" : ""}${x.board && !link.copter ? " dim" : ""}`} onClick={() => setTab(x.id)}>
              {t(x.title)}
            </button>
          ))}
        </nav>
        <div className="copter-content">
          {tab === "overview" && <OverviewTab copter={copter} />}
          {tab === "setup" && <SetupTab />}
          {tab === "receiver" && <ReceiverTab />}
          {tab === "modes" && <ModesTab />}
          {tab === "motors" && <MotorsTab />}
          {tab === "pid" && <PidTab />}
          {tab === "rates" && <RatesTab />}
          {tab === "filters" && <ListTab tab="filters" />}
          {tab === "failsafe" && <FailsafeTab />}
          {tab === "power" && <PowerTab />}
          {tab === "vtx" && <VtxTab />}
          {tab === "osd" && <OsdTab />}
          {tab === "gps" && <GpsTab />}
          {tab === "blackbox" && <ListTab tab="blackbox" />}
          {tab === "other" && <OtherTab />}
          {tab === "cli" && <CliTab />}
        </div>
      </div>
      {flash && <FlashDialog />}
    </div>
  );
}
