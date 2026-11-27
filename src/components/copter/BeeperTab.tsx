// «Пищалка»: что пищит (условия Betaflight галочками, «послушать» — плата
// пискнет этим рисунком), маяк моторами DShot (найти коптер в траве),
// пищалка на плате (уровень, открытый сток, частота пассивной). Команды
// стиками — схема на вкладке «Режимы». Мелодия (176): RTTTL по тумблеру
// MELODY, «послушать» здесь (WebAudio) и на плате, ноты картинкой.

import { Play, Square, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BEACON_CONDITIONS, BEEPER_CONDITIONS, isOn, toggled } from "../../core/beeper";
import { tabParams } from "../../core/copterParams";
import { compactMelody, MELODY_DEFAULT, MELODY_PRESETS, MELODY_TEXT_MAX, type MelodyNote, noteGapMs, parseRtttl, totalMs } from "../../core/melody";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamList, ParamRow, useCopterBoard, useCopterLink } from "./common";

const MASKS = ["beeper_off_flags", "dshot_beacon_off_flags", "beeper_dshot_beacon_tone", "beeper_melody", "beeper_melody_motors", "beeper_melody_startup"];

export function BeeperTab() {
  return (
    <NeedBoard>
      <BeeperBody />
    </NeedBoard>
  );
}

function BeeperBody() {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const off = Number(board.params.beeper_off_flags?.value ?? 0);
  const beaconOff = Number(board.params.dshot_beacon_off_flags?.value ?? 514);
  const tone = board.params.beeper_dshot_beacon_tone;
  const dshot = board.header?.dshotCommands !== false;
  const error = board.errors.beep;
  return (
    <div className="copter-grid">
      <div className="card wide">
        <h3>{t("Что пищит")}</h3>
        <p className="sub">
          {t("Условия как «beeper» в Betaflight. Снимите галочку — этого писка не будет. «Послушать» — плата пискнет так, как пищит это условие (без ARM).")}
        </p>
        {error && <p className="hint warn-text">{error}</p>}
        <div className="beeper-list">
          {BEEPER_CONDITIONS.map((c) => {
            const on = isOn(off, c.n);
            const beacon = BEACON_CONDITIONS.includes(c.name);
            return (
              <div key={c.name} className={`beeper-row${c.kind === "never" ? " dim" : ""}`} data-param="beeper_off_flags">
                <label className="row grow" style={{ gap: 8 }}>
                  <input type="checkbox" checked={on} disabled={armed} onChange={(e) => void set("beeper_off_flags", toggled(off, c.n, e.target.checked))} />
                  <span>
                    <span className="mono">{c.name}</span>
                    <span className="hint"> — {t(c.text)}</span>
                  </span>
                </label>
                {beacon && (
                  <label className="row hint" style={{ gap: 6 }} title={t("Регуляторы DShot пищат моторами — слышно издалека")} data-param="dshot_beacon_off_flags">
                    <input type="checkbox" checked={isOn(beaconOff, c.n)} disabled={armed || !dshot} onChange={(e) => void set("dshot_beacon_off_flags", toggled(beaconOff, c.n, e.target.checked))} />
                    {t("и моторами")}
                  </label>
                )}
                {c.kind !== "never" && (
                  <button className="btn ghost small" disabled={armed} title={t("Послушать")} onClick={() => void cmd(`beep ${c.name}`)}>
                    <Volume2 size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <h3>{t("Маяк моторами")}</h3>
        <p className="sub">
          {t("Упал в траву — выключите пульт (RX_LOST) или включите режим BEEPER (RX_SET): регуляторы DShot пищат моторами, громче пищалки. Только без ARM и через 1.2 с после DISARM; ARM после маяка — через 1.2 с.")}
        </p>
        {!dshot && <p className="hint warn-text">{t("Регуляторы не DShot — маяка моторами нет.")}</p>}
        {tone && <ParamRow p={tone} title={t("Тон")} />}
        <button className="btn ghost small" disabled={armed || !dshot} onClick={() => void cmd(`dshot all ${tone?.value ?? 1}`)}>
          <Volume2 size={14} />
          {t("Пискнуть моторами (без пропеллеров не обязательно — моторы не крутятся)")}
        </button>
      </div>
      <MelodyCard />
      <ParamList title={t("Пищалка на плате")} sub={t("Обычно менять не нужно: умолчание — от платы.")} params={tabParams(board, "beeper", MASKS)} />
    </div>
  );
}

// Мелодия: строка RTTTL, заготовки, ноты картинкой, «послушать» здесь и на плате.
function MelodyCard() {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const param = board.params.beeper_melody;
  const saved = String(param?.value ?? MELODY_DEFAULT) || MELODY_DEFAULT;
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const text = compactMelody(draft);
  const parsed = parseRtttl(text);
  const tooLong = text.length > MELODY_TEXT_MAX;
  const changed = text !== saved;
  const stopRef = useRef<(() => void) | null>(null);
  const [local, setLocal] = useState(false);
  useEffect(() => () => stopRef.current?.(), []);
  const passive = Number(board.params.beeper_frequency?.value ?? 0) > 0;
  const motors = board.params.beeper_melody_motors;
  const startup = board.params.beeper_melody_startup;
  const error = board.errors.melody ?? board.errors.beeper_melody ?? board.errors.music;
  // треки моторами по оборотам (176c) — значения beeper_melody_motors после OFF/ON
  const tracks = (motors?.options ?? []).filter((o) => o !== "OFF" && o !== "ON");

  const listen = () => {
    stopRef.current?.();
    if (!parsed.ok) return;
    setLocal(true);
    stopRef.current = playInBrowser(parsed.notes, () => setLocal(false));
  };
  const stopLocal = () => {
    stopRef.current?.();
    stopRef.current = null;
    setLocal(false);
  };

  return (
    <div className="card wide" data-param="beeper_melody">
      <h3>{t("Мелодия")}</h3>
      <p className="sub">
        {t("Режим MELODY на тумблере (вкладка «Режимы»): без ARM и со связью пищалка играет мелодию по кругу; тумблер ARM — сразу тишина. Формат RTTTL — как рингтоны и звуки EdgeTX.")}
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {MELODY_PRESETS.map((m) => (
          <button key={m.name} className={`btn ghost small${compactMelody(m.rtttl) === text ? " active" : ""}`} disabled={armed} onClick={() => setDraft(m.rtttl)}>
            {t(m.name)}
          </button>
        ))}
      </div>
      <textarea
        className="mono"
        rows={2}
        style={{ width: "100%", resize: "vertical" }}
        value={draft}
        disabled={armed}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="row hint" style={{ gap: 12, justifyContent: "space-between" }}>
        <span className={tooLong || !parsed.ok ? "warn-text" : ""}>
          {tooLong
            ? t("Длиннее {n} символов — плата не примет.", { n: MELODY_TEXT_MAX })
            : parsed.ok
              ? t("{n} нот · {s} с", { n: parsed.notes.filter((x) => x.hz > 0).length, s: (totalMs(parsed.notes) / 1000).toFixed(1) })
              : t("Символ {at}: {error}", { at: parsed.at + 1, error: t(parsed.error) })}
        </span>
        <span className="mono">
          {text.length}/{MELODY_TEXT_MAX}
        </span>
      </div>
      {parsed.ok && <MelodyRoll notes={parsed.notes} />}
      {error && <p className="hint warn-text">{error}</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button className="btn small" disabled={armed || !changed || !parsed.ok || tooLong} onClick={() => void set("beeper_melody", text === MELODY_DEFAULT ? "" : text)}>
          {t("Записать на плату")}
        </button>
        {local ? (
          <button className="btn ghost small" onClick={stopLocal}>
            <Square size={14} />
            {t("Стоп")}
          </button>
        ) : (
          <button className="btn ghost small" disabled={!parsed.ok} onClick={listen}>
            <Play size={14} />
            {t("Послушать здесь")}
          </button>
        )}
        <button className="btn ghost small" disabled={armed || changed} title={changed ? t("Сначала запишите на плату") : undefined} onClick={() => void cmd("melody")}>
          <Volume2 size={14} />
          {t("Сыграть на плате")}
        </button>
        <button className="btn ghost small" disabled={armed} onClick={() => void cmd("melody stop")}>
          <Square size={14} />
          {t("Замолчать")}
        </button>
      </div>
      {!passive && <p className="hint">{t("Пищалка активная (beeper_frequency = 0): звучит только ритм мелодии, одной высотой. Ноты — у пассивной пищалки.")}</p>}
      {motors && <ParamRow p={motors} title={t("И моторами")} />}
      {startup && <ParamRow p={startup} title={t("При включении")} />}
      {tracks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p className="hint warn-text">{t("Треки моторами: моторы крутятся и поют оборотами — только без винтов! Имя трека в «И моторами» — его играет тумблер MELODY.")}</p>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {tracks.map((name) => (
              <button key={name} className="btn ghost small" disabled={armed} onClick={() => void cmd(`music play ${name}`)}>
                <Play size={14} />
                {trackTitles()[name] ?? name}
              </button>
            ))}
            <button className="btn ghost small" onClick={() => void cmd("music off")}>
              <Square size={14} />
              {t("Стоп моторам")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Встроенные треки прошивки (copter/MotorTracks.h) — по-человечески.
const trackTitles = (): Record<string, string> => ({
  korobeiniki: t("Коробейники"),
  ode: t("Ода к радости"),
  grieg: t("В пещере горного короля"),
  elise: t("К Элизе"),
  scale: t("Гамма (проверка)"),
  custom: t("Свой трек"),
});

// Ноты картинкой: по времени — вправо, по высоте — вверх; паузы пустые.
function MelodyRoll({ notes }: { notes: MelodyNote[] }) {
  const total = Math.max(1, totalMs(notes));
  const keys = notes.filter((n) => n.hz > 0).map((n) => n.key);
  const lo = Math.min(...keys) - 1,
    hi = Math.max(...keys) + 1;
  const span = Math.max(4, hi - lo);
  const W = 600,
    H = 70;
  let at = 0;
  return (
    <svg className="melody-roll" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block", margin: "6px 0" }} role="img" aria-label={t("Ноты мелодии")}>
      <rect x={0} y={0} width={W} height={H} fill="var(--bg-soft, rgba(127,127,127,0.08))" rx={4} />
      {notes.map((n, i) => {
        const x = (at / total) * W;
        at += n.ms;
        if (n.hz === 0) return null;
        const w = Math.max(1.5, ((n.ms - noteGapMs(n.ms)) / total) * W);
        const y = H - 6 - ((n.key - lo) / span) * (H - 12);
        return <rect key={i} x={x} y={y - 3} width={w} height={6} rx={2} fill="var(--accent, #3b82f6)" />;
      })}
    </svg>
  );
}

// Сыграть ноты в приложении (квадратная волна — похоже на пищалку). Возвращает «стоп».
function playInBrowser(notes: MelodyNote[], done: () => void): () => void {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    done();
    return () => {};
  }
  const ctx = new Ctx();
  const gain = ctx.createGain();
  gain.gain.value = 0.08;
  gain.connect(ctx.destination);
  let at = ctx.currentTime + 0.05;
  for (const n of notes) {
    const len = n.ms / 1000;
    if (n.hz > 0) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = n.hz;
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + Math.max(0.005, len - noteGapMs(n.ms) / 1000));
    }
    at += len;
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    void ctx.close();
    done();
  };
  const timer = window.setTimeout(close, (at - ctx.currentTime) * 1000 + 100);
  return () => {
    window.clearTimeout(timer);
    close();
  };
}
