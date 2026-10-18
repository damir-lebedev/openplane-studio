// 1. Датчики на месте: опрос шины I2C и живые данные против проекта.

import { CircleAlert, CircleCheck, CircleDashed, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";

import { extraDevices, hex, SensorRow, sensorRows } from "../../../core/live";
import { locale, t } from "../../../i18n";
import { useApp } from "../../../store";
import { useLive } from "../../live/LiveWidgets";
import { CheckState, usePassed, when } from "./common";

function RowIcon({ state }: { state: SensorRow["state"] }) {
  switch (state) {
    case "ok":
      return <CircleCheck size={16} color="var(--ok)" />;
    case "warn":
      return <TriangleAlert size={16} color="var(--warn)" />;
    case "bad":
      return <CircleAlert size={16} color="var(--err)" />;
    default:
      return <CircleDashed size={16} color="var(--text-3)" />;
  }
}

export function useSensorsState(): { state: CheckState; rows: SensorRow[] } {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const scan = useApp((s) => s.scan);
  const live = useLive();
  const rows = sensorRows(manifest, plane, live, scan);
  const used = rows.filter((r) => r.state !== "off");
  const state: CheckState = !live
    ? "todo"
    : used.some((r) => r.state === "bad")
      ? "fail"
      : used.some((r) => r.state === "warn" || r.state === "wait")
        ? "warn"
        : "ok";
  return { state, rows };
}

export function SensorsCheck() {
  const plane = useApp((s) => s.current())!;
  const scan = useApp((s) => s.scan);
  const scanAt = useApp((s) => s.scanAt);
  const link = useApp((s) => s.link);
  const requestScan = useApp((s) => s.requestScan);
  const live = useLive();
  const { state, rows } = useSensorsState();
  const { record, pass } = usePassed("sensors");
  const extra = extraDevices(plane, scan);

  // Плата на связи, опроса ещё не было — опросить самим (один раз, без ARM).
  const asked = useRef(false);
  const canScan = link.state === "open" && !!live && !live.arm;
  useEffect(() => {
    if (canScan && !scanAt && !asked.current) {
      asked.current = true;
      void requestScan().catch(() => {});
    }
  }, [canScan, scanAt, requestScan]);

  useEffect(() => {
    if (state === "ok" && !record) pass();
  }, [state, record, pass]);

  return (
    <>
      <p className="check-lead">
        {t("Плата сама опрашивает шину и смотрит, отвечает ли каждый датчик из проекта. Красное — провод, питание или не тот адрес.")}
      </p>
      <div className="sensor-rows">
        {rows.map((r) => (
          <div key={r.cat} className={`sensor-row ${r.state}`}>
            <RowIcon state={r.state} />
            <span className="sensor-name">{t(r.title)}</span>
            <span className="sensor-chip">{r.chip}</span>
            <span className="grow sensor-text">{t(r.text)}</span>
          </div>
        ))}
      </div>
      {scan?.error && (
        <p className="hint">{scan.error === "armed" ? t("Опрос шины — только без ARM.") : t("Эта сборка не умеет опрос шины.")}</p>
      )}
      {extra.length > 0 && (
        <p className="hint">
          {t("Ещё отвечают на шине:")} {extra.map((d) => `${hex(d.a)} ${d.g}`).join(", ")}
        </p>
      )}
      {scan?.screen && scan.screen.length > 0 && (
        <p className="hint">
          {t("Шина экрана:")} {scan.screen.map((d) => `${hex(d.a)} ${d.g}`).join(", ")}
        </p>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn small" disabled={link.state !== "open" || !!live?.arm} onClick={() => void requestScan()}>
          <RefreshCw size={14} />
          {t("Опросить шину")}
        </button>
        {scanAt > 0 && <span className="hint">{t("опрос в {time}", { time: new Date(scanAt).toLocaleTimeString(locale()) })}</span>}
        <div className="grow" />
        {record && <span className="hint">{t("всё отвечало {when}", { when: when(record.at) })}</span>}
      </div>
    </>
  );
}
