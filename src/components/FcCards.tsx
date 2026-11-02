// Что за полётник на USB (P02): карточкой в «Ангаре» — прошивка, плата в
// нашей базе и что с ним делать дальше; «что нашлось на борту» по дампу
// родной прошивки — на вкладке «Коптер».

import { CircleCheck, CircleHelp, Cpu, Plus, Usb } from "lucide-react";

import { copterEnvs } from "../core/copter";
import { detectFcs, FcDetected, OnBoard } from "../core/detect";
import { t } from "../i18n";
import { useApp } from "../store";

const uart = (n: number | undefined) => (n ? `UART${n}` : "");
const join = (...parts: (string | number | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** Строки «что на борту»: что это — что нашлось (пусто — не нашлось или BF не сказал). */
export function onBoardRows(b: OnBoard): [string, string][] {
  const escText = b.esc
    ? join(b.esc.protocol, b.esc.bidir && t("двунаправленный"), b.esc.telemetryUart && t("телеметрия {uart}", { uart: uart(b.esc.telemetryUart) }))
    : "";
  return [
    [t("Процессор"), b.mcu ?? ""],
    [t("Гироскоп"), b.gyro ?? ""],
    [t("Акселерометр"), b.acc && b.acc !== b.gyro ? b.acc : b.acc ? t("в гироскопе") : ""],
    [t("Барометр"), b.baro ?? ""],
    [t("Компас"), b.mag ?? ""],
    [t("Экран OSD"), b.osd ?? ""],
    [t("Чёрный ящик"), b.storage ?? ""],
    [t("Приёмник"), b.rx ? join(b.rx.protocol ?? t("протокол по умолчанию"), uart(b.rx.uart)) : ""],
    ["GPS", b.gps ? join(b.gps.provider, uart(b.gps.uart)) : ""],
    [t("Видеопередатчик"), b.vtx ? join(b.vtx.protocol, uart(b.vtx.uart)) : ""],
    [t("Регуляторы"), escText],
  ];
}

export function OnBoardList({ board }: { board: OnBoard }) {
  return (
    <div className="onboard">
      {onBoardRows(board).map(([what, found]) => (
        <div key={what} className={found ? "onboard-item" : "onboard-item none"}>
          {found ? <CircleCheck size={14} color="var(--ok)" /> : <CircleHelp size={14} />}
          <span className="what">{what}</span>
          <span className="mono">{found || t("не нашлось")}</span>
        </div>
      ))}
      <p className="hint" style={{ gridColumn: "1 / -1", margin: "4px 0 0" }}>
        {t("Прошивку регуляторов (BLHeli_S, Bluejay, AM32) покажем, когда появится связь с ними через полётник.")}
      </p>
    </div>
  );
}

function vehicleText(f: FcDetected): string {
  if (f.vehicle === "plane") return t("самолёт");
  if (f.vehicle === "copter") return t("коптер");
  if (f.vehicle === "vtol") return "VTOL";
  return "";
}

/** Что сказать про полётник и что предложить. */
function FcRow({ f, onNewPlane }: { f: FcDetected; onNewPlane: () => void }) {
  const copters = useApp((s) => s.copters);
  const createCopter = useApp((s) => s.createCopter);
  const updateCopter = useApp((s) => s.updateCopter);
  const selectCopter = useApp((s) => s.selectCopter);
  const setSection = useApp((s) => s.setSection);
  const existing = f.board ? copters.find((c) => c.boardDump?.bfBoard === f.board || (f.env && c.board === f.env.env && !c.lastFlash)) : undefined;

  const newCopter = () => {
    const c = createCopter("blank", f.board ? t("Коптер на {board}", { board: f.board }) : t("Новый коптер"));
    if (f.env) updateCopter(c.id, (x) => (x.board = f.env!.env));
  };
  const open = (id: string) => {
    selectCopter(id);
    setSection("copter");
  };

  let text: string;
  let action: { label: string; run: () => void } | null = null;
  if (f.firmware === "dfu") {
    text = t("Плата в режиме прошивки. Откройте её проект и нажмите «Прошить» — или выньте и вставьте USB, чтобы она загрузилась как обычно.");
  } else if (f.firmware === "betaflight" || f.firmware === "inav") {
    text = f.env
      ? t("Эта плата есть в нашей базе. При переходе приложение сохранит родную прошивку и её настройки, перенесёт то, что понимает, и покажет, что настроить заново.")
      : t("Этой платы в базе пока нет: распиновку приложение снимет с самой платы, если процессор F405 или H743.");
    action = existing ? { label: t("Открыть «{name}»", { name: existing.name }), run: () => open(existing.id) } : { label: t("Коптер с этой платой"), run: newCopter };
  } else if (f.firmware === "ardupilot" || f.firmware === "px4") {
    text = t("Перенос параметров {fw} — позже; пока нашу прошивку можно залить из проекта, а настройки сделать в мастере. Родную прошивку перед заливкой сохраните сами.", { fw: f.name });
    action = f.vehicle === "plane" ? { label: t("Новый самолёт"), run: onNewPlane } : { label: t("Коптер с этой платой"), run: newCopter };
  } else {
    text = f.vehicle === "copter" ? t("Наша прошивка коптера, а проекта для неё в ангаре нет.") : t("Наша прошивка, а проекта для неё в ангаре нет.");
    if (f.vehicle === "copter") action = { label: t("Создать проект"), run: newCopter };
  }

  return (
    <div className="issue info fc-row">
      {f.firmware === "dfu" ? <Cpu size={18} /> : <Usb size={18} color="var(--accent)" />}
      <div className="grow">
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <b>{join(t(f.name), f.version)}</b>
          {f.board && <span className="badge">{f.board}</span>}
          {vehicleText(f) && <span className="badge">{vehicleText(f)}</span>}
          {f.env ? <span className="badge ok">{t("в базе: {env}", { env: t(f.env.title) })}</span> : f.firmware !== "dfu" && f.firmware !== "openplane" && <span className="badge warn">{t("платы нет в базе")}</span>}
          <span className="hint">{f.port ?? "USB"}</span>
        </div>
        <p className="sub" style={{ margin: "4px 0 0" }}>{text}</p>
      </div>
      {action && (
        <button className="btn primary small" onClick={action.run}>
          <Plus size={14} />
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Полётники на USB, у которых нет проекта в ангаре: что это и что дальше. */
export function ConnectedFcs({ onNewPlane }: { onNewPlane: () => void }) {
  const devices = useApp((s) => s.devices);
  const ports = useApp((s) => s.ports);
  const fc = useApp((s) => s.fc);
  const manifest = useApp((s) => s.manifest);
  const planes = useApp((s) => s.planes);
  const copters = useApp((s) => s.copters);
  const found = detectFcs(devices, ports, fc, copterEnvs(manifest)).filter((f) => {
    if (f.firmware === "unknown") return false;   // ещё спрашиваем или чужой порт
    if (f.firmware !== "openplane") return true;
    const id = f.identity!;
    const known = [...planes, ...copters].some((p) => (id.config && p.lastFlash?.configHash === id.config) || (id.plane && p.name === id.plane));
    return !known;
  });
  if (!found.length) return null;
  return (
    <div className="fc-found">
      <h3>{t("Подключено по USB")}</h3>
      {found.map((f) => (
        <FcRow key={f.port ?? f.device.serial ?? "dfu"} f={f} onNewPlane={onNewPlane} />
      ))}
    </div>
  );
}
