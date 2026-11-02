// «Что подключено» (P03): то, чего плата не видит, — карточками с выбором
// из каталога и полями настроек; внизу — что из этого выходит (тяга, висение,
// время, хватит ли регулятора и батареи на полный газ). Защита по току в
// полёте (P04) — по этим же числам: esc_current_a, battery_c_rating.

import { BatteryFull, Camera, CircleDot, Cpu, Fan, Frame, Radio, Search, TriangleAlert, Zap } from "lucide-react";
import { useState } from "react";

import type { CopterParts } from "../../core/copter";
import { CopterParam, ParamValue } from "../../core/copterParams";
import { buildFromParams, CatalogItem, estimateBuild, KIND_TITLES, OVERLOAD_TEXT, partParams, PartKind, searchCatalog, suggestCurrentLimit, WARNING_TEXT } from "../../core/parts";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamRow, shown, useCopterBoard, useCopterLink, useCopterLive } from "./common";

const KINDS: { kind: PartKind; icon: typeof Fan; params: string[]; part?: keyof CopterParts }[] = [
  { kind: "motor", icon: CircleDot, params: ["motor_stator_mm", "motor_height_mm", "motor_kv"], part: "motors" },
  { kind: "prop", icon: Fan, params: ["prop_diameter_in", "prop_pitch_in", "prop_blades"], part: "props" },
  { kind: "battery", icon: BatteryFull, params: ["battery_cells", "battery_mah", "battery_chemistry", "battery_c_rating"], part: "battery" },
  { kind: "esc", icon: Cpu, params: ["esc_current_a", "esc_burst_current_a"], part: "esc" },
  { kind: "vtx", icon: Radio, params: ["vtx_max_power_mw"], part: "vtx" },
  { kind: "camera", icon: Camera, params: [], part: "camera" },
  { kind: "frame", icon: Frame, params: ["copter_wheelbase_mm", "copter_mass_g"] },
];

function Catalog({ kind, onPick }: { kind: PartKind; onPick: (item: CatalogItem) => void }) {
  const [query, setQuery] = useState("");
  const items = searchCatalog(kind, query, t);
  return (
    <div className="parts-catalog">
      <div className="row" style={{ gap: 6 }}>
        <Search size={14} color="var(--text-3)" />
        <input className="input grow compact" autoFocus placeholder={t("Поиск: 2207, 7\", li-ion…")} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="parts-list">
        {items.map((x) => (
          <button key={x.id} className="parts-item" onClick={() => onPick(x)}>
            <span>{t(x.title)}</span>
            {(x.note || x.tags) && <span className="hint">{x.note ? t(x.note) : x.tags}</span>}
          </button>
        ))}
        {!items.length && <span className="hint">{t("Нет такого — впишите числа в поля ниже")}</span>}
      </div>
    </div>
  );
}

function PartCard({ kind, icon: Icon, params, part }: (typeof KINDS)[number]) {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const copter = useApp((s) => s.currentCopter());
  const updateCopter = useApp((s) => s.updateCopter);
  const { armed } = useCopterLink();
  const [open, setOpen] = useState(false);
  const rows = params.map((n) => board.params[n]).filter((p): p is CopterParam => !!p);
  const name = part && copter ? copter.parts[part] : "";

  const pick = async (item: CatalogItem) => {
    setOpen(false);
    if (part && copter) updateCopter(copter.id, (p) => void (p.parts[part] = t(item.title)));
    for (const [n, v] of Object.entries(partParams(kind, item))) {
      const p = board.params[n];
      if (!p) continue;
      // перечисления на плате — в своём написании (LIION, ON…)
      const value: ParamValue = p.type === "enum" ? (p.options?.find((o) => o.toUpperCase() === String(v).toUpperCase()) ?? String(v)) : v;
      if (String(shown(n, p)) !== String(value)) await set(n, value);
    }
  };

  return (
    <div className="card parts-card">
      <div className="row" style={{ gap: 10 }}>
        <span className="parts-icon">
          <Icon size={20} />
        </span>
        <div className="grow">
          <h3 style={{ margin: 0 }}>{t(KIND_TITLES[kind])}</h3>
          {name ? <div className="hint">{name}</div> : null}
        </div>
        <button className="btn small" disabled={armed} onClick={() => setOpen(!open)}>
          <Search size={13} />
          {t("Из каталога")}
        </button>
      </div>
      {open && <Catalog kind={kind} onPick={(x) => void pick(x)} />}
      {rows.map((p) => (
        <ParamRow key={p.name} p={p} />
      ))}
      {kind === "camera" && copter && (
        <input
          className="input"
          style={{ marginTop: 8, width: "100%" }}
          placeholder={t("какая камера (для себя и шпаргалки)")}
          defaultValue={copter.parts.camera}
          onBlur={(e) => updateCopter(copter.id, (p) => void (p.parts.camera = e.target.value.trim()))}
        />
      )}
    </div>
  );
}

const fmt = (n: number, digits = 0) => n.toFixed(digits);

// P04b: полный газ больше, чем выдержат батарея или регуляторы, — одной
// кнопкой предел current_limit_a (по умолчанию выключен).
function CurrentLimit({ suggest }: { suggest: number | null }) {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const p = board.params.current_limit_a;
  if (!p) return null;
  const now = Number(shown("current_limit_a", p)) || 0;
  if (!now && suggest === null) return null;
  return (
    <div className="parts-meter">
      <p className="hint">
        {now
          ? t("Ограничение тока: {a} А — выше потолок моторов плавно опускается, в очках CURRENT LIMIT.", { a: now })
          : t("Можно ограничить общий ток {a} А: прошивка плавно опустит потолок моторов, а не даст сгореть регулятору или вздуться батарее. Тяги на полном газе станет меньше.", { a: suggest ?? 0 })}
      </p>
      {suggest !== null && now !== suggest && (
        <button className="btn small" disabled={armed} onClick={() => void set("current_limit_a", suggest)}>
          <Zap size={13} />
          {t("Ограничить до {a} А", { a: suggest })}
        </button>
      )}
      {now > 0 && (
        <button className="btn small" disabled={armed} onClick={() => void set("current_limit_a", 0)}>
          {t("Без ограничения")}
        </button>
      )}
    </div>
  );
}

function Summary() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const build = buildFromParams((n) => shown(n, board.params[n]) as number | string | undefined);
  if (!build) {
    return (
      <div className="card wide">
        <h3>{t("Что из этого выходит")}</h3>
        <p className="sub">{t("Заполните мотор, винты, батарею и массу — посчитаем тягу, висение и время полёта.")}</p>
      </div>
    );
  }
  const e = estimateBuild(build);
  const esc = build.esc && build.esc.continuousA > 0 ? build.esc : null;
  return (
    <div className="card wide">
      <h3>{t("Что из этого выходит")}</h3>
      <p className="sub">{t("Оценка по той же модели, что у прошивки (±30 %): чтобы заметить ошибку до полёта, а не для паспорта.")}</p>
      <div className="parts-stats">
        <div>
          <span className="hint">{t("Тяговооружённость")}</span>
          <b>{fmt(e.thrustToWeight, 1)}</b>
        </div>
        <div>
          <span className="hint">{t("Висение")}</span>
          <b>{e.hoverThrottle !== null ? `${fmt(e.hoverThrottle * 100)} %` : "—"}</b>
        </div>
        <div>
          <span className="hint">{t("Ток висения")}</span>
          <b>{e.hoverAmps !== null ? `${fmt(e.hoverAmps, 1)} ${t("А")}` : "—"}</b>
        </div>
        <div>
          <span className="hint">{t("Висеть, минут")}</span>
          <b>{e.hoverMinutes !== null ? `≈ ${fmt(e.hoverMinutes)}` : "—"}</b>
        </div>
        <div>
          <span className="hint">{t("Полный газ, на мотор")}</span>
          <b>
            {fmt(e.fullAmpsPerMotor)} {t("А")} · {fmt(e.fullThrustG)} {t("г")}
          </b>
        </div>
        <div>
          <span className="hint">{t("Полный газ, всего")}</span>
          <b>
            {fmt(e.fullAmps)} {t("А")}
            {e.batteryMaxA > 0 && ` / ${fmt(e.batteryMaxA)} ${t("А")}`}
          </b>
        </div>
      </div>
      {esc && (
        <div className="parts-meter">
          <div className="row">
            <span className="grow">{t("Регулятор: ток мотора на полном газе против длительного и пикового")}</span>
            <span className="mono">
              {fmt(e.fullAmpsPerMotor)} / {fmt(esc.continuousA)} / {fmt(esc.burstA || esc.continuousA * 1.25)} {t("А")}
            </span>
          </div>
          <div className="margin-track">
            <div
              className={`margin-zone ${e.warnings.includes("esc-burst") ? "bad" : e.warnings.includes("esc-continuous") ? "warn" : "ok"}`}
              style={{ width: `${Math.min(100, (e.fullAmpsPerMotor / (esc.burstA || esc.continuousA * 1.25)) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {e.warnings.map((w) => (
        <p key={w} className={w === "esc-burst" || w === "no-lift" ? "locked-note" : "hint warn-text"}>
          <TriangleAlert size={13} /> {t(WARNING_TEXT[w])}
        </p>
      ))}
      {!esc && <p className="hint">{t("Ток регулятора не задан — прошивка не следит за его перегрузкой.")}</p>}
      <CurrentLimit suggest={suggestCurrentLimit(build, e)} />
      {live?.mma !== undefined && (
        <p className="hint">
          <Zap size={13} /> {t("За этот полёт — до {a} А на мотор", { a: fmt(live.mma, 1) })}
          {live.ovl ? ` · ${OVERLOAD_TEXT[live.ovl] ?? live.ovl}` : ""}
        </p>
      )}
    </div>
  );
}

export function PartsTab() {
  return (
    <NeedBoard>
      <div className="copter-grid">
        <div className="card wide">
          <h3>{t("Что ещё подключено")}</h3>
          <p className="sub">
            {t("Плата не видит мотор, винты, батарею и регулятор. Выберите из каталога или впишите с коробки — прошивка посчитает PID, фильтры, газ висения и будет следить, чтобы регулятор и батарея не перегрелись.")}
          </p>
        </div>
        {KINDS.map((k) => (
          <PartCard key={k.kind} {...k} />
        ))}
        <Summary />
      </div>
    </NeedBoard>
  );
}
