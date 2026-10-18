import { Cpu, HardDrive, Package, RadioTower, Route, Settings, Warehouse } from "lucide-react";
import { ReactNode } from "react";

import { t } from "../i18n";
import { Section, useApp } from "../store";

const ITEMS: { id: Section; label: string; icon: ReactNode; soon?: boolean }[] = [
  { id: "hangar", label: "Ангар", icon: <Warehouse size={21} /> },
  { id: "board", label: "Плата", icon: <Cpu size={21} /> },
  { id: "flights", label: "Полёты", icon: <Route size={21} />, soon: true },
  { id: "live", label: "Онлайн", icon: <RadioTower size={21} />, soon: true },
  { id: "blackbox", label: "Ящик", icon: <HardDrive size={21} />, soon: true },
  { id: "cargo", label: "Грузы", icon: <Package size={21} />, soon: true },
];

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg className="rail-logo" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#16263a" />
          <stop offset="1" stopColor="#0a1118" />
        </linearGradient>
        <linearGradient id="lg-fg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fe6ff" />
          <stop offset="1" stopColor="#1c9fd3" />
        </linearGradient>
      </defs>
      <rect x="40" y="40" width="944" height="944" rx="210" fill="url(#lg-bg)" stroke="#2b4560" strokeWidth="8" />
      <path
        d="M512 150c30 0 46 40 46 92v170l300 54c22 4 32 18 32 38v34l-332-24-6 186 128 62v40l-168-22-168 22v-40l128-62-6-186-332 24v-34c0-20 10-34 32-38l300-54V242c0-52 16-92 46-92z"
        fill="url(#lg-fg)"
      />
    </svg>
  );
}

export function Rail() {
  const section = useApp((s) => s.section);
  const setSection = useApp((s) => s.setSection);
  return (
    <nav className="rail">
      <Logo />
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={`rail-item${section === item.id ? " active" : ""}`}
          onClick={() => setSection(item.id)}
          title={item.soon ? t("{label} — скоро", { label: t(item.label) }) : t(item.label)}
        >
          {item.icon}
          {t(item.label)}
          {item.soon && <span className="soon" />}
        </button>
      ))}
      <div className="rail-spacer" />
      <button
        className={`rail-item${section === "settings" ? " active" : ""}`}
        onClick={() => setSection("settings")}
        title={t("Настройки")}
      >
        <Settings size={20} />
        {t("Настройки")}
      </button>
    </nav>
  );
}
