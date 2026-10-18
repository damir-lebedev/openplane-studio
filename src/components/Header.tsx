import { ChevronRight } from "lucide-react";

import { Device } from "../api";
import { t } from "../i18n";
import { PortInfo, useApp } from "../store";

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
  const setSection = useApp((s) => s.setSection);
  const devices = useApp((s) => s.devices);
  const ports = useApp((s) => s.ports);
  const status = boardStatus(devices, ports);

  return (
    <header className="header">
      <div className="header-title">
        OpenPlane <span>Studio</span>
      </div>
      <ChevronRight size={16} color="var(--text-3)" />
      {planes.length ? (
        <select
          className="select"
          value={currentId ?? ""}
          onChange={(e) => {
            selectPlane(e.target.value || null);
            setSection("board");
          }}
          title={t("Самолёт: все разделы показывают его")}
        >
          {!currentId && <option value="">{t("Выберите самолёт")}</option>}
          {planes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="muted">{t("Ангар пуст")}</span>
      )}
      <div className="header-spacer" />
      <div className={`pill ${status.level}`} title={status.title}>
        <span className="dot" />
        <span className="txt">{status.text}</span>
      </div>
    </header>
  );
}
