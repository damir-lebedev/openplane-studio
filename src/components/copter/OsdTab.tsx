// Вкладка «OSD»: экран очков — аналоговый 30 × 16 (PAL) или 13 (NTSC) строк
// либо большой экран цифровых очков (MSP DisplayPort: DJI, Walksnail, HDZero —
// до 60 × 22). Элементы перетаскиваются мышью, галочка показывает или прячет.
// Позиции — настройки BF osd_*_pos (прошивка: copter/Osd.h), поэтому diff из
// Betaflight переносится как есть. С платы идут живые значения — на экране то,
// что увидит пилот. Сверху — куда выводить (чип на плате или очки по проводу).

import { Check, RotateCcw, Wand2 } from "lucide-react";
import { PointerEvent as ReactPointerEvent, useRef, useState } from "react";

import { CopterLive } from "../../api";
import { osdElements, OsdElementParam, osdMove, osdToggle, osdVisible, osdX, osdY, tabParams } from "../../core/copterParams";
import { OSD_SYSTEMS, osdCanvasNow, OsdLinkNote, osdLinkNotes, osdOutputSupported, osdOutside, osdRemapAll, osdRemapOffer, osdSystemOf, osdSystemSettings } from "../../core/osdCanvas";
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

// Значки шрифта BF — похожими знаками (клетка — один символ, как в чипе); U+0001 в начале — значок, рисуется цветом.
const S = "\u0001";
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

// ---- куда выводить ----

const NOTES: Record<OsdLinkNote, { text: string; warn?: boolean }> = {
  chip: { text: N_("Чип OSD на плате работает — рисуем в него.") },
  "no-port": { text: N_("На этой плате нет свободного UART под очки — цифровой OSD подключить некуда."), warn: true },
  goggles: { text: N_("Очки на связи: экран {c} × {r} — размер взят из настроек.") },
  "goggles-own-size": { text: N_("Очки на связи: экран {c} × {r} — размер они сообщили сами.") },
  silent: { text: N_("OSD уходит в порт, но оттуда никто не спрашивает. Нет картинки в очках — проверьте провод TX платы → RX передатчика."), warn: true },
  waiting: { text: N_("Ждём очки: как только они начнут опрашивать полётник, OSD пойдёт и к ним. Некоторым нужен явный выбор — нажмите свою систему выше.") },
  vtx: { text: N_("Видеопередатчик берёт канал и мощность у полётника — VTX Admin с пульта меняет его сразу.") },
};

/** Схема проводов: что с чем соединить, чтобы OSD дошёл до очков. */
function OsdWiring({ digital }: { digital: boolean }) {
  const box = { fill: "var(--panel-2)", stroke: "var(--line-2)", rx: 8 };
  const label = { fill: "var(--text)", fontSize: 12, fontWeight: 600 };
  const small = { fill: "var(--text-2)", fontSize: 10.5 };
  const pin = { fill: "var(--accent)", fontSize: 10.5, fontWeight: 700 };
  return (
    <svg className="osd-wiring" viewBox="0 0 640 112" role="img" aria-label={t("Схема подключения")} data-testid={digital ? "osd-wiring-digital" : "osd-wiring-analog"}>
      <defs>
        <marker id="osd-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--accent)" />
        </marker>
      </defs>
      {digital ? (
        <>
          <rect x="6" y="14" width="176" height="84" {...box} />
          <text x="20" y="38" {...label}>{t("Полётник")}</text>
          <text x="20" y="56" {...small}>UART «MSP»</text>
          <text x="20" y="72" {...small}>115200</text>
          <text x="156" y="50" {...pin}>TX</text>
          <text x="156" y="80" {...pin}>RX</text>
          <line x1="182" y1="46" x2="306" y2="46" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#osd-arrow)" />
          <line x1="184" y1="76" x2="308" y2="76" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" markerStart="url(#osd-arrow)" />
          <text x="245" y="38" textAnchor="middle" {...small}>{t("экран OSD")}</text>
          <text x="245" y="94" textAnchor="middle" {...small}>{t("опрос: ARM, батарея")}</text>
          <rect x="308" y="14" width="176" height="84" {...box} />
          <text x="314" y="50" {...pin}>RX</text>
          <text x="314" y="80" {...pin}>TX</text>
          <text x="340" y="38" {...label}>{t("Видеопередатчик")}</text>
          <text x="340" y="56" {...small}>DJI · Walksnail · HDZero</text>
          <text x="340" y="80" {...small}>{t("рисует OSD в картинку")}</text>
        </>
      ) : (
        <>
          <rect x="6" y="30" width="84" height="52" {...box} />
          <text x="48" y="60" textAnchor="middle" {...label}>{t("Камера")}</text>
          <line x1="90" y1="56" x2="126" y2="56" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#osd-arrow)" />
          <rect x="128" y="14" width="176" height="84" {...box} />
          <text x="142" y="38" {...label}>{t("Полётник")}</text>
          <text x="142" y="56" {...small}>{t("чип OSD (AT7456E)")}</text>
          <text x="142" y="80" {...small}>{t("рисует поверх картинки")}</text>
          <line x1="304" y1="56" x2="340" y2="56" stroke="var(--accent)" strokeWidth="2" markerEnd="url(#osd-arrow)" />
          <rect x="342" y="30" width="142" height="52" {...box} />
          <text x="413" y="60" textAnchor="middle" {...label}>{t("Видеопередатчик")}</text>
        </>
      )}
      {[0, 1, 2].map((i) => (
        <path key={i} d={`M${498 + i * 12} ${40 - i * 6} q 12 ${16 + i * 6} 0 ${32 + i * 12}`} fill="none" stroke="var(--text-2)" strokeWidth="1.6" opacity={0.9 - i * 0.22} />
      ))}
      <rect x="548" y="30" width="86" height="52" {...box} />
      <text x="591" y="60" textAnchor="middle" {...label}>{t("Очки")}</text>
    </svg>
  );
}

function OsdOutputCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  if (!osdOutputSupported(board)) return null;
  const current = osdSystemOf(board);
  const device = String(board.pending.osd_displayport_device ?? board.params.osd_displayport_device.value);
  const digital = current ? current.device === "MSP" : device === "MSP";
  const notes = osdLinkNotes(live, device);
  const choose = (id: string) => {
    const system = OSD_SYSTEMS.find((s) => s.id === id);
    if (!system || armed) return;
    for (const c of osdSystemSettings(board, system)) void set(c.name, c.value);
  };
  return (
    <div className="card wide" data-testid="osd-output-card">
      <h3>{t("Куда выводить OSD")}</h3>
      <p className="sub">{t("Аналоговое видео — надписи рисует чип на плате. Цифровые очки рисуют сами: полётник шлёт им экран по проводу (MSP DisplayPort).")}</p>
      <div className="choices wide">
        {OSD_SYSTEMS.map((s) => (
          <button key={s.id} className={`choice${current?.id === s.id ? " selected" : ""}${armed ? " disabled" : ""}`} disabled={armed} onClick={() => choose(s.id)}>
            <div className="choice-title">{t(s.title)}</div>
            <div className="choice-desc">{t(s.note)}</div>
            {current?.id === s.id && <Check size={16} className="choice-check" />}
          </button>
        ))}
      </div>
      {!current && <p className="hint">{t("Сейчас выставлено своё сочетание настроек — оно ниже, в «Вывод: тонкая настройка».")}</p>}
      <OsdWiring digital={digital || current?.id === "auto"} />
      {(digital || current?.id === "auto") && (
        <p className="hint">
          {t("Два провода: TX платы → RX передатчика и RX платы ← TX передатчика, скорость 115200. На плате это UART, который в Betaflight отдан под MSP (на готовых полётниках — разъём цифрового передатчика). Для одной картинки хватит и провода TX → RX — тогда выберите свою систему явно.")}
        </p>
      )}
      {notes.map((n) => (
        <p key={n} className={`hint${NOTES[n].warn ? " warn-text" : ""}`} data-note={n}>
          {t(NOTES[n].text, { c: live?.osd?.c ?? 0, r: live?.osd?.r ?? 0 })}
        </p>
      ))}
    </div>
  );
}

// ---- экран ----

function OsdBody() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const [pal, setPal] = useState(true);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const screen = useRef<HTMLDivElement>(null);
  const now = osdCanvasNow(board, live, pal);
  const { cols, rows } = now.canvas;
  const elements = osdElements(board);
  const craft = String(board.params.craft_name?.value ?? "");
  const all = tabParams(board, "osd");
  const stats = all.filter((p) => p.name.startsWith("osd_stat_"));
  const warns = all.filter((p) => p.name.startsWith("osd_warn_") || p.name.endsWith("_alarm"));
  const output = all.filter((p) => ["osd_displayport_device", "vcd_video_system", "osd_canvas_width", "osd_canvas_height", "displayport_msp_col_adjust", "displayport_msp_row_adjust", "osd_framerate_hz"].includes(p.name));
  const width = (key: string) => cells(key, live, craft).length;

  const cellAt = (e: ReactPointerEvent) => {
    const r = screen.current!.getBoundingClientRect();
    return { cx: Math.floor(((e.clientX - r.left) / r.width) * cols), cy: Math.floor(((e.clientY - r.top) / r.height) * rows) };
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
    const x = Math.max(0, Math.min(cols - width(drag.key), cx - drag.dx));
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
  const outside = osdOutside(elements, width, now.canvas);
  // раскладка сделана под другой экран (обычно — аналоговая на большом экране очков)
  const madeFor = armed ? null : osdRemapOffer(elements, width, now.canvas);
  const remap = () => {
    if (!madeFor) return;
    for (const c of osdRemapAll(elements, width, madeFor, now.canvas)) void set(c.name, c.value);
  };
  const SOURCE: Record<typeof now.source, string> = {
    device: N_("размер сообщили очки"),
    settings: N_("размер из настроек"),
    camera: N_("PAL или NTSC — по камере"),
    manual: "",
  };

  return (
    <div className="copter-grid">
      <OsdOutputCard />
      <div className="card wide">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3>{t("Экран в очках")}</h3>
            <p className="sub">{t("Перетащите элемент мышью — он встанет туда же в очках. Галочка справа показывает или прячет.")}</p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            {now.source === "manual" ? (
              <div className="seg">
                <button className={pal ? "on" : ""} onClick={() => setPal(true)}>
                  PAL
                </button>
                <button className={!pal ? "on" : ""} onClick={() => setPal(false)}>
                  NTSC
                </button>
              </div>
            ) : (
              <span className="hint" data-testid="osd-canvas-size">
                {t("Экран {c} × {r}", { c: cols, r: rows })} · {t(SOURCE[now.source])}
              </span>
            )}
            <button className="btn ghost" disabled={armed} onClick={resetAll} title={t("Расставить элементы как в Betaflight по умолчанию")}>
              <RotateCcw size={14} /> {t("По умолчанию")}
            </button>
          </div>
        </div>
        {madeFor && (
          <div className="row osd-offer" style={{ gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <span className="hint warn-text">
              {t("Раскладка сделана под экран {a} × {b}, а сейчас экран {c} × {r}.", { a: madeFor.cols, b: madeFor.rows, c: cols, r: rows })}
            </span>
            <button className="btn small" onClick={remap} title={t("Что стояло у края — останется у края, что в центре — в центре")}>
              <Wand2 size={14} /> {t("Разложить по экрану")}
            </button>
          </div>
        )}
        <div className="osd-layout">
          <div
            ref={screen}
            className={`osd-screen${armed ? " locked" : ""}`}
            style={{ aspectRatio: `${cols * 12} / ${rows * 18}`, ["--rows" as string]: rows, ["--cols" as string]: cols }}
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
                if (y >= rows || x >= cols) return null;
                const c = cells(el.key, live, craft);
                return (
                  <div
                    key={el.key}
                    className={`osd-el${dragging ? " dragging" : ""}${selected === el.key ? " sel" : ""}`}
                    style={{ left: `${(x / cols) * 100}%`, top: `${(y / rows) * 100}%`, width: `${(c.length / cols) * 100}%`, height: `${100 / rows}%` }}
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
        {outside.length > 0 &&
          (now.source === "manual" && !pal ? (
            <p className="hint warn-text">
              {t("На камере NTSC (13 строк) не видно: {list}. Поднимите их выше или переключитесь на PAL.", {
                list: outside.map((el) => t(TITLES[el.key] ?? el.key)).join(", "),
              })}
            </p>
          ) : (
            <p className="hint warn-text">
              {t("За краем экрана {c} × {r} не видно: {list}.", { c: cols, r: rows, list: outside.map((el) => t(TITLES[el.key] ?? el.key)).join(", ") })}
            </p>
          ))}
        <p className="hint">
          {now.canvas.hd
            ? t("Значки нарисованы похожими знаками; в цифровых очках — шрифт Betaflight, который лежит в самих очках.")
            : t("Значки нарисованы похожими знаками; в очках — шрифт Betaflight из чипа OSD. Режим PAL/NTSC плата выбирает по камере сама.")}
        </p>
      </div>
      <OsdMenuCard />
      <ParamList title={t("Статистика после посадки")} sub={t("После DISARM — пока не двинете газ или тангаж вверх (или минуту).")} params={stats} />
      <ParamList title={t("Предупреждения и тревоги")} sub={t("Одно главное предупреждение — в центре; значение за порогом мигает.")} params={warns} />
      <ParamList title={t("Вывод: тонкая настройка")} sub={t("То же, что выбирают кнопки сверху, и сдвиг картинки, если край экрана в очках обрезан.")} params={output} />
    </div>
  );
}
