// Страница коптера. «Новичок» — мастер «По шагам» и «Настройка полёта»
// (ползунки без имён настроек); «Профи» — вкладки как в конфигураторе
// Betaflight — «Коптер»
// (сборка, переход с BF, первая настройка), «Я с Betaflight» (где у нас что),
// «Подготовка», «Приёмник»,
// «Режимы», «Моторы», «PID», «Расходы», «Фильтры», «Безопасность»,
// «Питание», «Видео», «OSD», «GPS», «Чёрный ящик», «Прочее», «CLI». Настройки живут
// на плате: правка уходит на плату сразу, «Сохранить» — во флеш. Поиск в
// шапке находит настройку по имени BF или словами и подсвечивает её.

import { CircleDot, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { findCopterEnv } from "../core/copter";
import { BEGINNER_TABS, CopterMode, CopterTab, tabsFor } from "../core/copterParams";
import { betaflightPort, runCopterFlash } from "../flash";
import { t } from "../i18n";
import { useApp } from "../store";
import { FlashDialog } from "./board/FlashDialog";
import { Seg } from "./ui";
import { UnsavedBar, useCopterLink, useCopterLive } from "./copter/common";
import { BeeperTab } from "./copter/BeeperTab";
import { FlightTab } from "./copter/FlightTab";
import { GpsTab } from "./copter/GpsTab";
import { CliTab, FailsafeTab, ListTab, OtherTab, PowerTab, VtxTab } from "./copter/MiscTabs";
import { ModesTab } from "./copter/ModesTab";
import { MotorsTab } from "./copter/MotorsTab";
import { OsdTab } from "./copter/OsdTab";
import { OverviewTab } from "./copter/OverviewTab";
import { ReceiverTab } from "./copter/ReceiverTab";
import { CopterSearch, FromBfTab, GoTo } from "./copter/Search";
import { SetupTab } from "./copter/SetupTab";
import { FiltersTab, PidTab, RatesTab } from "./copter/TuneTabs";
import { Wizard } from "./copter/Wizard";

export function CopterView() {
  const copter = useApp((s) => s.currentCopter());
  const manifest = useApp((s) => s.manifest);
  const flash = useApp((s) => s.flash);
  const setSection = useApp((s) => s.setSection);
  const mode: CopterMode = useApp((s) => s.settings.copterMode ?? "beginner");
  const saveSettings = useApp((s) => s.saveSettings);
  const tabs = tabsFor(mode);
  const [picked, setTab] = useState<CopterTab>(tabs[0].id);
  // сменили режим — вкладки другого режима нет: первая своя
  const tab = tabs.some((x) => x.id === picked) ? picked : tabs[0].id;
  const [focus, setFocus] = useState<{ param: string; at: number } | null>(null);
  const link = useCopterLink();
  const live = useCopterLive();
  const fc = useApp((s) => s.fc);

  // найденная настройка: прокрутить к ней и подсветить, когда вкладка нарисована
  useEffect(() => {
    if (!focus) return;
    let el: HTMLElement | null = null;
    const show = setTimeout(() => {
      el = document.querySelector<HTMLElement>(`[data-param="${focus.param}"]`);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      el?.classList.add("found");
    }, 30);
    const hide = setTimeout(() => el?.classList.remove("found"), 2500);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
      el?.classList.remove("found");
    };
  }, [focus, tab]);

  /** Поиск и «Я с Betaflight»: вкладка другого режима — переключить режим. */
  const go: GoTo = (to, param) => {
    const want: CopterMode = BEGINNER_TABS.some((x) => x.id === to) ? "beginner" : "pro";
    if (want !== mode) void saveSettings({ copterMode: want });
    setTab(to);
    setFocus(param ? { param, at: Date.now() } : null);
  };

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
        <div className="row" style={{ gap: 10 }}>
          <CopterSearch onGo={go} />
          <Seg
            value={mode}
            onChange={(m) => void saveSettings({ copterMode: m })}
            options={[
              { value: "beginner", label: t("Новичок"), title: t("Мастер по шагам и несколько ползунков — без имён настроек") },
              { value: "pro", label: t("Профи"), title: t("Все вкладки и все настройки, имена как в Betaflight") },
            ]}
          />
          <button className="btn primary" disabled={!!blocker || !!flash?.running || link.armed} title={blocker ?? undefined} onClick={() => void runCopterFlash(copter.id)}>
            <Zap size={16} />
            {t("Прошить")}
          </button>
        </div>
      </div>
      <UnsavedBar />
      <div className="copter-layout">
        <nav className="copter-tabs">
          {tabs.map((x) => (
            <button key={x.id} className={`copter-tab${tab === x.id ? " on" : ""}${x.board && !link.copter ? " dim" : ""}`} onClick={() => setTab(x.id)}>
              {t(x.title)}
            </button>
          ))}
        </nav>
        <div className="copter-content">
          {tab === "wizard" && <Wizard copter={copter} />}
          {tab === "flight" && <FlightTab />}
          {tab === "overview" && <OverviewTab copter={copter} />}
          {tab === "frombf" && <FromBfTab onGo={go} />}
          {tab === "setup" && <SetupTab />}
          {tab === "receiver" && <ReceiverTab />}
          {tab === "modes" && <ModesTab />}
          {tab === "motors" && <MotorsTab />}
          {tab === "pid" && <PidTab />}
          {tab === "rates" && <RatesTab />}
          {tab === "filters" && <FiltersTab />}
          {tab === "failsafe" && <FailsafeTab />}
          {tab === "power" && <PowerTab />}
          {tab === "vtx" && <VtxTab />}
          {tab === "osd" && <OsdTab />}
          {tab === "gps" && <GpsTab />}
          {tab === "blackbox" && <ListTab tab="blackbox" />}
          {tab === "beeper" && <BeeperTab />}
          {tab === "other" && <OtherTab />}
          {tab === "cli" && <CliTab />}
        </div>
      </div>
      {flash && <FlashDialog />}
    </div>
  );
}
