// Переход с Betaflight: поиск настройки по имени BF или словами (переход на
// вкладку с подсветкой строки) и вкладка «Я с Betaflight» — где у нас что и
// что сделано иначе.

import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { CopterTab } from "../../core/copterParams";
import { BF_DIFFERENCES, BF_TABS, searchCopter, SearchHit, tabTitle } from "../../core/copterSearch";
import { t } from "../../i18n";
import { useApp } from "../../store";

/** Перейти на вкладку и подсветить настройку (если есть). */
export type GoTo = (tab: CopterTab, param?: string) => void;

/** Поле поиска в шапке коптера: «p_roll», «dyn_notch», «газ висения». */
export function CopterSearch({ onGo }: { onGo: GoTo }) {
  const board = useApp((s) => s.copterBoard);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const hits = useMemo(() => searchCopter(q, board.header ? board : null, t), [q, board]);
  const pick = (h: SearchHit) => {
    onGo(h.tab, h.param);
    setQ("");
    setOpen(false);
  };
  const shown = open && q.trim().length >= 2;

  return (
    <div className="csearch">
      <Search size={15} className="csearch-icon" />
      <input
        className="input"
        aria-label={t("Поиск настроек")}
        placeholder={t("Найти: p_roll, газ висения…")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSel((i) => Math.min(i + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setSel((i) => Math.max(i - 1, 0));
          else if (e.key === "Enter" && hits[sel]) pick(hits[sel]);
          else if (e.key === "Escape") setQ("");
          else return;
          e.preventDefault();
        }}
      />
      {shown && (
        <div className="csearch-list" role="listbox">
          {hits.length ? (
            hits.map((h, i) => (
              <button
                key={`${h.tab}-${h.param ?? h.name ?? ""}-${i}`}
                role="option"
                aria-selected={i === sel}
                className={i === sel ? "on" : ""}
                onMouseDown={(e) => e.preventDefault()}   // не терять фокус до клика
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(h)}
              >
                <span className="csearch-row">
                  <span className="grow">{t(h.title)}</span>
                  {h.title !== tabTitle(h.tab) && <span className="csearch-tab">{t(tabTitle(h.tab))}</span>}
                </span>
                {h.name && <span className="mono hint">{h.name}</span>}
                {h.note && <span className="hint">{t(h.note)}</span>}
              </button>
            ))
          ) : (
            <div className="hint csearch-none">{t("Ничего не нашлось — попробуйте имя из Betaflight или другое слово.")}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Вкладка «Я с Betaflight»: вкладки BF → наши, отличия и перенос diff. */
export function FromBfTab({ onGo }: { onGo: GoTo }) {
  return (
    <div className="copter-grid">
      <div className="card wide">
        <h3>{t("Я с Betaflight")}</h3>
        <p className="sub">
          {t("Имена настроек, команды CLI, diff и MSP — как в Betaflight 4.5: под каждой настройкой мелко её имя BF, а поиск сверху найдёт её по этому имени. Интерфейс свой: ниже — где у нас то, что вы привыкли искать в конфигураторе BF.")}
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => onGo("overview")}>
            {t("Перенести настройки из Betaflight")}
          </button>
          <button className="btn ghost" onClick={() => onGo("cli")}>
            {t("Вставить diff в CLI")}
          </button>
        </div>
      </div>

      <div className="card">
        <h3>{t("Вкладки Betaflight → наши")}</h3>
        <table className="table bf-map">
          <tbody>
            {BF_TABS.map((row) => (
              <tr key={row.bf}>
                <td className="mono">{row.bf}</td>
                <td>
                  {row.ours.length ? (
                    row.ours.map((tab) => (
                      <button key={tab} className="btn ghost small" onClick={() => onGo(tab)}>
                        <ArrowRight size={13} />
                        {t(tabTitle(tab))}
                      </button>
                    ))
                  ) : (
                    <span className="hint">—</span>
                  )}
                  {row.note && <div className="hint">{t(row.note)}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>{t("Что у нас иначе — и почему")}</h3>
        {BF_DIFFERENCES.map((d) => (
          <div key={d.title} className="bf-diff">
            <div className="prow-title">{t(d.title)}</div>
            <div>{t(d.ours)}</div>
            <div className="hint">
              <span className="badge">BF</span> {t(d.bf)}
            </div>
            {d.tab && (
              <button className="btn ghost small" onClick={() => onGo(d.tab!, d.param)}>
                <ArrowRight size={13} />
                {d.param ? <span className="mono">{d.param}</span> : t(tabTitle(d.tab))}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
