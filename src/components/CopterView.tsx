// Страница коптера: сборка прошивки, комплектующие, видеопередатчик с
// потолком мощности, тумблеры, первая настройка (строки CLI — в плату по
// связи) и что проверить перед первым взлётом.

import { CircleAlert, CircleCheck, Copy, TriangleAlert, Upload, Zap } from "lucide-react";
import { useState } from "react";

import { api, errorText } from "../api";
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
} from "../core/copter";
import { runCopterFlash } from "../flash";
import { locale, t } from "../i18n";
import { useApp } from "../store";
import { FlashDialog } from "./board/FlashDialog";

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

function WriteSetup({ copter }: { copter: CopterProject }) {
  const link = useApp((s) => s.link);
  const ports = useApp((s) => s.ports);
  const updateCopter = useApp((s) => s.updateCopter);
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const identity = link.state === "open" && link.port ? ports[link.port]?.identity : null;
  const ready = identity?.vehicle === "copter";
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
        {t("Настройки коптера живут на плате, как в Betaflight. Эти строки CLI ставят приёмник, видеопередатчик и тумблеры — приложение запишет их по USB, или вставьте их в CLI сами (консоль платы, клавиша c).")}
      </p>
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
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn primary" disabled={!ready || busy || !!identity?.armed} onClick={() => void write()} title={ready ? undefined : t("Подключите коптер с прошивкой OpenPlane по USB")}>
          <Upload size={15} />
          {t("Записать в плату")}
        </button>
        <button className="btn" onClick={() => copy([...lines.map((l) => l.cmd), "save"].join("\n"))}>
          <Copy size={15} />
          {t("Скопировать")}
        </button>
        <span className="hint grow">
          {identity?.armed
            ? t("Плата заармлена — снимите ARM.")
            : ready
              ? t("Плата на связи: {board}", { board: identity!.board })
              : t("Коптер не подключён")}
        </span>
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

export function CopterView() {
  const copter = useApp((s) => s.currentCopter());
  const manifest = useApp((s) => s.manifest);
  const source = useApp((s) => s.settings.firmwareSource);
  const updateCopter = useApp((s) => s.updateCopter);
  const flash = useApp((s) => s.flash);
  const setSection = useApp((s) => s.setSection);

  if (!copter) {
    return (
      <div className="page">
        <p className="muted">{t("Коптер не выбран.")}</p>
        <button className="btn" onClick={() => setSection("hangar")}>
          {t("В ангар")}
        </button>
      </div>
    );
  }

  const edit = (fn: (c: CopterProject) => void) => updateCopter(copter.id, fn);
  const envs = copterEnvs(manifest);
  const env = findCopterEnv(manifest, copter.board);
  const build = findCopterBuild(manifest, env?.build);
  const mhz = vtxFrequency(copter.vtxBand, copter.vtxChannel);
  const band = VTX_BANDS.find((b) => b.id === copter.vtxBand);
  const swIssues = switchIssues(copter.switches);
  const blocker = !manifest
    ? t("Нет описания прошивки — укажите папку исходников в «Настройках».")
    : !env
      ? t("Выберите сборку прошивки.")
      : env.needsBoardDump
        ? t("Сначала снимите распиновку платы.")
        : null;

  return (
    <div className="page copter-page">
      <div className="page-head">
        <div>
          <h1>{copter.name}</h1>
          <p>
            {t("Квадрокоптер")}
            {build ? ` · ${t(build.title)}` : ""}
            {env ? ` · ${t(env.title)}` : ""}
          </p>
        </div>
        <button className="btn primary" disabled={!!blocker || !!flash?.running} title={blocker ?? undefined} onClick={() => void runCopterFlash(copter.id)}>
          <Zap size={16} />
          {t("Прошить")}
        </button>
      </div>

      <div className="copter-grid">
        {env?.needsBoardDump && (
          <div className="card wide">
            <div className="row" style={{ gap: 8 }}>
              <CircleAlert size={18} color="var(--warn)" />
              <h3 style={{ margin: 0 }}>{t("Распиновка платы ещё не снята")}</h3>
            </div>
            <p className="sub">
              {t("Какой выход на какой ножке процессора, знает только родная прошивка платы (Betaflight). Один раз снимите её дамп и сохраните родную прошивку — команды выполняются в папке исходников:")}{" "}
              <span className="mono">{source ?? "—"}</span>
            </p>
            <ol className="steps-list">
              <li>
                {t("Плата с родным Betaflight по USB, Betaflight Configurator закрыт; COMx — порт платы:")}
                <CopyLine text={boardDumpCommands(env.boardFile)[0]} />
              </li>
              <li>
                {t("Родная прошивка — на всякий случай: зажмите BOOT, вставьте USB (режим DFU):")}
                <CopyLine text={boardDumpCommands(env.boardFile)[1]} />
              </li>
              <li>
                {t("Заголовок платы для нашей прошивки:")}
                <CopyLine text={boardDumpCommands(env.boardFile)[2]} />
              </li>
              <li>{t("«Настройки» → перечитать прошивку — кнопка «Прошить» станет доступна.")}</li>
            </ol>
          </div>
        )}

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
          {envs.length === 0 && manifest && (
            <p className="locked-note">{t("В этих исходниках прошивки нет сборок коптера — обновите прошивку.")}</p>
          )}
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
          {band && !GOGGLE_BANDS.includes(band.letter) && (
            <p className="hint warn-text">{t("Аналоговый шлем (Skyzone Cobra X) принимает полосы A, B, E, F, R, L — эту не увидит.")}</p>
          )}
          {mhz > 0 && !inFreeBand(mhz) && (
            <p className="hint warn-text">{t("{mhz} МГц — вне полосы {lo}–{hi} МГц, разрешённой без лицензии.", { mhz, lo: FREE_BAND_MHZ[0], hi: FREE_BAND_MHZ[1] })}</p>
          )}
        </div>

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
          <h3>{t("Перед первым взлётом")}</h3>
          <ul className="checklist">
            <li>{t("Пропеллеры сняты, пока настраиваете и проверяете моторы.")}</li>
            <li>{t("Антенна видеопередатчика накручена до подачи питания: мощный передатчик без антенны сгорает за секунды.")}</li>
            <li>{t("Приёмник и пульт: одна фраза привязки ExpressLRS и одна частота (915 или 868).")}</li>
            <li>{t("Порядок и направление моторов — по схеме Betaflight (Quad X); не так крутятся — props_out или реверс в регуляторах.")}</li>
            <li>{t("Без пропеллеров выключите пульт: моторы должны встать, на OSD — FAILSAFE.")}</li>
            <li>{t("Li-ion не отдаёт долгий полный газ: летайте плавно, садитесь по LOW BATTERY.")}</li>
            <li>{t("Дом ставится при ARM, если спутников не меньше gps_minimum_sats; возврата домой пока нет — только стрелка и расстояние на OSD.")}</li>
          </ul>
        </div>

        <div className="wide">
          <WriteSetup copter={copter} />
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
                <FlashRow key={h.at} at={h.at} ok={h.ok} text={`${h.board} · ${h.commit ?? "—"} · ${h.configHash}`} />
              ))}
            </div>
          </div>
        )}
      </div>

      {flash && <FlashDialog />}
    </div>
  );
}

function FlashRow({ at, ok, text }: { at: string; ok: boolean; text: string }) {
  return (
    <>
      <span>
        {ok ? <CircleCheck size={13} color="var(--ok)" /> : <TriangleAlert size={13} color="var(--warn)" />} {new Date(at).toLocaleString(locale())}
      </span>
      <span className="mono">{text}</span>
    </>
  );
}
