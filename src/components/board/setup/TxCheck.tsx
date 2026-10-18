// 2. Пульт: живая картинка, направление стиков, «щёлкни тумблером» (тумблер
// пришёл на другой канал — прошивка переназначается), невыведенные каналы,
// триммеры и газ внизу.

import { ArrowRight, CircleCheck, RotateCcw, TriangleAlert, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LiveFrame } from "../../../api";
import { assignChannel, channelIndex, channelReversed, toggleChannelReversed } from "../../../core/channels";
import { channelTitle } from "../../../core/labels";
import { ChannelWatch, switchPosition } from "../../../core/live";
import { ManifestChannel } from "../../../core/manifest";
import { effectiveParam } from "../../../core/project";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { LiveKnob, LiveLever, LiveStick, useLive } from "../../live/LiveWidgets";
import { CheckState, usePassed, when } from "./common";

const STICKS = [
  { name: "AILERON", text: "Правый стик ВПРАВО до упора" },
  { name: "ELEVATOR", text: "Правый стик ОТ СЕБЯ (вверх) до упора" },
  { name: "THROTTLE", text: "Газ — левый стик ВВЕРХ до упора" },
  { name: "RUDDER", text: "Левый стик ВПРАВО до упора" },
] as const;

type StickResult = "ok" | "reversed" | "fixed" | "skipped";
type SwitchResult = "ok" | "moved" | "skipped";

/** Картинка пульта по живому кадру: стики, тумблеры, крутилки (вспышка — только что щёлкнули). */
export function LiveTransmitter({ live }: { live: LiveFrame | null }) {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const prev = useRef<LiveFrame | null>(null);
  const [flash, setFlash] = useState<Record<number, number>>({});
  const idx = (name: string) => channelIndex(manifest, plane, name);
  const ch = (name: string) => (live ? live.ch[idx(name)] : undefined);

  useEffect(() => {
    if (!live) return;
    const p = prev.current;
    prev.current = live;
    if (!p) return;
    const now = Date.now();
    const hits: Record<number, number> = {};
    live.ch.forEach((v, i) => {
      if (Math.abs(v - (p.ch[i] ?? v)) > 250) hits[i] = now;
    });
    if (Object.keys(hits).length) setFlash((f) => ({ ...f, ...hits }));
  }, [live]);

  const recent = (i: number) => (flash[i] ?? 0) > Date.now() - 900;
  const controls = manifest.channels.list.filter((c) => !c.stick && c.name !== "ARM");

  // Кадров от приёмника нет — в каналах значения по умолчанию, а не пульт.
  const stale = !live || live.rx !== "ok";
  return (
    <div className={`ltx${stale ? " stale" : ""}`} title={stale ? t("Нет кадров от приёмника — это не положения пульта") : undefined}>
      <LiveStick x={ch("RUDDER")} y={ch("THROTTLE")} label={t("газ · курс")} hint={t("нет данных")} />
      <div className="ltx-switches">
        {controls.map((c) =>
          c.positions === "knob" ? (
            <LiveKnob key={c.name} name={channelTitle(c.name)} ch={idx(c.name)} us={ch(c.name)} flash={recent(idx(c.name))} />
          ) : (
            <LiveLever
              key={c.name}
              name={c.name === "SWA" ? "SwA · ARM" : channelTitle(c.name)}
              ch={idx(c.name)}
              us={ch(c.name)}
              positions={c.positions === 3 ? 3 : 2}
              flash={recent(idx(c.name))}
            />
          ),
        )}
      </div>
      <LiveStick x={ch("AILERON")} y={ch("ELEVATOR")} label={t("крен · тангаж")} hint={t("нет данных")} />
    </div>
  );
}

export function TxCheck({ onState }: { onState?: (s: CheckState) => void }) {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const live = useLive();
  const { record, pass, reset } = usePassed("tx");

  const controls = manifest.channels.list.filter((c) => !c.stick && c.name !== "ARM");
  const [phase, setPhase] = useState<"idle" | "sticks" | "switches" | "rest" | "done">("idle");
  const [stickAt, setStickAt] = useState(0);
  const [stickRes, setStickRes] = useState<StickResult[]>([]);
  const [swAt, setSwAt] = useState(0);
  const [swRes, setSwRes] = useState<SwitchResult[]>([]);
  const [suspect, setSuspect] = useState<number | null>(null);
  const [silentFor, setSilentFor] = useState(0);
  const watch = useRef(new ChannelWatch());
  const start = useRef<{ v0: number; at: number } | null>(null);
  const seenPos = useRef(new Set<number>());

  const idx = (name: string) => channelIndex(manifest, plane, name);
  const stickIdx = new Set(STICKS.map((s) => idx(s.name)));

  const begin = () => {
    setPhase("sticks");
    setStickAt(0);
    setStickRes([]);
    setSwAt(0);
    setSwRes([]);
    start.current = null;
  };

  // --- стики
  useEffect(() => {
    if (phase !== "sticks" || !live || stickRes[stickAt]) return;
    const task = STICKS[stickAt];
    const i = idx(task.name);
    const v = live.ch[i];
    if (!start.current) start.current = { v0: v, at: Date.now() };
    const v0 = start.current.v0;
    const throttle = task.name === "THROTTLE";
    const up = throttle ? v > 1850 && v0 < 1500 : v > 1850;
    const down = throttle ? v < 1150 && v0 > 1500 : v < 1150;
    if (up || down) {
      setStickRes((r) => {
        const next = r.slice();
        next[stickAt] = up ? "ok" : "reversed";
        return next;
      });
      if (up) nextStick();
      return;
    }
    // Двинулся другой стик — не тот канал (режим стиков пульта?).
    const other = STICKS.map((s) => idx(s.name)).find((j) => j !== i && Math.abs(live.ch[j] - (j === idx("THROTTLE") ? 1000 : 1500)) > 400);
    setSuspect(other ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, phase, stickAt]);

  const nextStick = () => {
    start.current = null;
    setSuspect(null);
    if (stickAt + 1 < STICKS.length) setStickAt(stickAt + 1);
    else {
      setPhase("switches");
      setSwAt(0);
      watch.current.reset();
      seenPos.current.clear();
      setSilentFor(Date.now());
    }
  };

  const fixStick = () => {
    const i = idx(STICKS[stickAt].name);
    updatePlane((p) => toggleChannelReversed(manifest, p, i));
    setStickRes((r) => {
      const next = r.slice();
      next[stickAt] = "fixed";
      return next;
    });
    nextStick();
  };

  // --- тумблеры и крутилки
  const control: ManifestChannel | undefined = controls[swAt];
  const expected = control ? idx(control.name) : -1;
  useEffect(() => {
    if (phase !== "switches" || !live || !control) return;
    watch.current.push(live);
    const need = control.positions === "knob" ? 600 : 400;
    if (control.positions === 3) seenPos.current.add(switchPosition(live.ch[expected], 3));
    const candidates = live.ch.map((_, i) => i).filter((i) => !stickIdx.has(i));
    const best = candidates.reduce((a, b) => (watch.current.range(b) > watch.current.range(a) ? b : a), candidates[0]);
    if (watch.current.range(expected) >= need) {
      if (control.positions === 3 && seenPos.current.size < 3) return; // ждём все три положения
      finishSwitch("ok");
      return;
    }
    if (best !== undefined && best !== expected && watch.current.range(best) >= need && watch.current.range(expected) < 100) {
      setSuspect(best);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, phase, swAt]);

  const finishSwitch = (res: SwitchResult) => {
    setSwRes((r) => {
      const next = r.slice();
      next[swAt] = res;
      return next;
    });
    setSuspect(null);
    watch.current.reset();
    seenPos.current.clear();
    setSilentFor(Date.now());
    if (swAt + 1 < controls.length) setSwAt(swAt + 1);
    else {
      setPhase("rest");
      watch.current.reset();
    }
  };

  const moveTo = (index: number) => {
    if (!control) return;
    updatePlane((p) => assignChannel(manifest, p, control.name, index));
    finishSwitch("moved");
  };

  // --- стики отпущены: триммеры и газ внизу
  useEffect(() => {
    if (phase === "rest" && live) watch.current.push(live);
  }, [live, phase]);

  const low = Number(effectiveParam(manifest, plane, "THROTTLE_LOW_US")) || 1050;
  const fsLevel = Number(effectiveParam(manifest, plane, "RX_FAILSAFE_THROTTLE_US")) || 950;
  const restNotes: { ok: boolean; text: string }[] = [];
  if (phase === "rest" && live) {
    for (const [name, label] of [
      ["AILERON", "крена"],
      ["ELEVATOR", "тангажа"],
      ["RUDDER", "руля направления"],
    ] as const) {
      const off = watch.current.trimOffset(idx(name));
      if (off !== null) restNotes.push({ ok: false, text: t("Триммер {w} сдвинут на {v} мкс — верните в центр (до двойного писка).", { w: t(label), v: off > 0 ? `+${off}` : off }) });
    }
    const thr = live.ch[idx("THROTTLE")];
    if (thr >= low) restNotes.push({ ok: false, text: t("Газ внизу — {v} мкс, а ARM включается ниже {low}: опустите триммер газа.", { v: thr, low }) });
    else if (thr < fsLevel) restNotes.push({ ok: false, text: t("Газ внизу — {v} мкс, это ниже {fs}: плата примет это за потерю связи. Триммер газа — вверх, к центру.", { v: thr, fs: fsLevel }) });
    else restNotes.push({ ok: true, text: t("Газ внизу — {v} мкс: ARM включится, потерю связи с этим не спутать.", { v: thr }) });
  }
  const restReady = phase === "rest" && (watch.current.recent[idx("AILERON")]?.length ?? 0) >= 20;

  const silentHint =
    phase === "switches" && control && live && Date.now() - silentFor > 8000 && Math.abs(live.ch[expected] - 1500) < 4 && watch.current.range(expected) < 4;

  const state: CheckState = record ? "ok" : phase !== "idle" ? "run" : "todo";
  useEffect(() => onState?.(state), [state, onState]);

  return (
    <>
      <p className="check-lead">
        {t("Подвигайте стиками и тумблерами — картинка повторяет пульт. Пройдите проверку: приложение само увидит, что канал наоборот или тумблер пришёл не туда, и поправит прошивку.")}
      </p>
      <LiveTransmitter live={live} />
      {live && live.rx !== "ok" && (
        <div className="issue warning" style={{ marginTop: 10 }}>
          <TriangleAlert size={16} color="var(--warn)" />
          <div className="grow">{live.rx === "fs" ? t("Приёмник сообщает о потере связи — включите пульт.") : t("Кадров от приёмника нет — проверьте провод iBUS и питание приёмника.")}</div>
        </div>
      )}

      {phase === "idle" && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={!live || live.rx !== "ok"} onClick={begin}>
            {record ? <RotateCcw size={15} /> : <ArrowRight size={15} />}
            {record ? t("Проверить снова") : t("Начать проверку")}
          </button>
          {record && <span className="hint">{t("пройдена {when}", { when: when(record.at) })}</span>}
        </div>
      )}

      {phase === "sticks" && (
        <div className="task">
          <div className="task-step">
            {t("Стик {n} из {m}", { n: stickAt + 1, m: STICKS.length })}
          </div>
          <div className="task-text">{t(STICKS[stickAt].text)}</div>
          {stickRes[stickAt] === "reversed" && (
            <div className="issue warning">
              <TriangleAlert size={16} color="var(--warn)" />
              <div className="grow">
                {STICKS[stickAt].name === "THROTTLE" ? (
                  t("Газ работает наоборот. Его плата не переворачивает (по газу ловится потеря связи) — в пульте: Menu → Functions setup → Reverse → Channel 3 → Nor.")
                ) : (
                  <>
                    {t("Канал CH{n} работает наоборот.", { n: idx(STICKS[stickAt].name) + 1 })}{" "}
                    {channelReversed(manifest, plane, idx(STICKS[stickAt].name)) && t("(Сейчас в прошивке он уже перевёрнут.)")}
                    <div style={{ marginTop: 8 }}>
                      <button className="btn small" onClick={fixStick}>
                        <Wrench size={14} />
                        {t("Перевернуть канал в прошивке")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {suspect !== null && !stickRes[stickAt] && (
            <p className="hint">{t("Двигается CH{n}, а не CH{m} — проверьте, что стик тот, и режим стиков пульта (Mode 2).", { n: suspect + 1, m: idx(STICKS[stickAt].name) + 1 })}</p>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small ghost" onClick={nextStick}>
              {t("Пропустить")}
            </button>
          </div>
        </div>
      )}

      {phase === "switches" && control && (
        <div className="task">
          <div className="task-step">{t("Тумблер {n} из {m}", { n: swAt + 1, m: controls.length })}</div>
          <div className="task-text">
            {control.positions === "knob"
              ? t("Покрутите {c} от упора до упора", { c: channelTitle(control.name) })
              : control.positions === 3
                ? t("Пощёлкайте {c} по всем трём положениям", { c: channelTitle(control.name) })
                : t("Щёлкните {c} туда и обратно", { c: control.name === "SWA" ? "SwA (ARM)" : channelTitle(control.name) })}
          </div>
          {control.name === "SWA" && <p className="hint">{t("Газ держите внизу: ARM включится, но мотор без газа не закрутится.")}</p>}
          {suspect !== null && (
            <div className="issue warning">
              <TriangleAlert size={16} color="var(--warn)" />
              <div className="grow">
                {t("{c} пришёл на CH{n}, а прошивка ждёт его на CH{m}.", { c: channelTitle(control.name), n: suspect + 1, m: expected + 1 })}
                <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                  <button className="btn small" onClick={() => moveTo(suspect)}>
                    <Wrench size={14} />
                    {t("Слушать {c} на CH{n}", { c: channelTitle(control.name), n: suspect + 1 })}
                  </button>
                  <span className="hint">{t("или в пульте: Menu → Functions setup → Aux. channels")}</span>
                </div>
              </div>
            </div>
          )}
          {control.positions === 3 && watch.current.range(expected) >= 400 && seenPos.current.size < 3 && (
            <p className="hint">{t("Видно {n} положения из 3 — щёлкните и в середину.", { n: seenPos.current.size })}</p>
          )}
          {silentHint && (
            <p className="hint">
              {t("CH{n} стоит ровно на 1500 и не меняется — канал не выведен на пульте. FS-i6: Menu → Functions setup → Aux. channels → Channel {n} → {c}. На заводской прошивке FS-i6 каналов 6 — седьмой и дальше появляются после прошивки пульта на 10 каналов.", {
                n: expected + 1,
                c: channelTitle(control.name),
              })}
            </p>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn small ghost" onClick={() => finishSwitch("skipped")}>
              {t("Пропустить — такого нет")}
            </button>
          </div>
        </div>
      )}

      {phase === "rest" && (
        <div className="task">
          <div className="task-text">{t("Отпустите оба стика, газ — вниз")}</div>
          {!restReady && <p className="hint">{t("Смотрю на стики…")}</p>}
          {restReady &&
            restNotes.map((n, i) => (
              <div key={i} className={`issue ${n.ok ? "" : "warning"}`}>
                {n.ok ? <CircleCheck size={16} color="var(--ok)" /> : <TriangleAlert size={16} color="var(--warn)" />}
                <div className="grow">{n.text}</div>
              </div>
            ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn primary"
              disabled={!restReady}
              onClick={() => {
                const changed = stickRes.includes("fixed") || swRes.includes("moved");
                pass(changed ? t("исправления — после прошивки") : undefined);
                setPhase("done");
              }}
            >
              {t("Готово")}
            </button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="task">
          {stickRes.includes("fixed") || swRes.includes("moved") ? (
            <div className="issue warning">
              <TriangleAlert size={16} color="var(--warn)" />
              <div className="grow">{t("Каналы исправлены в проекте — заработает после прошивки. Потом пройдите проверку ещё раз.")}</div>
            </div>
          ) : (
            <div className="issue">
              <CircleCheck size={16} color="var(--ok)" />
              <div className="grow">{t("Пульт в порядке: стики в нужную сторону, все тумблеры на своих каналах.")}</div>
            </div>
          )}
          <button className="btn small ghost" onClick={() => { reset(); setPhase("idle"); }}>
            {t("Сбросить отметку")}
          </button>
        </div>
      )}
    </>
  );
}
