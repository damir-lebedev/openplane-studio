// «Приёмник»: каналы пульта живьём (как вкладка Receiver в BF), порядок
// каналов (map), концы стиков (rxrange) — по движению стиков, настройки
// приёмника.

import { Move } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { num, rcAutoCutoff, rcStepResponse, tabParams } from "../../core/copterParams";
import { linkBars, rssiSourceText } from "../../core/link";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Seg } from "../ui";
import { NeedBoard, ParamList, ParamRow, useCopterBoard, useCopterLink, useCopterLive } from "./common";

const STICKS: Record<string, string> = { A: "Крен (A)", E: "Тангаж (E)", R: "Рысканье (R)", T: "Газ (T)" };
const MAPS = ["AETR1234", "TAER1234"];

/** Подпись канала по порядку (map AETR1234): первые четыре — стики, дальше AUX. */
export function channelName(map: string, i: number): string {
  if (i < 4) return t(STICKS[map[i]] ?? map[i] ?? "?");
  return `AUX${i - 3}`;
}

export function ReceiverTab() {
  return (
    <NeedBoard>
      <ReceiverBody />
    </NeedBoard>
  );
}

/** Каналы пульта живьём — полосами, как вкладка Receiver в BF. */
export function ChannelBars() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const rc = board.rc;
  const map = rc?.map ?? "AETR1234";
  const channels = live?.ch.slice(0, Math.max(8, rc?.channels ?? 8)) ?? [];
  return (
    <>
      {!live && <p className="muted">{t("Жду живые кадры с платы…")}</p>}
      {live && live.rx !== "ok" && <p className="hint warn-text">{live.rx === "fs" ? t("Приёмник сообщает FAILSAFE: пульт выключен или не привязан.") : t("Кадров от приёмника нет: проверьте провода и serialrx_provider.")}</p>}
      <div className="ch-bars">
        {channels.map((us, i) => (
          <div key={i} className="ch-bar">
            <span className="ch-name">{channelName(map, i)}</span>
            <div className="ch-track">
              <div className="ch-mid" />
              <div className="ch-fill" style={{ width: `${Math.max(0, Math.min(100, (us - 1000) / 10))}%` }} />
            </div>
            <span className="mono ch-val">{us}</span>
          </div>
        ))}
      </div>
      <p className="hint">{t("Крен вправо, тангаж от себя (нос вниз), рысканье вправо, газ вверх — полоса вправо, к 2000. Иначе — поменяйте порядок каналов или реверс в пульте.")}</p>
    </>
  );
}

function ReceiverBody() {
  const board = useCopterBoard();
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const map = board.rc?.map ?? "AETR1234";
  const mapOptions = MAPS.map((m) => ({ value: m, label: m.slice(0, 4) }));
  if (!MAPS.includes(map)) mapOptions.push({ value: "custom", label: map });

  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Каналы пульта")}</h3>
        <ChannelBars />
      </div>

      <div className="card">
        <h3>{t("Порядок каналов")}</h3>
        <p className="sub">{t("ExpressLRS и FrSky — AETR, Spektrum и старые FlySky — TAER.")}</p>
        <Seg value={MAPS.includes(map) ? map : "custom"} options={mapOptions} onChange={(m) => !armed && m !== "custom" && void cmd(`map ${m}`)} />
        <StickRange />
      </div>

      <LinkCard />

      <RcSmoothingCard />

      <div className="wide">
        <ParamList title={t("Приёмник")} params={tabParams(board, "receiver", SMOOTHING)} />
      </div>
    </div>
  );
}

/** Связь с пультом: LQ и RSSI полосами, пороги OSD чертой. */
function LinkCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const bars = linkBars(live, num(board, "osd_link_quality_alarm", 80), num(board, "osd_rssi_alarm", 20));
  return (
    <div className="card">
      <h3>{t("Связь с пультом")}</h3>
      <p className="sub">{t("LQ — сколько пакетов доходит, RSSI — сила сигнала. Черта — порог предупреждения в очках.")}</p>
      {bars.length === 0 && <p className="muted">{live ? t("Приёмник не сообщает качество связи.") : t("Жду живые кадры с платы…")}</p>}
      <div className="ch-bars">
        {bars.map((b) => (
          <div key={b.key} className={`ch-bar link-${b.level}`}>
            <span className="ch-name">{b.key === "lq" ? "LQ" : "RSSI"}</span>
            <div className="ch-track">
              {b.alarm > 0 && <div className="ch-mid" style={{ left: `${b.alarm}%` }} />}
              <div className="ch-fill" style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} />
            </div>
            <span className="mono ch-val">{b.dbm !== undefined ? `${b.dbm} dBm` : `${b.value}%`}</span>
          </div>
        ))}
      </div>
      {live && <p className="hint">{t("RSSI: {src}", { src: t(rssiSourceText(live.rssisrc)) })}</p>}
    </div>
  );
}

const SMOOTHING = ["rc_smoothing", "rc_smoothing_auto_factor", "rc_smoothing_auto_factor_throttle", "rc_smoothing_setpoint_cutoff", "rc_smoothing_throttle_cutoff", "deadband", "yaw_deadband"];

/** Сглаживание стиков: частота кадров, срезы и как стик доходит до моторов. */
function RcSmoothingCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const params = SMOOTHING.map((n) => board.params[n]).filter(Boolean);
  if (params.length === 0) return null;
  const on = String(board.params.rc_smoothing?.value ?? "ON") === "ON";
  const frameHz = live?.rxhz && live.rxhz > 1 ? live.rxhz : 250;
  const manual = num(board, "rc_smoothing_setpoint_cutoff", 0);
  const cutoff = on ? (live?.rcsp ?? (manual || rcAutoCutoff(frameHz, num(board, "rc_smoothing_auto_factor", 30)))) : 0;
  const pts = rcStepResponse(frameHz, cutoff);
  const W = 420, H = 130, L = 8, B = 18;
  const x = (ms: number) => L + ((W - 2 * L) * ms) / 40;
  const y = (v: number) => H - B - (H - B - 8) * v;
  const line = (k: "raw" | "smooth") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join(" ");
  return (
    <div className="card">
      <h3>{t("Сглаживание стиков")}</h3>
      <div className="kv">
        <span>{t("Кадры приёмника")}</span>
        <span className="mono">{live?.rxhz ? `${Math.round(live.rxhz)} ${t("Гц")}` : t("нет данных — считаю 250 Гц")}</span>
        <span>{t("Срез стиков · газа")}</span>
        <span className="mono">{on ? `${Math.round(cutoff)} · ${Math.round(live?.rcth ?? cutoff)} ${t("Гц")}` : t("выключено")}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="rescue-svg" role="img" aria-label={t("Стик рывком: кадры и после сглаживания")}>
        <line x1={L} x2={W - L} y1={y(0)} y2={y(0)} className="rescue-ground" />
        <path d={line("raw")} className="rc-raw" />
        <path d={line("smooth")} className="rescue-path" />
        <text x={x(1)} y={H - 4} className="rescue-label">0</text>
        <text x={x(40)} y={H - 4} textAnchor="end" className="rescue-label">40 {t("мс")}</text>
      </svg>
      <p className="hint">{t("Серым — стик, как его присылает приёмник (ступеньки на каждом кадре); голубым — что получат моторы. Больше rc_smoothing_auto_factor — плавнее, но позже.")}</p>
      {params.map((p) => (
        <ParamRow key={p.name} p={p} />
      ))}
    </div>
  );
}

/** Концы стиков: подвигать стики по кругу до упора — записать rxrange. */
function StickRange() {
  const live = useCopterLive();
  const rc = useApp((s) => s.copterBoard.rc);
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const [recording, setRecording] = useState(false);
  const seen = useRef<[number, number][]>([]);
  const [, redraw] = useState(0);

  useEffect(() => {
    if (!recording || !live) return;
    for (let i = 0; i < 4; i++) {
      const us = live.ch[i];
      const r = seen.current[i] ?? [us, us];
      seen.current[i] = [Math.min(r[0], us), Math.max(r[1], us)];
    }
    redraw((n) => n + 1);
  }, [recording, live]);

  const map = rc?.map ?? "AETR1234";
  const ok = seen.current.length === 4 && seen.current.every(([lo, hi]) => hi - lo > 600);
  const finish = async () => {
    setRecording(false);
    // rxrange — по стикам A, E, R, T (порядок BF), а каналы — по map
    for (const [stick, letter] of ["A", "E", "R", "T"].entries()) {
      const ch = map.indexOf(letter);
      const r = seen.current[ch];
      if (r) await cmd(`rxrange ${stick} ${r[0]} ${r[1]}`);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <h4>{t("Концы стиков")}</h4>
      <p className="hint">
        {t("Сейчас:")}{" "}
        <span className="mono">{rc ? rc.rxrange.map((r, i) => `${"AERT"[i]} ${r[0]}–${r[1]}`).join(" · ") : "—"}</span>
      </p>
      {!recording ? (
        <button className="btn" disabled={armed || !live} onClick={() => ((seen.current = []), setRecording(true))}>
          <Move size={15} />
          {t("Записать по стикам")}
        </button>
      ) : (
        <>
          <p className="hint">{t("Обведите оба стика по кругу до упора несколько раз, затем «Готово».")}</p>
          <div className="mono hint">
            {seen.current.map((r, i) => (
              <div key={i}>
                {channelName(map, i)}: {r[0]}–{r[1]}
              </div>
            ))}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" disabled={!ok} onClick={() => void finish()}>
              {t("Готово")}
            </button>
            <button className="btn ghost" onClick={() => setRecording(false)}>
              {t("Отмена")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
