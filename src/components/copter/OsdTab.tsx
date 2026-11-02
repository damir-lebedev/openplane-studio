// Вкладка «OSD»: экран очков 30 × 16 (PAL) или 13 (NTSC) строк — элементы
// перетаскиваются мышью, галочка показывает или прячет. Позиции — настройки BF
// osd_*_pos (прошивка: copter/Osd.h), поэтому diff из Betaflight переносится
// как есть. С платы идут живые значения — на экране то, что увидит пилот.

import { RotateCcw } from "lucide-react";
import { PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import { CopterLive } from "../../api";
import { OSD_COLS, osdElements, OsdElementParam, osdMove, osdToggle, osdVisible, osdX, osdY, tabParams } from "../../core/copterParams";
import { preflightOsd } from "../../core/preflight";
import { N_, t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, ParamList, useCopterBoard, useCopterLink, useCopterLive } from "./common";
import { OsdMenuCard } from "./OsdMenuCard";

export function OsdTab() {
  return (
    <NeedBoard>
      <OsdBody />
    </NeedBoard>
  );
}

const TITLES: Record<string, string> = {
  link_quality: N_("Качество связи (LQ)"),
  flymode: N_("Режим полёта"),
  gps_sats: N_("Спутники"),
  vtx_channel: N_("Мощность видео"),
  crosshairs: N_("Прицел"),
  warnings: N_("Предупреждения"),
  current: N_("Ток"),
  mah_drawn: N_("Израсходовано мА·ч"),
  home_dir: N_("Стрелка домой"),
  home_dist: N_("Расстояние домой"),
  altitude: N_("Высота"),
  vbat: N_("Напряжение батареи"),
  avg_cell_voltage: N_("Напряжение на банку"),
  tim_2: N_("Время в полёте"),
  throttle: N_("Газ"),
  gps_speed: N_("Скорость"),
  vario_num: N_("Вертикальная скорость"),
  craft_name: N_("Имя коптера"),
  power: N_("Мощность, Вт"),
  gps_lat: N_("Широта"),
  gps_lon: N_("Долгота"),
  rssi_value: N_("Сила сигнала (RSSI)"),
  preflight: N_("Перед полётом (до ARM)"),
};

// Значки шрифта BF — похожими знаками (клетка — один символ, как в чипе);  в начале — значок, рисуется цветом.
const S = "";
const SYM = { rssi: S + "ʀ", lq: S + "ℓ", satL: S + "◂", satR: S + "▸", volt: S + "V", amp: S + "A", mah: S + "ᵐ", metre: S + "M", alt: S + "▴", fly: S + "◷", thr: S + "▮", speed: S + "»", kph: S + "ᵏ", mps: S + "ˢ", watt: S + "W", lat: S + "φ", lon: S + "λ", home: S + "↑", cross: S + "✛" };

/** Клетки элемента: живые значения, если плата на связи, иначе пример. */
function cells(key: string, live: CopterLive | null, craft: string): string[] {
  const g = live?.gps;
  const ch = (s: string) => [...s];
  switch (key) {
    case "link_quality":
      return [SYM.lq, ...ch(String(live?.lq ?? 100))];
    case "flymode":
      return ch(live?.rescue ? "RESC" : live?.state === "FAILSAFE" ? "!FS!" : (live?.mode ?? "ANGL").slice(0, 4).toUpperCase());
    case "gps_sats":
      return [SYM.satL, SYM.satR, ...ch(String(g?.sats ?? 14))];
    case "vtx_channel":
      return ch(live?.vtx ? (live.vtx.pit ? "PIT" : `${live.vtx.mw}MW`) : "25MW");
    case "crosshairs":
      return [SYM.cross];
    case "warnings": {
      const w = live ? (live.state === "FAILSAFE" ? "FAILSAFE" : live.bat === "CRITICAL" ? "BATT CRITICAL" : live.bat === "WARNING" ? "LOW BATTERY" : !live.arm ? (live.block[0] ?? "DISARMED") : "") : "LOW BATTERY";
      const pad = Math.max(0, Math.floor((12 - w.length) / 2));
      return [...Array(pad).fill(" "), ...ch(w), ...Array(Math.max(0, 12 - pad - w.length)).fill(" ")];
    }
    case "current":
      return [...ch((live?.amps ?? 12.3).toFixed(1)), SYM.amp];
    case "mah_drawn":
      return [...ch(String(Math.round(live?.mah ?? 1234))), SYM.mah];
    case "home_dir":
      return [S + arrow(g?.dir)];
    case "home_dist":
      return ch(distance(g?.home ?? 125));
    case "altitude":
      return [SYM.alt, ...ch(String(Math.round(live?.alt ?? 12))), SYM.metre];
    case "vbat":
      return [...ch((live?.v ?? 25.2).toFixed(1)), SYM.volt];
    case "avg_cell_voltage":
      return [...ch((live?.cell ?? 4.2).toFixed(2)), SYM.volt];
    case "tim_2":
      return [SYM.fly, ...ch("02:13")];
    case "throttle":
      return [SYM.thr, ...ch(String(Math.round((live?.thr ?? 0.42) * 100)))];
    case "gps_speed":
      return [SYM.speed, ...ch(String(Math.round((g?.spd ?? 15) * 3.6))), SYM.kph];
    case "vario_num":
      return [...ch(`${(live?.vz ?? 1.2) >= 0 ? "+" : ""}${(live?.vz ?? 1.2).toFixed(1)}`), SYM.mps];
    case "craft_name":
      return ch((craft || "SEVEN").toUpperCase());
    case "power":
      return [...ch(String(Math.round((live?.v ?? 25.2) * (live?.amps ?? 12.3)))), SYM.watt];
    case "gps_lat":
      return [SYM.lat, ...ch((g?.lat ?? 55.7512345).toFixed(7))];
    case "gps_lon":
      return [SYM.lon, ...ch((g?.lon ?? 37.6184321).toFixed(7))];
    case "rssi_value":
      return [SYM.rssi, ...ch(String(live?.rssi ?? 99))];
    case "preflight":
      return live?.arm ? [] : ch(preflightOsd(live));
    default:
      return ch(key.toUpperCase().slice(0, 6));
  }
}

function arrow(dir: number | undefined): string {
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  return arrows[(((Math.round((dir ?? 0) / 45) % 8) + 8) % 8)];
}

function distance(m: number): string {
  return m < 1000 ? `${Math.round(m)}M` : `${(m / 1000).toFixed(1)}KM`;
}

interface Drag {
  key: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
}

function OsdBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const [pal, setPal] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const rows = pal ? 16 : 13;
  const elements = osdElements(board);
  const craft = String(board.params.craft_name?.value ?? "");
  const all = tabParams(board, "osd");
  const stats = all.filter((p) => p.name.startsWith("osd_stat_"));
  const warns = all.filter((p) => p.name.startsWith("osd_warn_") || p.name.endsWith("_alarm"));

  const cellAt = (e: ReactPointerEvent) => {
    const r = screen.current!.getBoundingClientRect();
    return { cx: Math.floor(((e.clientX - r.left) / r.width) * OSD_COLS), cy: Math.floor(((e.clientY - r.top) / r.height) * rows) };
  };
  const start = (el: OsdElementParam, e: ReactPointerEvent) => {
    if (armed) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const { cx, cy } = cellAt(e);
    setSelected(el.key);
    setDrag({ key: el.key, dx: cx - osdX(el.pos), dy: cy - osdY(el.pos), x: osdX(el.pos), y: osdY(el.pos) });
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag) return;
    const { cx, cy } = cellAt(e);
    const width = cells(drag.key, live, craft).length;
    const x = Math.max(0, Math.min(OSD_COLS - width, cx - drag.dx));
    const y = Math.max(0, Math.min(rows - 1, cy - drag.dy));
    if (x !== drag.x || y !== drag.y) setDrag({ ...drag, x, y });
  };
  const end = () => {
    if (!drag) return;
    const el = elements.find((x) => x.key === drag.key);
    if (el && (osdX(el.pos) !== drag.x || osdY(el.pos) !== drag.y)) void set(el.param.name, osdMove(el.pos, drag.x, drag.y));
    setDrag(null);
  };
  const resetAll = () => {
    for (const el of elements) if (Number(el.param.default) !== el.pos) void set(el.param.name, Number(el.param.default));
  };
  const hiddenNtsc = elements.filter((el) => osdVisible(el.pos) && osdY(el.pos) >= 13);

  return (
    <div className="copter-grid">
      <div className="card wide">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3>{t("Экран в очках")}</h3>
            <p className="sub">{t("Перетащите элемент мышью — он встанет туда же в очках. Галочка справа показывает или прячет.")}</p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <div className="seg">
              <button className={pal ? "on" : ""} onClick={() => setPal(true)}>
                PAL
              </button>
              <button className={!pal ? "on" : ""} onClick={() => setPal(false)}>
                NTSC
              </button>
            </div>
            <button className="btn ghost" disabled={armed} onClick={resetAll} title={t("Расставить элементы как в Betaflight по умолчанию")}>
              <RotateCcw size={14} /> {t("По умолчанию")}
            </button>
          </div>
        </div>
        <div className="osd-layout">
          <div
            ref={screen}
            className={`osd-screen${armed ? " locked" : ""}`}
            style={{ aspectRatio: `${OSD_COLS * 12} / ${rows * 18}`, ["--rows" as string]: rows }}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {elements
              .filter((el) => osdVisible(el.pos))
              .map((el) => {
                const dragging = drag?.key === el.key;
                const x = dragging ? drag.x : osdX(el.pos);
                const y = dragging ? drag.y : osdY(el.pos);
                if (y >= rows) return null;
                const c = cells(el.key, live, craft);
                return (
                  <div
                    key={el.key}
                    className={`osd-el${dragging ? " dragging" : ""}${selected === el.key ? " sel" : ""}`}
                    style={{ left: `${(x / OSD_COLS) * 100}%`, top: `${(y / rows) * 100}%`, width: `${(c.length / OSD_COLS) * 100}%`, height: `${100 / rows}%` }}
                    title={t(TITLES[el.key] ?? el.key)}
                    onPointerDown={(e) => start(el, e)}
                  >
                    {c.map((ch, i) => (
                      <span key={i} className={ch.startsWith(S) ? "sym" : undefined}>
                        {ch.startsWith(S) ? ch.slice(1) : ch}
                      </span>
                    ))}
                  </div>
                );
              })}
          </div>
          <div className="osd-list">
            {elements.map((el) => (
              <label key={el.key} className={`osd-item${selected === el.key ? " sel" : ""}`} onMouseEnter={() => setSelected(el.key)}>
                <input type="checkbox" disabled={armed} checked={osdVisible(el.pos)} onChange={() => void set(el.param.name, osdToggle(el.pos))} />
                <span>{t(TITLES[el.key] ?? el.key)}</span>
                <span className="mono dim">
                  {osdX(el.pos)},{osdY(el.pos)}
                </span>
              </label>
            ))}
          </div>
        </div>
        {armed && <p className="hint warn-text">{t("Коптер заармлен — раскладка не меняется.")}</p>}
        {!pal && hiddenNtsc.length > 0 && (
          <p className="hint warn-text">
            {t("На камере NTSC (13 строк) не видно: {list}. Поднимите их выше или переключитесь на PAL.", {
              list: hiddenNtsc.map((el) => t(TITLES[el.key] ?? el.key)).join(", "),
            })}
          </p>
        )}
        <p className="hint">{t("Значки нарисованы похожими знаками; в очках — шрифт Betaflight из чипа OSD. Режим PAL/NTSC плата выбирает по камере сама.")}</p>
      </div>
      <OsdMenuCard />
      <ParamList title={t("Статистика после посадки")} sub={t("После DISARM — пока не двинете газ или тангаж вверх (или минуту).")} params={stats} />
      <ParamList title={t("Предупреждения и тревоги")} sub={t("Одно главное предупреждение — в центре; значение за порогом мигает.")} params={warns} />
    </div>
  );
}
