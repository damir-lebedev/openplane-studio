import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { formatValue, outOfRange, paramState, parseInput, rangeText, setParamValue } from "../../core/params";
import { pinChoices } from "../../core/pins";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Toggle } from "../ui";

/** Редактор значения одного параметра (без подписи) — для таблицы и мастера. */
export function ParamEditor({ name }: { name: string }) {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const st = paramState(manifest, plane, name);
  const [text, setText] = useState(st ? formatValue(st.value) : "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (st) setText(st.param.kind === "string" ? String(st.value ?? "") : formatValue(st.value));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.value, name, plane.board]);

  if (!st) return <span className="hint">—</span>;
  const p = st.param;
  const set = (value: unknown) => updatePlane((pl) => setParamValue(manifest, pl, name, value));

  if (p.fixed) {
    return (
      <span className="mono muted" title={t("Параметр протокола — не настраивается")}>
        {formatValue(st.value)} 🔒
      </span>
    );
  }
  if (p.kind === "pin") {
    const choices = pinChoices(manifest, plane, name);
    if (choices) {
      const current = String(st.value);
      const good = choices.filter((c) => c.ok && !c.usedBy);
      const busy = choices.filter((c) => c.ok && c.usedBy);
      const bad = choices.filter((c) => !c.ok);
      const known = choices.some((c) => String(c.value) === current) || current === "-1";
      const mine = choices.find((c) => String(c.value) === current);
      return (
        <div className="row" style={{ gap: 6 }}>
          <select
            className="select mono pin-select"
            value={current}
            onChange={(e) => {
              const v = e.target.value;
              set(/^-?\d+$/.test(v) ? Number(v) : v);
            }}
          >
            <option value="-1">{t("— не разведён")}</option>
            {!known && <option value={current}>{current}</option>}
            <optgroup label={t("Подходят")}>
              {good.map((c) => (
                <option key={String(c.value)} value={String(c.value)} title={c.note}>
                  {c.label}
                  {c.note ? " ⚠" : ""}
                </option>
              ))}
            </optgroup>
            {busy.length > 0 && (
              <optgroup label={t("Подходят, но заняты")}>
                {busy.map((c) => (
                  <option key={String(c.value)} value={String(c.value)} title={c.note}>
                    {c.label} · {c.usedBy}
                  </option>
                ))}
              </optgroup>
            )}
            {bad.length > 0 && (
              <optgroup label={t("Не подходят")}>
                {bad.map((c) => (
                  <option key={String(c.value)} value={String(c.value)} disabled title={c.note}>
                    {c.label} — {c.note}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {mine?.note && <span className={`hint${mine.ok ? "" : " pin-bad"}`}>{mine.note}</span>}
        </div>
      );
    }
  }
  switch (p.kind) {
    case "bool":
      return <Toggle on={st.value === true} onChange={set} />;
    case "enum":
      return (
        <select className="select" value={String(st.value).split("::").pop()} onChange={(e) => set(e.target.value)}>
          {(p.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "channel":
      return (
        <select className="select" value={String(st.value).split("::").pop()} onChange={(e) => set(e.target.value)}>
          {manifest.channels.list
            .filter((c) => !c.stick && c.name !== "ARM")
            .map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} (CH{c.index + 1})
              </option>
            ))}
        </select>
      );
    case "array": {
      const values = Array.isArray(st.value) ? (st.value as unknown[]) : [];
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
          {values.map((v, i) => (
            <label key={i} className="row" style={{ gap: 8 }} title={p.itemNotes?.[i] ? t(p.itemNotes[i]) : undefined}>
              <Toggle
                on={v === true}
                onChange={(nv) => {
                  const next = values.slice();
                  next[i] = nv;
                  set(next);
                }}
              />
              <span className="hint">{(p.itemNotes?.[i] ? t(p.itemNotes[i]) : "").split("—")[0].trim() || `#${i + 1}`}</span>
            </label>
          ))}
        </div>
      );
    }
    case "float":
    case "int":
    case "pin":
    case "string":
      return (
        <div className="row" style={{ gap: 6 }}>
          <input
            className={`input mono${error ? " bad" : ""}`}
            style={{ width: p.kind === "string" ? 220 : 110 }}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const r = parseInput(p, e.target.value);
              setError(r.ok ? null : r.error);
            }}
            onBlur={() => {
              const r = parseInput(p, text);
              if (r.ok) set(r.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setText(formatValue(st.value));
            }}
          />
          {p.unit && <span className="hint">{t(p.unit)}</span>}
          {error && <span className="hint" style={{ color: "#ff8f88" }}>{error}</span>}
          {!error && p.range && (
            <span
              className={`hint range${outOfRange(p, st.value) ? " out" : ""}`}
              title={outOfRange(p, st.value) ? t("За разумными пределами — прошивка соберётся, но проверьте, что так и задумано") : t("Разумные пределы из прошивки")}
            >
              {outOfRange(p, st.value) ? t("обычно {r}!", { r: rangeText(p, false) ?? "" }) : t("обычно {r}", { r: rangeText(p, false) ?? "" })}
            </span>
          )}
        </div>
      );
    default:
      return <span className="mono muted">{p.expr}</span>;
  }
}

/** Параметр с подписью и описанием — для шагов мастера в полном режиме. */
export function ParamField({ name, label, hint }: { name: string; label?: string; hint?: string }) {
  const manifest = useApp((s) => s.manifest);
  const plane = useApp((s) => s.current());
  const updatePlane = useApp((s) => s.updatePlane);
  const [open, setOpen] = useState(false);
  if (!manifest || !plane) return null;
  const st = paramState(manifest, plane, name);
  if (!st) return null;
  const doc = (hint ?? t(st.param.note)) || t(st.param.doc);
  return (
    <div className="card" style={{ padding: "12px 14px", marginBottom: 8 }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <div style={{ fontWeight: 600 }}>
            {label ?? name}{" "}
            {label && <span className="mono hint">{name}</span>}
            {st.changed && <span className="badge accent" style={{ marginLeft: 6 }}>{t("изменён")}</span>}
          </div>
          {doc && (
            <div
              className="hint"
              style={{ whiteSpace: open ? "pre-wrap" : "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", maxWidth: 680 }}
              onClick={() => setOpen(!open)}
              title={open ? undefined : t("Показать описание целиком")}
            >
              {doc}
            </div>
          )}
        </div>
        <ParamEditor name={name} />
        {st.changed && !st.param.fixed && (
          <button
            className="btn ghost small"
            title={t("Вернуть значение из прошивки: {v}", { v: formatValue(st.firmware) })}
            onClick={() => updatePlane((pl) => setParamValue(manifest, pl, name, st.firmware))}
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
