// «Найти упавший» (P11) во вкладке «Безопасность»: готовность коптера к
// поиску (пищалка, маяк моторами, координаты в очках — кнопками) и
// последняя точка GPS из журнала EdgeTX на SD пульта или из файла скрипта
// OpenPlane на пульте (core/findLost.ts).

import { CircleCheck, CircleX, Copy, MapPin, Search } from "lucide-react";
import { useState } from "react";

import { api, errorText } from "../../api";
import { OSD_VISIBLE, osdPos, osdVisible } from "../../core/copterParams";
import { compassWord, coordText, findLost, findReadiness, mapLinks, newerPoint, parseLastGps, RADIO_LAST_GPS, type LostPoint } from "../../core/findLost";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { useCopterBoard, useCopterLink, useCopterLive } from "./common";

type Found = { sd: string; point: LostPoint | null; logs: number };

export function FindLostCard() {
  const board = useCopterBoard();
  const live = useCopterLive();
  const set = useApp((s) => s.copterSet);
  const toast = useApp((s) => s.toast);
  const { armed } = useCopterLink();
  const [busy, setBusy] = useState(false);
  const [cards, setCards] = useState<string[] | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const ready = findReadiness(board.params, board.pending);
  const value = (name: string, d: number) => Number(name in board.pending ? board.pending[name] : (board.params[name]?.value ?? d));
  const beaconOff = value("dshot_beacon_off_flags", 514);
  const beeperOff = value("beeper_off_flags", 0);
  const lat = value("osd_gps_lat_pos", 0);
  const lon = value("osd_gps_lon_pos", 0);

  async function read(sd: string) {
    const logs = (await api.radioReadLogs(sd)) ?? [];
    const file = await api.radioReadLastGps(sd).catch(() => null);
    setFound({ sd, point: newerPoint(findLost(logs), file ? parseLastGps(file) : null), logs: logs.length });
    setCards(null);
  }

  async function search() {
    setBusy(true);
    try {
      const sds = (await api.radioFindSd()) ?? [];
      if (sds.length === 1) await read(sds[0]);
      else {
        setCards(sds);
        setFound(null);
      }
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(sd: string) {
    setBusy(true);
    try {
      await read(sd);
    } catch (e) {
      toast("err", errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text).then(
      () => toast("ok", t("Координаты скопированы: {c}", { c: text })),
      () => toast("err", t("Не удалось скопировать")),
    );
  }

  function openMap(url: string) {
    api.openMap(url).catch((e) => toast("err", errorText(e)));
  }

  const showCoords = () => {
    // место из настройки (умолчание BF — слева сверху), только показать
    if (!osdVisible(lat)) void set("osd_gps_lat_pos", lat & 0x7ff ? lat | OSD_VISIBLE : osdPos(1, 3));
    if (!osdVisible(lon)) void set("osd_gps_lon_pos", lon & 0x7ff ? lon | OSD_VISIBLE : osdPos(1, 4));
  };

  const checks = [
    {
      ok: ready.beeper,
      title: t("Пищалка при потере связи (RX_LOST)"),
      fix: () => set("beeper_off_flags", beeperOff & ~2),
    },
    {
      ok: ready.beacon,
      title: t("Маяк моторами при потере связи — слышно в траве за десятки метров"),
      fix: board.header?.dshotCommands === false ? null : () => set("dshot_beacon_off_flags", beaconOff & ~2),
    },
    {
      ok: ready.osdCoords,
      title: t("Координаты в очках — останутся на записи DVR"),
      fix: showCoords,
    },
  ];

  const p = found?.point;
  const point = p ? coordText(p.last.lat, p.last.lon) : "";
  const liveLast = live?.gps?.last;

  return (
    <div className="card wide find-lost">
      <h3>
        <Search size={17} /> {t("Найти упавший")}
      </h3>
      <p className="sub">
        {t("Перевёрнутый в траве коптер обычно теряет GPS. Прошивка помнит последнюю точку с фиксом и шлёт её в пульт и в очки — по ней и ищем.")}
      </p>
      <ul className="find-checks">
        {checks.map((c) => (
          <li key={c.title} className={c.ok ? "ok" : "warn"}>
            {c.ok ? <CircleCheck size={15} color="var(--ok)" /> : <CircleX size={15} color="var(--warn)" />}
            <span>{c.title}</span>
            {!c.ok && c.fix && (
              <button className="btn small" disabled={armed} onClick={() => void c.fix?.()}>
                {t("Включить")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {liveLast && (
        <p className="hint warn-text">
          {t("Фикс GPS пропал — последняя точка: {c}", { c: coordText(liveLast[0], liveLast[1]) })}
        </p>
      )}
      <div className="find-radio">
        <button className="btn" disabled={busy} onClick={() => void search()}>
          <MapPin size={15} /> {t("Точка из журнала пульта")}
        </button>
        <span className="sub">
          {t("Пульт EdgeTX — по USB как накопитель; журнал пишет специальная функция «SD Logs».")}{" "}
          {t("Или скрипт OpenPlane на пульте: экран телеметрии oplan запоминает точку сам.")}
        </span>
      </div>
      {cards && cards.length === 0 && <p className="hint warn-text">{t("SD-карта пульта не найдена: включите пульт, подключите USB и выберите «USB-накопитель».")}</p>}
      {cards && cards.length > 1 && (
        <div className="find-cards">
          {cards.map((sd) => (
            <button key={sd} className="btn small" disabled={busy} onClick={() => void pick(sd)}>
              {sd}
            </button>
          ))}
        </div>
      )}
      {found && !p && (
        <p className="hint warn-text">
          {found.logs === 0
            ? t("На карте {sd} нет журналов. В EdgeTX: модель → «Специальные функции» → «SD Logs» на тумблер ARM, каждые 0.2–1 с. Тогда в следующий раз точка будет.", { sd: found.sd })
            : t("В журналах нет координат: нет колонки GPS. Найдите датчики заново на экране телеметрии пульта, когда GPS коптера видит спутники.")}
        </p>
      )}
      {p && (
        <div className="find-point">
          <div className="find-coords">
            <b>{point}</b>
            <button className="btn small ghost" onClick={() => copy(point)} title={t("Копировать")}>
              <Copy size={14} />
            </button>
          </div>
          <p className="sub">
            {p.log === RADIO_LAST_GPS ? t("скрипт OpenPlane на пульте") : p.log}, {p.last.time}
            {p.last.sats !== null && " · " + t("спутников: {n}", { n: p.last.sats })}
            {p.start && p.distanceM >= 5 && " · " + t("{m} м от взлёта на {dir}", { m: Math.round(p.distanceM), dir: t(compassWord(p.bearingDeg)) })}
          </p>
          {p.fixLost && (
            <p className="hint warn-text">
              {p.silentS > 0
                ? t("После этой точки GPS потерял фикс (ещё {s} с журнала) — коптер, скорее всего, лежит здесь, в пределах 5–10 м.", { s: Math.round(p.silentS) })
                : t("После этой точки GPS потерял фикс — коптер, скорее всего, лежит здесь, в пределах 5–10 м.")}
            </p>
          )}
          <div className="find-maps">
            {mapLinks(p.last.lat, p.last.lon).map((l) => (
              <button key={l.url} className="btn small" onClick={() => openMap(l.url)}>
                {t(l.name)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
