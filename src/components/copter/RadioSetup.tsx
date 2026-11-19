// «Настройка с пульта» (188) во вкладке «Приёмник»: шаги по плате
// (core/radioSetup.ts), кнопки «Lua-скрипты Betaflight на SD пульта» (качаются
// с GitHub) и «Скрипт OpenPlane» (188b: из исходников прошивки, без
// интернета) и картинка — где их найти в EdgeTX.

import { CircleCheck, CircleX, Download, RadioTower } from "lucide-react";
import { useState } from "react";

import { api, errorText } from "../../api";
import { radioSetupSteps } from "../../core/radioSetup";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { useCopterBoard, useCopterLink } from "./common";

type Kind = "bf" | "oplane";

export function RadioSetupCard() {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const toast = useApp((s) => s.toast);
  const { armed } = useCopterLink();
  const source = useApp((s) => s.settings.firmwareSource ?? null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [cards, setCards] = useState<string[] | null>(null);
  const [kind, setKind] = useState<Kind>("bf");
  const steps = radioSetupSteps(board);

  async function write(what: Kind, sd: string) {
    if (what === "bf") {
      const r = await api.radioInstallLua(sd);
      toast("ok", t("Lua-скрипты Betaflight {v} на карте {sd}: {n} файлов.", { v: r.version, sd, n: r.files }));
    } else {
      const n = await api.radioInstallOplane(source ?? "", sd);
      toast("ok", t("Скрипт OpenPlane на карте {sd}: {n} файлов. На пульте: SYS → TOOLS → OpenPlane.", { sd, n }));
    }
  }

  /** Без `sd` — найти карту; одна — сразу пишем, несколько — спросить. */
  async function install(what: Kind, sd?: string) {
    setBusy(what);
    setKind(what);
    try {
      if (sd) {
        await write(what, sd);
        setCards(null);
      } else {
        const found = (await api.radioFindSd()) ?? [];
        setCards(found);
        if (found.length === 1) await write(what, found[0]);
      }
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card wide radio-setup">
      <h3>
        <RadioTower size={17} /> {t("Настройка с пульта")}
      </h3>
      <p className="sub">{t("PID, расходы и VTX прямо с пульта, без компьютера: Lua-скрипты Betaflight на EdgeTX работают с нашей прошивкой.")}</p>
      <div className="radio-setup-body">
        <ol className="radio-steps">
          {steps.map((s) => (
            <li key={s.key} className={s.ok === true ? "ok" : s.ok === false ? "bad" : ""}>
              <b>
                {s.ok === true && <CircleCheck size={15} />}
                {s.ok === false && <CircleX size={15} />} {t(s.title)}
              </b>
              <span className="hint">{t(s.hint)}</span>
              {s.fix && (
                <button className="btn small" disabled={armed} onClick={() => void set(s.fix!.name, s.fix!.value)}>
                  {t(s.fix.label)}
                </button>
              )}
              {s.key === "lua" && (
                <>
                  <button className="btn small" disabled={busy !== null} onClick={() => void install("bf")}>
                    <Download size={14} /> {busy === "bf" ? t("Качаю…") : t("Скачать на SD пульта")}
                  </button>
                  <button
                    className="btn small ghost"
                    disabled={busy !== null || !source}
                    title={source ? t("Свой скрипт OpenPlane: GPS Rescue, учебные ограничения, страницы OSD и экран телеметрии") : t("Не указана папка исходников прошивки (Настройки)")}
                    onClick={() => void install("oplane")}
                  >
                    <Download size={14} /> {busy === "oplane" ? t("Записываю…") : t("Скрипт OpenPlane на SD")}
                  </button>
                  {cards && cards.length === 0 && <span className="hint warn-text">{t("Карта пульта не найдена: подключите пульт по USB и выберите «USB Storage (SD)».")}</span>}
                  {cards && cards.length > 1 && (
                    <span className="hint">
                      {t("Несколько карт — на какую?")}{" "}
                      {cards.map((c) => (
                        <button key={c} className="btn small ghost" disabled={busy !== null} onClick={() => void install(kind, c)}>
                          {c}
                        </button>
                      ))}
                    </span>
                  )}
                </>
              )}
            </li>
          ))}
        </ol>
        <RadioScreen />
      </div>
    </div>
  );
}

/** Экран пульта (128×64, как у TX12): SYS → TOOLS, выбран Betaflight setup. */
export function RadioScreen() {
  const rows = ["ExpressLRS", "Betaflight setup", "Sensor discovery"];
  return (
    <svg viewBox="0 0 136 80" className="radio-screen" role="img" aria-label={t("Экран пульта: SYS → Tools → Betaflight setup")}>
      <rect x="1" y="1" width="134" height="78" rx="6" className="radio-bezel" />
      <rect x="4" y="4" width="128" height="64" className="radio-lcd" />
      <rect x="4" y="4" width="128" height="10" className="radio-title" />
      <text x="7" y="12" className="radio-text inv">SYS</text>
      <text x="68" y="12" className="radio-text inv" textAnchor="middle">TOOLS</text>
      {rows.map((r, i) => (
        <g key={r}>
          {i === 1 && <rect x="5" y={17 + i * 11} width="126" height="10" className="radio-sel" />}
          <text x="8" y={25 + i * 11} className={`radio-text${i === 1 ? " inv" : ""}`}>
            {r}
          </text>
        </g>
      ))}
      <text x="68" y="76" className="radio-key" textAnchor="middle">
        SYS ▸ TOOLS ▸ ENTER
      </text>
    </svg>
  );
}
