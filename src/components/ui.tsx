import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

import { t } from "../i18n";

export function Modal({
  children,
  onClose,
  width,
}: {
  children: ReactNode;
  onClose?: () => void;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" style={width ? { width: `min(${width}px, calc(100vw - 40px))` } : undefined}>
        {children}
      </div>
    </div>
  );
}

export function Choice({
  title,
  desc,
  icon,
  selected,
  disabled,
  note,
  badge,
  onClick,
  onHover,
}: {
  title: ReactNode;
  desc?: ReactNode;
  icon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  note?: ReactNode;
  badge?: ReactNode;
  onClick?: () => void;
  onHover?: (on: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={`choice${selected ? " selected" : ""}${disabled ? " disabled" : ""}`}
      onClick={() => !disabled && onClick?.()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && onClick?.()}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <div className="choice-title">
        {icon}
        <span>{title}</span>
      </div>
      {desc && <div className="choice-desc">{desc}</div>}
      {badge}
      {note && <div className="locked-note">{note}</div>}
      {selected && <Check size={16} className="choice-check" />}
    </div>
  );
}

export function Toggle({ on, disabled, onChange }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle${on ? " on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    />
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? "on" : ""}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      <div className="section-title">
        {title}
        {sub && <small>{sub}</small>}
      </div>
      {children}
    </div>
  );
}

/** «Дополнительно: …» — свёрнутые настройки шага; в полном режиме раскрыты. */
export function Advanced({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`advanced${open ? " open" : ""}`}>
      <button className="advanced-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span>{t("Дополнительно")}</span>
        <span className="advanced-title">{title}</span>
      </button>
      {open && <div className="advanced-body">{children}</div>}
    </div>
  );
}

export function StepHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="step-head">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
