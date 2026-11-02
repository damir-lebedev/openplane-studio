// @vitest-environment jsdom
// «Подключено по USB» в ангаре: что за полётник и что с ним делать (P02);
// «что нашлось на борту» по дампу Betaflight.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Device } from "../../api";
import manifestJson from "../../core/__fixtures__/manifest.json";
import type { Manifest } from "../../core/manifest";
import { parseBoardDump } from "../../core/detect";

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const api = new Proxy({}, { get: () => () => Promise.resolve(undefined) });
  return { ...real, api, inTauri: () => false };
});

const { useApp } = await import("../../store");
const { ConnectedFcs, OnBoardList } = await import("../FcCards");

const manifest = manifestJson as unknown as Manifest;
const dev = (port: string | null, kind: Device["kind"] = "stm32-cdc"): Device => ({ kind, port, vid: 0x0483, pid: 0x5740, product: null, manufacturer: null, serial: null, title: "" });

afterEach(() => {
  cleanup();
  useApp.setState({ devices: [], ports: {}, fc: {}, copters: [], planes: [] });
});

describe("подключено по USB", () => {
  it("Betaflight с платой из базы: кнопка создаёт коптер с этой платой", () => {
    useApp.setState({ manifest, devices: [dev("COM4")], fc: { COM4: { variant: "BTFL", version: "4.5.1", board: "GETFUNF405V3" } }, copters: [], planes: [] });
    render(<ConnectedFcs onNewPlane={() => {}} />);
    expect(screen.getByText("Betaflight · 4.5.1")).toBeTruthy();
    expect(screen.getByText(/Эта плата есть в нашей базе/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Коптер с этой платой/ }));
    const c = useApp.getState().copters[0];
    expect(c.board).toBe("getfun-f405v3-quad");
    expect(c.name).toBe("Коптер на GETFUNF405V3");
  });

  it("ArduPilot на самолёте — «Новый самолёт»; DFU — подсказка; молчащий порт не показан", () => {
    const onNewPlane = vi.fn();
    useApp.setState({ manifest, devices: [dev("COM5", "fc-usb"), dev(null, "stm32-dfu"), dev("COM9")], fc: { COM5: { variant: "ARDU", vehicle: 1 } } });
    render(<ConnectedFcs onNewPlane={onNewPlane} />);
    expect(screen.getByText("самолёт")).toBeTruthy();
    expect(screen.getByText("платы нет в базе")).toBeTruthy();
    expect(screen.getByText(/Плата в режиме прошивки/)).toBeTruthy();
    expect(screen.queryByText("COM9")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Новый самолёт/ }));
    expect(onNewPlane).toHaveBeenCalled();
  });

  it("наша прошивка с проектом в ангаре — карточки нет", () => {
    useApp.setState({
      manifest,
      devices: [dev("COM7")],
      ports: { COM7: { identity: { fw: "openplane", proto: 3, board: "matek-h743-quad", commit: "abc", config: "h1", plane: "", armed: false, vehicle: "copter" }, at: 0 } },
      copters: [{ id: "c1", name: "7", lastFlash: { at: "", board: "matek-h743-quad", commit: "abc", configHash: "h1", ok: true } } as never],
    });
    const { container } = render(<ConnectedFcs onNewPlane={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("что на борту: нашлось — значением, не нашлось — так и сказано", () => {
    const b = parseBoardDump("GYRO=ICM42688P, ACC=ICM42688P, BARO=NONE\nset serialrx_provider = CRSF\nserial 1 64 115200 57600 0 115200\n");
    render(<OnBoardList board={b} />);
    expect(screen.getByText("ICM42688P")).toBeTruthy();
    expect(screen.getByText("в гироскопе")).toBeTruthy();
    expect(screen.getByText("CRSF · UART2")).toBeTruthy();
    expect(screen.getAllByText("не нашлось").length).toBeGreaterThan(3);
  });
});
