// «Спектр гироскопа» (060–063): живой спектр с платы (скользящее ДПФ
// прошивки, сумма осей) и где сейчас стоят режекторы — динамические (за
// пиками спектра) и RPM-фильтра (по оборотам: DShot — на каждый мотор,
// модель — на средних). Без живых кадров — подсказка, как увидеть вибрацию.

import { rpmMarks, spectrumBars, SPECTRUM_DB_MAX } from "../../core/filters";
import { t } from "../../i18n";
import { useCopterBoard, useCopterLive } from "./common";

const W = 560;
const H = 180;

export function SpectrumChart() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const spec = live?.spec;
  const harmonics = Number(board.params.rpm_filter_harmonics?.value ?? 3);
  const fMax = spec ? spec.bw * spec.db.length : 500;
  const fx = (f: number) => (f / fMax) * W;
  const dy = (db: number) => H - (Math.min(SPECTRUM_DB_MAX, Math.max(0, db)) / SPECTRUM_DB_MAX) * H;
  const bars = spec ? spectrumBars(spec) : [];
  const dyn = spec ? [...new Set(spec.dn.flat().filter((f) => f > 0).map(Math.round))] : [];
  const rpm = spec ? rpmMarks(spec.rpm, harmonics) : [];
  const grid = [100, 200, 300, 400, 500].filter((f) => f < fMax);
  return (
    <div className="card wide spectrum-chart" data-testid="spectrum-chart">
      <h3>{t("Спектр гироскопа")}</h3>
      <p className="sub">
        {t("Что трясёт плату прямо сейчас: высокие столбики — вибрация. Пунктир — режекторы: голубые едут за пиками спектра (динамические), зелёные — за оборотами моторов (RPM-фильтр).")}
      </p>
      {!spec ? (
        <p className="hint">{t("Нет живых данных. Подключите коптер и раскрутите моторы на вкладке «Моторы» (без пропеллеров) — здесь появится вибрация.")}</p>
      ) : (
        <>
          <svg viewBox={`-30 -8 ${W + 40} ${H + 28}`} className="filter-svg" role="img" aria-label={t("Спектр гироскопа")}>
            {[0, 20, 40, 60].map((db) => (
              <g key={db}>
                <line x1={0} x2={W} y1={dy(db)} y2={dy(db)} className="filter-grid" />
                <text x={-6} y={dy(db) + 4} className="filter-label" textAnchor="end">
                  {db}
                </text>
              </g>
            ))}
            {grid.map((f) => (
              <text key={f} x={fx(f)} y={H + 16} className="filter-label" textAnchor="middle">
                {f} {t("Гц")}
              </text>
            ))}
            {bars.map((b) => (
              <rect key={b.hz} x={fx(b.hz - spec.bw / 2) + 1} width={Math.max(1, fx(spec.bw) - 2)} y={dy(b.db)} height={H - dy(b.db)} className={`spectrum-bar${b.peak ? " peak" : ""}`} />
            ))}
            {rpm.map((f) => (
              <line key={`r${f}`} x1={fx(f)} x2={fx(f)} y1={0} y2={H} className="spectrum-notch rpm" />
            ))}
            {dyn.map((f) => (
              <line key={`d${f}`} x1={fx(f)} x2={fx(f)} y1={0} y2={H} className="spectrum-notch dyn" />
            ))}
          </svg>
          <div className="filter-legend">
            <span className="filter-key spectrum-dyn">{dyn.length ? t("Динамические: {list} Гц", { list: dyn.join(", ") }) : t("Динамические: ищут пик")}</span>
            <span className="filter-key spectrum-rpm">
              {spec.src === "dshot"
                ? t("Обороты по DShot, моторы: {list} Гц", { list: spec.rpm.map(Math.round).join(", ") || "—" })
                : t("Обороты по модели: {hz} Гц", { hz: Math.round(spec.rpm[0] ?? 0) })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
