// «Приёмник»: каналы пульта живьём (как вкладка Receiver в BF), порядок
// каналов (map), концы стиков (rxrange) — по движению стиков, настройки
// приёмника.

import { Move } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { tabParams } from "../../core/copterParams";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { Seg } from "../ui";
import { NeedBoard, ParamList, useCopterBoard, useCopterLink, useCopterLive } from "./common";

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

function ReceiverBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const cmd = useApp((s) => s.copterCommand);
  const { armed } = useCopterLink();
  const rc = board.rc;
  const map = rc?.map ?? "AETR1234";
  const channels = live?.ch.slice(0, Math.max(8, rc?.channels ?? 8)) ?? [];
  const mapOptions = MAPS.map((m) => ({ value: m, label: m.slice(0, 4) }));
  if (!MAPS.includes(map)) mapOptions.push({ value: "custom", label: map });

  return (
    <div className="copter-grid">
      <div className="card">
        <h3>{t("Каналы пульта")}</h3>
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
      </div>

      <div className="card">
        <h3>{t("Порядок каналов")}</h3>
        <p className="sub">{t("ExpressLRS и FrSky — AETR, Spektrum и старые FlySky — TAER.")}</p>
        <Seg value={MAPS.includes(map) ? map : "custom"} options={mapOptions} onChange={(m) => !armed && m !== "custom" && void cmd(`map ${m}`)} />
        <StickRange />
      </div>

      <div className="wide">
        <ParamList title={t("Приёмник")} params={tabParams(board, "receiver")} />
      </div>
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
