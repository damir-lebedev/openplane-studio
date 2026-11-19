// «Нет дрона — подбор» (P07): карточка в Ангаре, пока в знакомстве отвечено
// «Пока нет». Бюджет и путь — тут же; всё остальное — из ответов знакомства.

import { Gamepad2, ShoppingCart, X } from "lucide-react";
import { useState } from "react";

import { advise, BUDGETS, Budget, BuyPath, compatibleBoards, fmtUsd, PATHS, ShopItem } from "../core/advisor";
import { copterEnvs } from "../core/copter";
import { profileOf } from "../core/pilot";
import { t } from "../i18n";
import { useApp } from "../store";
import { Seg } from "./ui";

function Row({ x }: { x: ShopItem }) {
  return (
    <div className="dpick-row">
      <div className="grow">
        <b>{t(x.what)}</b>
        <div className="hint">{t(x.why)}</div>
      </div>
      <span className="dpick-usd">{t(fmtUsd(x.usd))}</span>
    </div>
  );
}

export function DronePicker() {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const manifest = useApp((s) => s.manifest);
  const profile = profileOf(settings);
  const [budget, setBudget] = useState<Budget>("mid");
  const [path, setPath] = useState<BuyPath>("bnf");
  if (profile.hasDrone !== false) return null;

  const a = advise(profile, budget, path);
  const boards = compatibleBoards(a.cls, copterEnvs(manifest), manifest?.boards ?? []);
  const e = path === "build" ? a.estimate : null;
  return (
    // Свои классы dpick-*: общий «.pick» — это строка списка (flex в ряд), он клал
    // всю карточку в одну строку, и на телефоне Ангар листался вбок.
    <div className="card dpick" aria-label={t("Подбор дрона")}>
      <div className="dpick-head">
        <span className="dpick-icon">
          <ShoppingCart size={18} />
        </span>
        <div className="grow">
          <h3>{t("Подбор дрона")}</h3>
          <div className="hint">{t(a.reason)}</div>
        </div>
        <button className="btn ghost small" onClick={() => void saveSettings({ pilot: { ...profile, hasDrone: true } })}>
          <X size={15} />
          <span>{t("Дрон уже есть")}</span>
        </button>
      </div>

      <div className="dpick-ask">
        <div className="dpick-q">
          <span className="hint">{t("Бюджет")}</span>
          <Seg value={budget} options={BUDGETS.map((b) => ({ value: b.id, label: t(b.title), title: t(b.desc) }))} onChange={setBudget} />
        </div>
        <div className="dpick-q">
          <span className="hint">{t("Как")}</span>
          <Seg value={path} options={PATHS.map((p) => ({ value: p.id, label: t(p.title), title: t(p.desc) }))} onChange={setPath} />
        </div>
      </div>

      <div className="dpick-body">
        <div className="dpick-col">
          <div className="dpick-main">
            <Row x={a.drone} />
            {a.whoopFirst && <p className="sub">{t("Ты только начинаешь: сначала симулятор и вуп, этот — вторым.")}</p>}
          </div>

          {path === "build" && a.parts.length > 0 && (
            <>
              <h4>{t("Детали")}</h4>
              <div className="dpick-parts">
                {a.parts.map((p) => (
                  <span key={p.id} className="badge">
                    {t(p.title)}
                  </span>
                ))}
              </div>
            </>
          )}
          {e && (
            <div className="parts-stats">
              <div>
                <span className="hint">{t("Тяговооружённость")}</span>
                <b>{e.thrustToWeight.toFixed(1)}</b>
              </div>
              <div>
                <span className="hint">{t("Висеть, минут")}</span>
                <b>{e.hoverMinutes !== null ? `≈ ${Math.round(e.hoverMinutes)}` : "—"}</b>
              </div>
            </div>
          )}

          <h4>{t("Ещё понадобится")}</h4>
          {a.gear.map((x) => (
            <Row key={x.what} x={x} />
          ))}
          <div className="dpick-row total">
            <b className="grow">{t("Всего")}</b>
            <span className="dpick-usd">{fmtUsd(a.total)}</span>
          </div>
          {a.overBudget && <div className="issue warning">{t("Дороже выбранного бюджета: начни с симулятора и вупа, остальное — постепенно.")}</div>}
        </div>

        <div className="dpick-col">
          <h4>
            <Gamepad2 size={16} /> {t("Пока едет — симулятор")}
          </h4>
          <p className="sub">{t("Пульт подключается к компьютеру по USB как джойстик. 10–20 часов в симуляторе сберегут не один дрон.")}</p>
          {a.sim.map((x) => (
            <Row key={x.what} x={x} />
          ))}

          <h4>{t("Полётники с нашей прошивкой")}</h4>
          <p className="sub">{boards.length ? boards.join(" · ") : t("Список появится, когда приложение найдёт исходники прошивки.")}</p>
          {path === "bnf" && <p className="hint">{t("У готового дрона полётник свой: на нём Betaflight, перенесём настройки при подключении.")}</p>}
          <p className="hint dpick-note">{t("Цены — ориентир в долларах, у магазинов они другие.")}</p>
        </div>
      </div>
    </div>
  );
}
