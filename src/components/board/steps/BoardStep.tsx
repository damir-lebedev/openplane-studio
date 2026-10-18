import { Cpu, Usb } from "lucide-react";

import { findBoard, ManifestBoard } from "../../../core/manifest";
import { pinRole, pinTable } from "../../../core/pins";
import { N_, t } from "../../../i18n";
import { useApp } from "../../../store";
import { Choice, Section, StepHead } from "../../ui";
import { ParamEditor } from "../ParamField";

const PIN_ROLE_TEXT: Record<string, string> = {
  pwm: N_("ШИМ — серво или ESC"),
  uart_rx: N_("приём UART"),
  uart_tx: N_("передача UART"),
  i2c_sda: N_("I2C, данные"),
  i2c_scl: N_("I2C, такт"),
  spi_sck: N_("SPI, такт"),
  spi_miso: N_("SPI, приём"),
  spi_mosi: N_("SPI, передача"),
  adc: N_("аналоговый вход"),
  gpio: N_("цифровой выход"),
};

function boardDesc(b: ManifestBoard): string {
  const chip = b.macro?.includes("STM32") ? "STM32H743" : b.macro?.replace("BOARD_", "").replace("_", "-") ?? "";
  const upload = b.uploadProtocol === "dfu" ? t("прошивка по USB (DFU)") : t("прошивка по USB");
  return `${chip} · ${upload}`;
}

export function BoardBadges({ b }: { b: ManifestBoard }) {
  return (
    <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {b.blackbox !== "none" ? (
        <span className="badge ok">{b.blackbox === "sd" ? t("ящик на SD") : t("ящик во флеше")}</span>
      ) : (
        <span className="badge">{t("без ящика")}</span>
      )}
      <span className="badge">{b.telemetry === "mavlink" ? "MAVLink" : t("Wi-Fi дашборд")}</span>
      {!b.outputs.rudder && <span className="badge warn">{t("нет руля напр.")}</span>}
      {!b.outputs.aux1 && <span className="badge warn">{t("нет AUX")}</span>}
    </div>
  );
}

export function BoardStep() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const devices = useApp((s) => s.devices);
  const ports = useApp((s) => s.ports);
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const setBoardTab = useApp((s) => s.setBoardTab);
  const setFocus = useApp((s) => s.setFocus);
  const board = findBoard(manifest, plane.board);

  const connected = new Set<string>();
  for (const d of devices) {
    const id = d.port ? ports[d.port]?.identity : null;
    if (id?.board) connected.add(id.board);
    if (d.kind === "stm32-dfu" || d.kind === "stm32-cdc") {
      manifest.boards.filter((b) => b.macro === "BOARD_STM32H743").forEach((b) => connected.add(`family:${b.env}`));
    }
  }
  const pins = board ? manifest.params.filter((p) => p.board === board.macro && p.kind === "pin") : [];

  return (
    <>
      <StepHead title={t("Плата")}>
        {t("На чём летит самолёт. От платы зависят пины, есть ли чёрный ящик и как самолёт говорит с землёй.")}
      </StepHead>
      <Section title={t("Плата полётника")}>
        <div className="choices wide" onMouseEnter={() => setFocus(["board"])} onMouseLeave={() => setFocus([])}>
          {manifest.boards.map((b) => {
            const isConnected = connected.has(b.env);
            const sameFamily = !isConnected && connected.has(`family:${b.env}`);
            return (
              <Choice
                key={b.env}
                icon={<Cpu size={16} color="var(--accent)" />}
                title={t(b.title).charAt(0).toUpperCase() + t(b.title).slice(1)}
                desc={boardDesc(b)}
                selected={plane.board === b.env}
                onClick={() => updatePlane((p) => (p.board = b.env))}
                badge={
                  <>
                    <BoardBadges b={b} />
                    {(isConnected || sameFamily) && (
                      <div className="row" style={{ marginTop: 8 }}>
                        <span className="badge accent">
                          <Usb size={12} /> {isConnected ? t("подключена") : t("подключена такая же плата")}
                        </span>
                      </div>
                    )}
                  </>
                }
              />
            );
          })}
        </div>
      </Section>
      {board && (
        <Section
          title={t("Пины этой платы")}
          sub={
            pinTable(board.env)
              ? t("как в Config.h; в списке — только пины, что умеют нужное ({mcu})", { mcu: pinTable(board.env)!.mcu })
              : t("как в Config.h — менять не нужно, если плата разведена по документации")
          }
        >
          <div className="card" style={{ padding: 0 }}>
            <table className="table pins-table">
              <tbody>
                {pins.map((p) => (
                  <tr key={p.name}>
                    <td className="mono" style={{ width: 200 }}>
                      {p.name}
                      {pinRole(p.name) && <div className="hint pin-role">{t(PIN_ROLE_TEXT[pinRole(p.name)!])}</div>}
                    </td>
                    <td style={{ width: 300 }}>
                      <ParamEditor name={p.name} />
                    </td>
                    <td className="hint">{p.note ? t(p.note) : t(p.doc).split("\n")[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            {t("Всё сразу — в таблице «Все параметры» полного режима.")}{" "}
            <button
              className="link"
              onClick={() => {
                if (mode !== "full") setMode("full");
                setBoardTab("params");
              }}
            >
              {t("Открыть таблицу")}
            </button>
          </p>
        </Section>
      )}
    </>
  );
}
