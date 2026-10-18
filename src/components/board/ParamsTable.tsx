import { RotateCcw, Search } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { findBoard, paramsForBoard } from "../../core/manifest";
import { formatValue, paramState, setParamValue } from "../../core/params";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { ParamEditor } from "./ParamField";

export function ParamsTable() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const board = findBoard(manifest, plane.board);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return paramsForBoard(manifest, board?.macro ?? null)
      .map((p) => ({ p, st: paramState(manifest, plane, p.name)! }))
      .filter(({ p, st }) => {
        if (onlyChanged && !st.changed) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.doc.toLowerCase().includes(q) ||
          p.note.toLowerCase().includes(q) ||
          (p.group ?? "").toLowerCase().includes(q)
        );
      });
  }, [manifest, plane, board, query, onlyChanged]);

  const changedCount = paramsForBoard(manifest, board?.macro ?? null).filter((p) => paramState(manifest, plane, p.name)?.changed).length;
  let lastGroup: string | null = null;

  return (
    <div className="step-content">
      <div className="step-head">
        <h2>{t("Все параметры")}</h2>
        <p>
          {t(
            "Каждое число прошивки — из Config.h, с описанием из комментариев. Синяя полоска — изменено в этом самолёте; остальное как в прошивке. Пины — для платы {board}.",
            { board: board?.title ?? plane.board },
          )}
        </p>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <div className="row grow" style={{ maxWidth: 460, position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 10, color: "var(--text-3)" }} />
          <input
            className="input grow"
            style={{ paddingLeft: 32 }}
            placeholder={t("Поиск: имя, описание, раздел…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <label className="row" style={{ gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          {t("только изменённые ({n})", { n: changedCount })}
        </label>
        <span className="hint">{t("найдено: {n}", { n: rows.length })}</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: "30%" }}>{t("Параметр")}</th>
            <th>{t("Значение")}</th>
            <th style={{ width: 130 }}>{t("В прошивке")}</th>
            <th style={{ width: 44 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, st }) => {
            const group = p.board ? `${p.group} · ${board?.title ?? p.board}` : p.group;
            const showGroup = group !== lastGroup;
            lastGroup = group;
            const doc = [p.note, p.doc].filter(Boolean).join("\n\n");
            return (
              <Fragment key={`${p.board}-${p.name}`}>
                {showGroup && (
                  <tr className="group">
                    <td colSpan={4}>{group}</td>
                  </tr>
                )}
                <tr className={st.changed ? "changed" : undefined}>
                  <td>
                    <div className="mono" style={{ fontWeight: 600 }}>
                      {p.name}
                    </div>
                    {doc && (
                      <div
                        className="hint"
                        style={{
                          whiteSpace: openDoc === p.name ? "pre-wrap" : "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          maxWidth: 360,
                          cursor: "pointer",
                        }}
                        onClick={() => setOpenDoc(openDoc === p.name ? null : p.name)}
                      >
                        {doc}
                      </div>
                    )}
                  </td>
                  <td>
                    <ParamEditor name={p.name} />
                  </td>
                  <td className="mono hint">
                    {formatValue(st.firmware)}
                    {p.unit && p.kind !== "bool" ? ` ${p.unit}` : ""}
                  </td>
                  <td>
                    {st.changed && !p.fixed && (
                      <button
                        className="btn ghost small"
                        title={t("Вернуть значение из прошивки")}
                        onClick={() => updatePlane((pl) => setParamValue(manifest, pl, p.name, st.firmware))}
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
