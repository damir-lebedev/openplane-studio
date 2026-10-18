// История прошивок самолёта: когда, что было прошито, что изменилось с тех
// пор — и «вернуть как было» одной кнопкой (снимок конфигурации на каждую
// прошивку лежит в папке самолёта, history/).

import { CircleCheck, Cpu, History, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { api, Snapshot } from "../../api";
import { Change, diffProjects, paramTitle, restoreConfig } from "../../core/diff";
import { itemLabel } from "../../core/labels";
import { isEmptyReport, migrationReport } from "../../core/migrate";
import { formatValue, setParamValue } from "../../core/params";
import { locale, t } from "../../i18n";
import { useApp } from "../../store";
import { useBoardIdentity } from "./setup/common";
import { Modal } from "../ui";

export function ChangeList({ changes, empty }: { changes: Change[]; empty: string }) {
  if (!changes.length) return <p className="muted" style={{ margin: "4px 0" }}>{empty}</p>;
  const groups = [...new Set(changes.map((c) => c.group))];
  return (
    <div className="changes">
      {groups.map((g) => (
        <div key={g} className="change-group">
          <div className="drawer-sub">{t(g)}</div>
          {changes
            .filter((c) => c.group === g)
            .map((c, i) => (
              <div key={i} className="change">
                <span className="change-what">{c.what}</span>
                <span className="change-from">{c.from}</span>
                <span className="change-arrow">→</span>
                <span className="change-to">{c.to}</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/** Снимки самолёта с прошивок, новые сверху; null — ещё грузятся. */
export function useSnapshots(planeId: string): Snapshot[] | null {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const lastFlashAt = useApp((s) => s.current()?.lastFlash?.at);
  useEffect(() => {
    let alive = true;
    api
      .hangarHistory(planeId)
      .then((list) => alive && setSnaps(list.filter((s) => s.record)))
      .catch(() => alive && setSnaps([]));
    return () => {
      alive = false;
    };
  }, [planeId, lastFlashAt]);
  return snaps;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const toast = useApp((s) => s.toast);
  const identity = useBoardIdentity();
  const snaps = useSnapshots(plane.id);
  const [sel, setSel] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const snap = snaps?.[sel];
  const changes = snap?.plane ? diffProjects(manifest, snap.plane, plane) : [];

  const rollback = () => {
    if (!snap?.plane) return;
    const from = snap.plane;
    updatePlane((p) => restoreConfig(p, from));
    toast("ok", t("Вернул как было {when}. Прошейте — тогда это окажется и на плате. Передумали — Ctrl+Z.", { when: when(snap.record!.at) }));
    onClose();
  };

  return (
    <Modal onClose={onClose} width={860}>
      <h2 className="row" style={{ gap: 10 }}>
        <History size={20} /> {t("История прошивок · {name}", { name: plane.name })}
      </h2>
      {!snaps && <p className="muted">{t("Читаю…")}</p>}
      {snaps && !snaps.length && <p className="muted">{t("Этот самолёт ещё не прошивали — история начнётся с первой прошивки.")}</p>}
      {snaps && snaps.length > 0 && (
        <div className="history">
          <div className="history-list">
            {snaps.map((s, i) => {
              const onBoard = identity?.config === s.record!.configHash;
              return (
                <button key={s.file} className={`history-item${i === sel ? " active" : ""}`} onClick={() => { setSel(i); setConfirm(false); }}>
                  {s.record!.ok ? <CircleCheck size={15} color="var(--ok)" /> : <TriangleAlert size={15} color="var(--warn)" />}
                  <span className="grow">
                    <span className="history-date">{when(s.record!.at)}</span>
                    <span className="history-meta mono">{s.record!.configHash}</span>
                  </span>
                  {onBoard && (
                    <span className="badge accent" title={t("Эта конфигурация сейчас на подключённой плате")}>
                      <Cpu size={11} /> {t("на плате")}
                    </span>
                  )}
                  {i === 0 && !onBoard && <span className="badge">{t("последняя")}</span>}
                </button>
              );
            })}
          </div>
          <div className="history-detail">
            {snap && (
              <>
                <div className="hint" style={{ marginBottom: 8 }}>
                  {snap.record!.ok ? t("Прошито и подтверждено паспортом платы") : t("Залито, но плата не подтвердила")} · {t("коммит прошивки")}{" "}
                  <span className="mono">{snap.record!.commit ?? "—"}</span>
                </div>
                {snap.plane ? (
                  <>
                    <div className="drawer-sub" style={{ marginTop: 0 }}>{t("С тех пор в проекте изменилось")}</div>
                    <ChangeList changes={changes} empty={t("Ничего — проект такой же, как в этой прошивке.")} />
                    {changes.length > 0 && (
                      <div className="row" style={{ marginTop: 14 }}>
                        {confirm ? (
                          <>
                            <span className="grow">{t("Вернуть конфигурацию как в этой прошивке? Изменения выше пропадут (Ctrl+Z вернёт).")}</span>
                            <button className="btn primary" onClick={rollback}>
                              <RotateCcw size={15} /> {t("Вернуть")}
                            </button>
                            <button className="btn ghost" onClick={() => setConfirm(false)}>
                              {t("Отмена")}
                            </button>
                          </>
                        ) : (
                          <button className="btn" onClick={() => setConfirm(true)}>
                            <RotateCcw size={15} /> {t("Вернуть как было")}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="muted">{t("Это снимок старой версии приложения: в нём только хэш, без проекта — вернуть его нельзя.")}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          {t("Закрыть")}
        </button>
      </div>
    </Modal>
  );
}

/** «Что изменится на плате» — против последней подтверждённой прошивки. */
export function PendingChanges() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const snaps = useSnapshots(plane.id);
  if (!snaps) return null;
  const last = snaps.find((s) => s.plane && s.record?.ok);
  if (!last?.plane) return null;
  const changes = diffProjects(manifest, last.plane, plane);
  return (
    <div className="card pending">
      <ChangeList
        changes={changes}
        empty={t("Ничего не изменится: на плате уже эта конфигурация (прошита {when}).", { when: when(last.record!.at) })}
      />
      {changes.length > 0 && <div className="hint" style={{ marginTop: 8 }}>{t("Против прошивки {when}.", { when: when(last.record!.at) })}</div>}
    </div>
  );
}

/** Прошивка обновилась с последней прошивки самолёта: что нового, что убрали, какие числа поменялись. */
export function FirmwareUpdateNotice() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const snaps = useSnapshots(plane.id);
  const [hidden, setHidden] = useState(false);
  const last = snaps?.find((s) => s.firmware);
  if (hidden || !last?.firmware || last.firmware.sourceHash === manifest.sourceHash) return null;
  const r = migrationReport(last.firmware, manifest, plane);
  if (isEmptyReport(r)) return null;
  const names = (kind: "mode" | "feature" | "knob", ids: string[]) => ids.map((id) => itemLabel(kind, id));
  const added = [...names("mode", r.addedModes), ...names("feature", r.addedFeatures), ...names("knob", r.addedKnobs)];
  const removed = [...names("mode", r.removedModes), ...names("feature", r.removedFeatures), ...names("knob", r.removedKnobs)];
  const unit = (u: string | null) => (u ? ` ${t(u)}` : "");
  return (
    <div className="card fw-update">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <b>{t("Прошивка обновилась с прошивки {when}", { when: when(last.record!.at) })}</b>
          <div className="hint">{t("Что это значит для этого самолёта — до того, как прошить:")}</div>
        </div>
        <button className="btn small ghost" onClick={() => setHidden(true)}>
          {t("Понятно")}
        </button>
      </div>
      {added.length > 0 && <p className="fw-line">{t("Появилось: {list}", { list: added.join(", ") })}</p>}
      {r.addedSensors.length > 0 && <p className="fw-line">{t("Новые датчики: {n}", { n: r.addedSensors.length })}</p>}
      {r.addedParams.length > 0 && <p className="fw-line">{t("Новых чисел: {n} — у них значения прошивки", { n: r.addedParams.length })}</p>}
      {removed.length > 0 && <p className="fw-line bad">{t("Убрали: {list}", { list: removed.join(", ") })}</p>}
      {r.removedParams.length > 0 && <p className="fw-line">{t("Убрали чисел: {n}", { n: r.removedParams.length })}</p>}
      {r.changedDefaults.length > 0 && (
        <>
          <div className="drawer-sub">{t("Поменялись значения по умолчанию")}</div>
          {r.changedDefaults.map((c) => (
            <div key={c.name} className="change">
              <span className="change-what">{paramTitle(c.name)}</span>
              <span className="change-from">
                {formatValue(c.from)}
                {unit(c.unit)}
              </span>
              <span className="change-arrow">→</span>
              <span className="change-to">
                {c.overridden ? (
                  <span className="hint">{t("у самолёта своё значение")}</span>
                ) : (
                  <>
                    {formatValue(c.to)}
                    {unit(c.unit)}{" "}
                    <button className="link" onClick={() => updatePlane((p) => setParamValue(manifest, p, c.name, c.from))}>
                      {t("оставить {v}", { v: formatValue(c.from) })}
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
