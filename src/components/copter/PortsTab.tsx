// «Порты» (P63): что на каком UART полётника — приёмник, GPS, MSP для
// цифровых очков, телеметрия регуляторов, провод SmartAudio/Tramp. Каждый
// UART — карточка с ножками RX/TX и выбором роли; переназначение — без
// пересборки (настройки serial_*_uart), действует после «Сохранить» и
// перезагрузки. Внизу — те же строки `serial`, что в CLI Betaflight.

import { Copy } from "lucide-react";
import { useState } from "react";

import { assignCommands, boardUarts, BoardUart, movedRoles, PORT_ROLES, portMap, PortRole, ROLE_INFO, roleOn, roleProblem, serialLines } from "../../core/ports";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { NeedBoard, useCopterBoard, useCopterLink } from "./common";

export function PortsTab() {
  return (
    <NeedBoard>
      <PortsBody />
    </NeedBoard>
  );
}

function PortsBody() {
  const board = useCopterBoard();
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const [copied, setCopied] = useState(false);
  const uarts = boardUarts(board);
  const map = portMap(board);
  const moved = movedRoles(board);
  const errors = PORT_ROLES.map((r) => board.errors[ROLE_INFO[r].param]).filter(Boolean);

  if (uarts.length === 0) {
    return (
      <div className="copter-grid">
        <div className="card wide">
          <h3>{t("Порты")}</h3>
          <p className="sub">{t("Прошивка на плате не сообщает свои UART — обновите её: в новой прошивке порты меняются здесь, без пересборки.")}</p>
        </div>
      </div>
    );
  }

  const assign = async (u: BoardUart, role: PortRole | null) => {
    for (const [name, value] of assignCommands(map, u.n, role)) await set(name, value);
  };
  const lines = serialLines(board);
  const copy = () =>
    void navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  const unassigned = PORT_ROLES.filter((r) => map[r] === 0);

  return (
    <div className="copter-grid">
      <div className="card wide">
        <h3>{t("Что на каком UART")}</h3>
        <p className="sub">
          {t("Подключили приёмник, GPS или очки к другому UART — выберите его здесь, перепаивать и пересобирать не нужно. Новое действует после «Сохранить» и перезагрузки платы (переткнуть USB или батарею).")}
        </p>
        {errors.map((e) => (
          <p key={e} className="hint warn-text">
            {e}
          </p>
        ))}
        <div className="ports-grid">
          {uarts.map((u) => {
            const role = roleOn(map, u.n);
            return (
              <div key={u.n} className={`port-card${role ? " used" : ""}`} data-param={role ? ROLE_INFO[role].param : undefined}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>UART{u.n}</b>
                  <span className="port-pins">
                    <span className={`port-pin${u.rx ? "" : " off"}`} title={u.rx ? t("ножка RX разведена") : t("ножки RX нет")}>
                      RX
                    </span>
                    <span className={`port-pin${u.tx ? "" : " off"}`} title={u.tx ? t("ножка TX разведена") : t("ножки TX нет")}>
                      TX
                    </span>
                  </span>
                </div>
                <select className="select" disabled={armed} value={role ?? ""} onChange={(e) => void assign(u, (e.target.value || null) as PortRole | null)}>
                  <option value="">{t("— свободен —")}</option>
                  {PORT_ROLES.map((r) => {
                    const why = roleProblem(u, r);
                    return (
                      <option key={r} value={r} disabled={!!why}>
                        {t(ROLE_INFO[r].title)}
                        {why ? ` (${t(why)})` : map[r] && map[r] !== u.n ? ` ← UART${map[r]}` : ""}
                      </option>
                    );
                  })}
                </select>
                <p className="hint">{role ? t(ROLE_INFO[role].hint) : t("ничего не подключено")}</p>
              </div>
            );
          })}
        </div>
        {unassigned.length > 0 && (
          <p className="hint">
            {t("Не назначены:")} {unassigned.map((r) => t(ROLE_INFO[r].title)).join(", ")}
          </p>
        )}
        {moved.length > 0 && (
          <p className="hint">
            {t("Не как в прошивке платы:")} {moved.map((r) => t(ROLE_INFO[r].title)).join(", ")}
          </p>
        )}
      </div>
      <div className="card wide">
        <h3>{t("Как в Betaflight")}</h3>
        <p className="sub">{t("Те же строки понимает CLI: «serial» из diff Betaflight этой платы можно вставить как есть. Номер 0 — UART1; 64 — приёмник, 2 — GPS, 1 — MSP, 1024 — телеметрия ESC, 2048 — SmartAudio, 8192 — Tramp.")}</p>
        <pre className="mono port-lines">{lines.join("\n")}</pre>
        <button className="btn ghost small" onClick={copy}>
          <Copy size={14} />
          {copied ? t("Скопировано") : t("Скопировать")}
        </button>
      </div>
    </div>
  );
}
