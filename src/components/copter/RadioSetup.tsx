// «Настройка с пульта» (188) во вкладке «Приёмник»: шаги по плате
// (core/radioSetup.ts), кнопка «Lua-скрипты на SD пульта» и картинка — где
// их найти в EdgeTX.

import { CircleCheck, CircleX, Download, RadioTower } from "lucide-react";
import { useState } from "react";

import { api, errorText } from "../../api";
import { radioSetupSteps } from "../../core/radioSetup";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { useCopterBoard, useCopterLink } from "./common";

export function RadioSetupCard() {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const toast = useApp((s) => s.toast);
  const { armed } = useCopterLink();
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<string[] | null>(null);
  const steps = radioSetupSteps(board);

  async function install() {
    setBusy(true);
    try {
      const found = (await api.radioFindSd()) ?? [];
      setCards(found);
      if (found.length === 1) {
        const r = await api.radioInstallLua(found[0]);
        toast("ok", t("Lua-скрипты Betaflight {v} на карте {sd}: {n} файлов.", { v: r.version, sd: found[0], n: r.files }));
      }
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function installTo(sd: string) {
    setBusy(true);
    try {
      const r = await api.radioInstallLua(sd);
      toast("ok", t("Lua-скрипты Betaflight {v} на карте {sd}: {n} файлов.", { v: r.version, sd, n: r.files }));
      setCards(null);
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
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
                  <button className="btn small" disabled={busy} onClick={() => void install()}>
                    <Download size={14} /> {busy ? t("Качаю…") : t("Скачать на SD пульта")}
                  </button>
                  {cards && cards.length === 0 && <span className="hint warn-text">{t("Карта пульта не найдена: подключите пульт по USB и выберите «USB Storage (SD)».")}</span>}
                  {cards && cards.length > 1 && (
                    <span className="hint">
                      {t("Несколько карт — на какую?")}{" "}
                      {cards.map((c) => (
                        <button key={c} className="btn small ghost" disabled={busy} onClick={() => void installTo(c)}>
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
