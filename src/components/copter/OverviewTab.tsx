// «Коптер»: сборка и плата, переход с Betaflight (распиновка и родная
// прошивка — в проект, одной кнопкой «Прошить»), перенос настроек из BF,
// видеопередатчик, тумблеры, первая настройка, комплектующие, прошивки.

import { ArrowRightLeft, CircleAlert, CircleCheck, Copy, History, TriangleAlert, Upload, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { api, errorText } from "../../api";
import {
  auxName,
  boardDumpCommands,
  cliSetup,
  CopterProject,
  copterEnvs,
  findCopterBuild,
  findCopterEnv,
  FREE_BAND_MHZ,
  FREE_POWER_MW,
  GOGGLE_BANDS,
  inFreeBand,
  PART_KEYS,
  PART_LABELS,
  setupError,
  SWITCHES,
  switchIssues,
  VTX_BANDS,
  VTX_CAPS_MW,
  vtxFrequency,
} from "../../core/copter";
import { IMPORT_SKIP_GROUPS, ImportLine, parseBfDiff } from "../../core/copterParams";
import { betaflightPort, restoreOriginal, runCopterFlash } from "../../flash";
import { locale, t } from "../../i18n";
import { useApp } from "../../store";
import { Advanced, Modal } from "../ui";
import { useCopterBoard, useCopterLink } from "./common";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const capLabel = (mw: number) => (mw ? t("{mw} мВт", { mw }) : t("без потолка"));

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(
    () => useApp.getState().toast("ok", t("Скопировано")),
    () => useApp.getState().toast("err", t("Не скопировалось")),
  );
}

function CopyLine({ text }: { text: string }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <code className="mono grow cli-line">{text}</code>
      <button className="btn ghost small" title={t("Скопировать")} onClick={() => copy(text)}>
        <Copy size={14} />
      </button>
    </div>
  );
}

function AuxSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={-1}>{t("нет")}</option>
      {Array.from({ length: 8 }, (_, i) => (
        <option key={i} value={i}>
          {auxName(i)}
        </option>
      ))}
    </select>
  );
}

/** Первая настройка (приёмник, видео, тумблеры) строками CLI — в плату по связи. */
function WriteSetup({ copter }: { copter: CopterProject }) {
  const updateCopter = useApp((s) => s.updateCopter);
  const toast = useApp((s) => s.toast);
  const { copter: ready, armed, identity } = useCopterLink();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const lines = cliSetup(copter);

  const write = async () => {
    setBusy(true);
    setErrors(null);
    const seq = useApp.getState().consoleSeq;
    try {
      for (const l of lines) {
        await api.linkCommand(l.cmd);
        await sleep(60);
      }
      await api.linkCommand("save");
      await sleep(800);
      const st = useApp.getState();
      const fresh = st.consoleLines.slice(-Math.min(st.consoleSeq - seq, st.consoleLines.length));
      const errs = fresh.map(setupError).filter((e): e is string => !!e);
      setErrors(errs);
      if (errs.length) toast("warn", t("Плата не приняла {n} строк", { n: errs.length }));
      else {
        toast("ok", t("Первая настройка записана в плату"));
        updateCopter(copter.id, (c) => (c.setupWrittenAt = new Date().toISOString()));
        setTimeout(() => void useApp.getState().copterLoad(), 300);
      }
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3>{t("Первая настройка")}</h3>
      <p className="sub">
        {t("Приёмник ExpressLRS, видеопередатчик с потолком и тумблеры — одной кнопкой. Дальше любую настройку можно поменять на вкладках слева.")}
      </p>
      <Advanced title={t("строки CLI")}>
        <div className="cli">
          {lines.map((l) => (
            <div key={l.cmd} className="cli-row">
              <code className="mono">{l.cmd}</code>
              <span className="hint">{t(l.note)}</span>
            </div>
          ))}
          <div className="cli-row">
            <code className="mono">save</code>
            <span className="hint">{t("во флеш и в работу")}</span>
          </div>
        </div>
      </Advanced>
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn primary" disabled={!ready || busy || armed} onClick={() => void write()} title={ready ? undefined : t("Подключите коптер с прошивкой OpenPlane по USB")}>
          <Upload size={15} />
          {t("Записать в плату")}
        </button>
        <button className="btn" onClick={() => copy([...lines.map((l) => l.cmd), "save"].join("\n"))}>
          <Copy size={15} />
          {t("Скопировать")}
        </button>
        <span className="hint grow">{armed ? t("Плата заармлена — снимите ARM.") : ready ? t("Плата на связи: {board}", { board: identity!.board }) : t("Коптер не подключён")}</span>
      </div>
      {copter.setupWrittenAt && !errors && (
        <p className="hint" style={{ marginBottom: 0 }}>
          {t("Записано в плату: {at}", { at: new Date(copter.setupWrittenAt).toLocaleString(locale()) })}
        </p>
      )}
      {errors && errors.length > 0 && (
        <div className="issue warning" style={{ marginTop: 10 }}>
          <TriangleAlert size={17} color="var(--warn)" />
          <div className="grow mono">{errors.join("\n")}</div>
        </div>
      )}
    </div>
  );
}

/** Плата под Betaflight: распиновку и родную прошивку приложение снимает само при «Прошить». */
function BetaflightCard({ copter }: { copter: CopterProject }) {
  const manifest = useApp((s) => s.manifest);
  const fc = useApp((s) => s.fc);
  const source = useApp((s) => s.settings.firmwareSource);
  const flash = useApp((s) => s.flash);
  const env = findCopterEnv(manifest, copter.board);
  const bfPort = betaflightPort();
  const bf = bfPort ? fc[bfPort] : null;
  const dump = copter.boardDump;
  const { copter: ours } = useCopterLink();
  const [importing, setImporting] = useState(false);

  if (!env?.needsBoardDump && !dump && !bf) return null;
  return (
    <div className="card wide">
      <div className="row" style={{ gap: 8 }}>
        {dump ? <CircleCheck size={18} color="var(--ok)" /> : <CircleAlert size={18} color="var(--warn)" />}
        <h3 style={{ margin: 0 }} className="grow">
          {dump ? t("Плата снята с Betaflight") : t("Переход с Betaflight")}
        </h3>
        {bf && (
          <span className="pill">
            {bf.board ?? bf.target ?? "?"} · Betaflight {bf.version ?? "?"} · {bfPort}
          </span>
        )}
      </div>
      {!dump && (
        <>
          <p className="sub">
            {t("Какой выход на какой ножке процессора, знает только родная прошивка платы. «Прошить» сделает всё само: прочитает распиновку из Betaflight, сохранит родную прошивку в проект (вернуть — одной кнопкой здесь же), соберёт нашу прошивку под эту плату и зальёт её — кнопку BOOT зажимать не нужно.")}
          </p>
          {bf ? (
            <button className="btn primary" disabled={!!flash?.running} onClick={() => void runCopterFlash(copter.id)}>
              <Zap size={15} />
              {t("Перейти на OpenPlane")}
            </button>
          ) : (
            <p className="hint warn-text">{t("Подключите плату с родным Betaflight по USB. Betaflight Configurator должен быть закрыт — порт может держать только одна программа.")}</p>
          )}
          <Advanced title={t("вручную, командами")}>
            <p className="hint">
              {t("В папке исходников прошивки:")} <span className="mono">{source ?? "—"}</span>
            </p>
            {boardDumpCommands(env?.boardFile ?? null).map((c) => (
              <CopyLine key={c} text={c} />
            ))}
          </Advanced>
        </>
      )}
      {dump && (
        <>
          <div className="kv" style={{ marginTop: 8 }}>
            <span>{t("Распиновка")}</span>
            <span className="mono">{dump.dump}</span>
            <span>{t("Родная прошивка")}</span>
            <span className="mono">{dump.backup ?? t("ещё не сохранена — сохранится при прошивке")}</span>
            <span>Betaflight</span>
            <span className="mono">
              {dump.bfBoard ?? dump.target} {dump.bf ?? ""} · {new Date(dump.at).toLocaleString(locale())}
            </span>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 12 }}>
            <button className="btn" disabled={!ours} title={ours ? undefined : t("Подключите коптер с прошивкой OpenPlane")} onClick={() => setImporting(true)}>
              <ArrowRightLeft size={15} />
              {copter.bfImportedAt ? t("Перенести настройки из Betaflight ещё раз") : t("Перенести настройки из Betaflight")}
            </button>
            <button className="btn ghost" disabled={!dump.backup || !!flash?.running} onClick={() => confirm(t("Вернуть на плату родной Betaflight? Наша прошивка сотрётся, настройки OpenPlane останутся в проекте.")) && void restoreOriginal(copter.id)}>
              <History size={15} />
              {t("Вернуть Betaflight")}
            </button>
          </div>
        </>
      )}
      {importing && dump && <ImportDialog copter={copter} dumpPath={dump.dump} onClose={() => setImporting(false)} />}
    </div>
  );
}

/** Перенос настроек из diff all Betaflight: что поймём — по группам, галочками. */
function ImportDialog({ copter, dumpPath, onClose }: { copter: CopterProject; dumpPath: string; onClose: () => void }) {
  const board = useCopterBoard();
  const toast = useApp((s) => s.toast);
  const updateCopter = useApp((s) => s.updateCopter);
  const [text, setText] = useState<string | null>(null);
  const [skip, setSkip] = useState<string[]>(IMPORT_SKIP_GROUPS);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  useEffect(() => {
    api.textRead(dumpPath).then(setText, (e) => {
      toast("err", errorText(e));
      onClose();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- файл читается один раз
  }, [dumpPath]);

  if (text === null) return null;
  const { lines, unknown } = parseBfDiff(text, board.params);
  const groups = Array.from(new Set(lines.map((l) => l.group ?? l.kind)));
  const chosen = lines.filter((l) => !skip.includes(l.group ?? l.kind));

  const run = async () => {
    setBusy(true);
    const errorsBefore = { ...useApp.getState().copterBoard.errors };
    for (const l of chosen) {
      await api.linkCommand(l.line);
      await sleep(40);
    }
    await sleep(500);
    const errs = Object.entries(useApp.getState().copterBoard.errors)
      .filter(([k, v]) => errorsBefore[k] !== v)
      .map(([k, v]) => `${k}: ${v}`);
    setResult(errs);
    updateCopter(copter.id, (c) => (c.bfImportedAt = new Date().toISOString()));
    setBusy(false);
  };

  const groupTitle = (g: string) => (IMPORT_SKIP_GROUPS.includes(g) ? `${g} — ${t("у нас считает модель")}` : g);
  return (
    <Modal onClose={onClose} width={620}>
      <h2>{t("Настройки из Betaflight")}</h2>
      {!result ? (
        <>
          <p className="sub">{t("Из «diff all» родной прошивки. Отметьте, что переносить; PID, расходы и фильтры у нас считает модель коптера — их лучше оставить.")}</p>
          <div className="import-groups">
            {groups.map((g) => (
              <label key={g} className="row" style={{ gap: 8 }}>
                <input type="checkbox" checked={!skip.includes(g)} onChange={(e) => setSkip(e.target.checked ? skip.filter((x) => x !== g) : [...skip, g])} />
                <span className="grow">{groupTitle(g)}</span>
                <span className="hint">{lines.filter((l: ImportLine) => (l.group ?? l.kind) === g).length}</span>
              </label>
            ))}
          </div>
          {unknown.length > 0 && (
            <Advanced title={t("не переносится: {n}", { n: unknown.length })}>
              <div className="cli mono">{unknown.slice(0, 200).join("\n")}</div>
            </Advanced>
          )}
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>
              {t("Отмена")}
            </button>
            <button className="btn primary" disabled={busy || !chosen.length} onClick={() => void run()}>
              {busy ? t("Переношу…") : t("Перенести {n}", { n: chosen.length })}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{result.length ? t("Плата не приняла:") : t("Всё перенесено. Проверьте вкладки и нажмите «Сохранить» вверху.")}</p>
          {result.length > 0 && <div className="cli mono">{result.join("\n")}</div>}
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              {t("Готово")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function OverviewTab({ copter }: { copter: CopterProject }) {
  const manifest = useApp((s) => s.manifest);
  const updateCopter = useApp((s) => s.updateCopter);
  const edit = (fn: (c: CopterProject) => void) => updateCopter(copter.id, fn);
  const envs = copterEnvs(manifest);
  const env = findCopterEnv(manifest, copter.board);
  const build = findCopterBuild(manifest, env?.build);
  const mhz = vtxFrequency(copter.vtxBand, copter.vtxChannel);
  const band = VTX_BANDS.find((b) => b.id === copter.vtxBand);
  const swIssues = switchIssues(copter.switches);

  return (
    <div className="copter-grid">
      <BetaflightCard copter={copter} />

      <div className="card">
        <h3>{t("Плата и сборка")}</h3>
        <div className="field">
          <label>{t("Название")}</label>
          <input className="input" value={copter.name} onChange={(e) => edit((c) => (c.name = e.target.value))} />
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>{t("Сборка прошивки")}</label>
          <select className="select" value={copter.board} onChange={(e) => edit((c) => (c.board = e.target.value))}>
            {!env && <option value={copter.board}>{copter.board || t("не выбрана")}</option>}
            {envs.map((e) => (
              <option key={e.env} value={e.env}>
                {t(e.title)}
              </option>
            ))}
          </select>
        </div>
        {env && (
          <div className="kv" style={{ marginTop: 12 }}>
            <span>{t("Сборка")}</span>
            <span>{build ? t(build.title) : env.build ?? "—"}</span>
            <span>{t("Регуляторы")}</span>
            <span>{env.esc}</span>
            <span>{t("Заливка")}</span>
            <span>{env.uploadProtocol === "dfu" ? "USB DFU" : env.uploadProtocol ?? "—"}</span>
            <span>{t("Прошит")}</span>
            <span>{copter.lastFlash ? `${new Date(copter.lastFlash.at).toLocaleString(locale())}${copter.lastFlash.ok ? "" : t(" (не подтверждено)")}` : "—"}</span>
          </div>
        )}
        {envs.length === 0 && manifest && <p className="locked-note">{t("В этих исходниках прошивки нет сборок коптера — обновите прошивку.")}</p>}
      </div>

      <div className="card">
        <h3>{t("Перед первым взлётом")}</h3>
        <ul className="checklist">
          <li>{t("Пропеллеры сняты, пока настраиваете и проверяете моторы.")}</li>
          <li>{t("Антенна видеопередатчика накручена до подачи питания: мощный передатчик без антенны сгорает за секунды.")}</li>
          <li>{t("«Приёмник»: стики двигают нужные полосы в нужную сторону.")}</li>
          <li>{t("«Режимы»: ARM, ANGLE и пищалка на тумблерах, метка видна в диапазоне.")}</li>
          <li>{t("«Моторы»: номер и направление каждого мотора совпадают со схемой.")}</li>
          <li>{t("«Подготовка»: горизонт наклоняется туда же, куда коптер; причин запрета ARM нет.")}</li>
          <li>{t("Без пропеллеров выключите пульт: моторы должны встать, на OSD — FAILSAFE.")}</li>
          <li>{t("Первый взлёт — в ANGLE, низко, в открытом поле; Li-ion не отдаёт долгий полный газ — садитесь по LOW BATTERY.")}</li>
        </ul>
      </div>

      <WriteSetup copter={copter} />

      <div className="card">
        <h3>{t("Тумблеры")}</h3>
        <p className="sub">{t("Каналы пульта: AUX1 — это CH5. На TX12 назначьте тумблеры в «Модель → Миксы», например SA → CH5, SB → CH6, SC → CH7, SD → CH8.")}</p>
        {SWITCHES.map((sw) => (
          <div key={sw.key} className="switch-row">
            <div className="grow">
              <div>{t(sw.title)}</div>
              <div className="hint">{t(sw.hint)}</div>
            </div>
            <AuxSelect value={copter.switches[sw.key]} onChange={(v) => edit((c) => (c.switches[sw.key] = v))} />
          </div>
        ))}
        {swIssues.map((i) => (
          <p key={i} className="hint warn-text">
            {i}
          </p>
        ))}
      </div>

      <div className="card">
        <h3>{t("Видеопередатчик")}</h3>
        <div className="field">
          <label>{t("Потолок мощности")}</label>
          <select className="select" value={copter.vtxMaxPowerMw} onChange={(e) => edit((c) => (c.vtxMaxPowerMw = Number(e.target.value)))}>
            {VTX_CAPS_MW.map((mw) => (
              <option key={mw} value={mw}>
                {capLabel(mw)}
                {mw === FREE_POWER_MW ? t(" — без разрешения") : ""}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          {t("Выше потолка передатчик не поднимется ни тумблером, ни кнопкой на нём самом. Без разрешения — до {mw} мВт в полосе {lo}–{hi} МГц.", {
            mw: FREE_POWER_MW,
            lo: FREE_BAND_MHZ[0],
            hi: FREE_BAND_MHZ[1],
          })}
        </p>
        <div className="row" style={{ gap: 10, marginTop: 10 }}>
          <div className="field grow">
            <label>{t("Полоса")}</label>
            <select className="select" value={copter.vtxBand} onChange={(e) => edit((c) => (c.vtxBand = Number(e.target.value)))}>
              {VTX_BANDS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.letter}
                  {GOGGLE_BANDS.includes(b.letter) ? "" : t(" (не для шлема)")}
                </option>
              ))}
            </select>
          </div>
          <div className="field grow">
            <label>{t("Канал")}</label>
            <select className="select" value={copter.vtxChannel} onChange={(e) => edit((c) => (c.vtxChannel = Number(e.target.value)))}>
              {(band?.mhz ?? []).map((f, i) => (
                <option key={i} value={i + 1}>
                  {i + 1} · {f}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="mono" style={{ margin: "10px 0 0" }}>
          {band?.letter}
          {copter.vtxChannel} · {mhz} {t("МГц")}
        </p>
        {band && !GOGGLE_BANDS.includes(band.letter) && <p className="hint warn-text">{t("Аналоговый шлем (Skyzone Cobra X) принимает полосы A, B, E, F, R, L — эту не увидит.")}</p>}
        {mhz > 0 && !inFreeBand(mhz) && <p className="hint warn-text">{t("{mhz} МГц — вне полосы {lo}–{hi} МГц, разрешённой без лицензии.", { mhz, lo: FREE_BAND_MHZ[0], hi: FREE_BAND_MHZ[1] })}</p>}
      </div>

      <div className="card wide">
        <h3>{t("Комплектующие")}</h3>
        <div className="parts-grid">
          {PART_KEYS.map((k) => (
            <div key={k} className="field">
              <label>{t(PART_LABELS[k])}</label>
              <input className="input" value={copter.parts[k]} onChange={(e) => edit((c) => (c.parts[k] = e.target.value))} />
            </div>
          ))}
        </div>
      </div>

      {copter.history.length > 0 && (
        <div className="card wide">
          <h3>{t("Прошивки")}</h3>
          <div className="kv">
            {copter.history.slice(0, 8).map((h) => (
              <span key={h.at} style={{ display: "contents" }}>
                <span>
                  {h.ok ? <CircleCheck size={13} color="var(--ok)" /> : <TriangleAlert size={13} color="var(--warn)" />} {new Date(h.at).toLocaleString(locale())}
                </span>
                <span className="mono">{`${h.board} · ${h.commit ?? "—"} · ${h.configHash}`}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
