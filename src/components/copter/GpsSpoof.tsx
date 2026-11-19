// «Подмена GPS» (P43 а) во вкладке «Безопасность»: включена ли защита,
// доверие GPS сейчас (живой кадр gps.trust) и причина, если прошивка
// уже выключила GPS из навигации (core/gpsSpoof.ts).

import { CircleCheck, CircleX, ShieldAlert } from "lucide-react";

import { BLIND_PHASE_TEXT, blindView, SPOOF_REASON_TEXT, spoofSettings, spoofView } from "../../core/gpsSpoof";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { useCopterBoard, useCopterLink, useCopterLive } from "./common";

export function GpsSpoofCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const cfg = spoofSettings(board.params, board.pending);
  if (!cfg.supported) return null;   // прошивка старше P43
  const view = spoofView(live);
  const blind = blindView(live);
  const checks = [
    { ok: cfg.detect, title: t("Проверка подмены включена (gps_spoof_detect)"), fix: () => set("gps_spoof_detect", "ON") },
    { ok: cfg.osdWarn, title: t("GPS SPOOF в очках (osd_warn_gps_spoof)"), fix: () => set("osd_warn_gps_spoof", "ON") },
  ];
  if (cfg.blindSupported)
    checks.push({
      ok: cfg.blindS > 0,
      title: cfg.blindS > 0 ? t("Домой вслепую до {s} с (deadreck_max_s)", { s: cfg.blindS }) : t("Домой вслепую выключено (deadreck_max_s = 0)"),
      fix: () => set("deadreck_max_s", 120),
    });
  const color = view.level === "bad" ? "var(--err)" : view.level === "warn" ? "var(--warn)" : "var(--ok)";
  return (
    <div className="card wide gps-spoof">
      <h3>
        <ShieldAlert size={17} /> {t("Подмена GPS")}
      </h3>
      <p className="sub">
        {t("Над деревьями коптер «уводит» в сторону? Это подмена GPS. Прошивка сверяет каждую точку с акселерометром, ветром и барометром; заметила — выключает GPS до посадки: POS HOLD становится ALT HOLD, в очках GPS SPOOF.")}
      </p>
      <ul className="find-checks">
        {checks.map((c) => (
          <li key={c.title} className={c.ok ? "ok" : "warn"}>
            {c.ok ? <CircleCheck size={15} color="var(--ok)" /> : <CircleX size={15} color="var(--warn)" />}
            <span>{c.title}</span>
            {!c.ok && (
              <button className="btn small" disabled={armed} onClick={() => void c.fix()}>
                {t("Включить")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {view.known ? (
        <div className="spoof-trust">
          <span>{t("Доверие GPS")}</span>
          <div className="spoof-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.trust}>
            <div style={{ width: `${view.trust}%`, background: color }} />
          </div>
          <b style={{ color }}>{view.trust}%</b>
        </div>
      ) : (
        <p className="hint">{t("Доверие GPS появится, когда GPS подключён и коптер на связи.")}</p>
      )}
      {cfg.blindSupported && (
        <p className="hint">
          {t("Если GPS подменят или заглушат на пути домой (GPS Rescue), коптер вернётся вслепую: место — от последней честной точки по наклону, ветру и компасу, высота — по барометру. Ошибка — 5–20 % пути, у дома он садится. Вернулся честный GPS — снова по нему.")}
        </p>
      )}
      {view.reason && (
        <p className="hint warn-text">
          {cfg.blindSupported && cfg.blindS > 0
            ? t("GPS подменяют: {why}. Он выключен из навигации до посадки — ведите коптер сами (ANGLE/ALT HOLD); возврат домой (тумблер или потеря связи) пойдёт вслепую.", {
                why: t(SPOOF_REASON_TEXT[view.reason]),
              })
            : t("GPS подменяют: {why}. Он выключен из навигации до посадки — ведите коптер сами (ANGLE/ALT HOLD), возврата домой по GPS не будет.", {
                why: t(SPOOF_REASON_TEXT[view.reason]),
              })}
        </p>
      )}
      {blind && (
        <p className="hint warn-text">
          {t("Вслепую: {phase}, до дома ≈ {d} м ± {err} м", { phase: t(BLIND_PHASE_TEXT[blind.phase] ?? blind.phase), d: blind.dist, err: blind.err })}
        </p>
      )}
    </div>
  );
}
