// Подсказка, которая растёт вместе с пилотом (P06): одна карточка над
// первой вкладкой коптера — по заметкам из открытых журналов и профилю.

import { Lightbulb } from "lucide-react";

import { profileOf, togglePack } from "../../core/pilot";
import { dismiss, EMPTY_LEARN, pickTip } from "../../core/tips";
import { t } from "../../i18n";
import { useApp } from "../../store";
import type { GoTo } from "./Search";

export function TipCard({ onGo }: { onGo: GoTo }) {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const learn = settings.learn ?? EMPTY_LEARN;
  const profile = profileOf(settings);
  const tip = pickTip(profile, learn);
  if (!tip) return null;
  const done = () => void saveSettings({ learn: dismiss(learn, tip.id) });
  const act = () => {
    const a = tip.action!;
    if (a.kind === "tab") onGo(a.tab);
    else void saveSettings({ pilot: togglePack(profile, a.pack), learn: dismiss(learn, tip.id) });
  };
  return (
    <div className="card wide tip-card" style={{ marginBottom: 12 }}>
      <h3>
        <Lightbulb size={16} /> {t(tip.title)}
      </h3>
      <p className="sub">{t(tip.text, { v: tip.value ?? "" })}</p>
      <div className="row" style={{ gap: 8 }}>
        {tip.action && (
          <button className="btn small primary" onClick={act}>
            {t(tip.action.label)}
          </button>
        )}
        <button className="btn small" onClick={done}>
          {t("Понятно")}
        </button>
      </div>
    </div>
  );
}
