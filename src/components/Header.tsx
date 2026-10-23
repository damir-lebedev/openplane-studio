import { ChevronRight } from "lucide-react";

import { Device } from "../api";
import { t } from "../i18n";
import { PortInfo, useApp } from "../store";
import { useLive } from "./live/LiveWidgets";

interface BoardStatus {
  level: "none" | "ok" | "warn";
  text: string;
  title?: string;
}

export function boardStatus(devices: Device[], ports: Record<string, PortInfo>): BoardStatus {
  const dfu = devices.find((d) => d.kind === "stm32-dfu");
  const cdc = devices.find((d) => d.kind === "stm32-cdc");
  if (cdc?.port) {
    const info = ports[cdc.port];
    if (info?.busy) return { level: "warn", text: t("{port} занят монитором порта", { port: cdc.port }) };
    const id = info?.identity;
    if (id) {
      const plane = id.plane ? `«${id.plane}»` : t("без проекта");
      return {
        level: "ok",
        text: `${id.board} · ${cdc.port} · ${plane}`,
        title: t("Прошивка OpenPlane, коммит {commit}, конфигурация {config}{armed}", {
          commit: id.commit,
          config: id.config || "—",
          armed: id.armed ? t(", ЗААРМЛЕНО") : "",
        }),
      };
    }
    return { level: "warn", text: t("STM32 на {port}: прошивка не ответила", { port: cdc.port }) };
  }
  if (dfu) return { level: "warn", text: t("STM32 в режиме прошивки (DFU)") };
  const esp = devices.find((d) => d.kind === "usb-serial" || d.kind === "esp32-usb");
  if (esp?.port) return { level: "warn", text: `${esp.title} · ${esp.port}` };
  return { level: "none", text: t("Плата не подключена") };
}

export function Header() {
  const planes = useApp((s) => s.planes);
  const currentId = useApp((s) => s.currentId);
  const selectPlane = useApp((s) => s.selectPlane);
  const copters = useApp((s) => s.copters);
  const copterId = useApp((s) => s.copterId);
  const selectCopter = useApp((s) => s.selectCopter);
  const section = useApp((s) => s.section);
  const setSection = useApp((s) => s.setSection);
  const selected = section === "copter" ? copterId : currentId;
  const devices = useApp((s) => s.devices);
  const ports = useApp((s) => s.ports);
  const link = useApp((s) => s.link);
  const panel = useApp((s) => s.boardPanel);
  const setBoardPanel = useApp((s) => s.setBoardPanel);
  const live = useLive();
  const status = boardStatus(devices, ports);
  if (link.state === "error" && link.error?.startsWith("PORT_BUSY") && status.level !== "none") {
    status.level = "warn";
    status.text = t("{port} занят монитором порта", { port: link.port ?? "" });
  }

  return (
    <header className="header">
      <div className="header-title">
        OpenPlane <span>Studio</span>
      </div>
      <ChevronRight size={16} color="var(--text-3)" />
      {planes.length || copters.length ? (
        <select
          className="select"
          value={selected ?? ""}
          onChange={(e) => {
            const id = e.target.value || null;
            if (id && copters.some((c) => c.id === id)) {
              selectCopter(id);
              setSection("copter");
            } else {
              selectPlane(id);
              setSection("board");
            }
          }}
          title={t("Самолёт: все разделы показывают его")}
        >
          {!selected && <option value="">{t("Выберите самолёт")}</option>}
          {copters.length ? (
            <>
              <optgroup label={t("Самолёты")}>
                {planes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("Коптеры")}>
                {copters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </>
          ) : (
            planes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))
          )}
        </select>
      ) : (
        <span className="muted">{t("Ангар пуст")}</span>
      )}
      <div className="header-spacer" />
      <button
        className={`pill ${status.level}${panel ? " active" : ""}`}
        title={status.title ?? t("Плата: связь, живые данные, консоль")}
        onClick={() => setBoardPanel(!panel)}
      >
        <span className={`dot${live ? " live" : ""}`} />
        <span className="txt">{status.text}</span>
        {live && <span className="pill-mode">{live.mode}</span>}
        {live?.arm && <span className="pill-arm">ARM</span>}
      </button>
    </header>
  );
}
