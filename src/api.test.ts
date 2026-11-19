import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { api } from "./api";

describe("api.flashBin (телефон, USB-OTG)", () => {
  beforeEach(() => invoke.mockReset().mockResolvedValue({ chip: "h743", bytes: 4, seconds: 1 }));

  it("образ уходит телом запроса, порт и чип — заголовками", async () => {
    const image = new Uint8Array([1, 2, 3, 4]);
    await api.flashBin(image, "usb:/dev/bus/usb/001/002", "h743");
    expect(invoke).toHaveBeenCalledWith("firmware_flash_bin", image, {
      headers: { port: "usb:/dev/bus/usb/001/002", chip: "h743" },
    });
  });

  it("плата уже в DFU — пустой порт, чип не проверяем", async () => {
    await api.flashBin(new Uint8Array([9]), null);
    expect(invoke.mock.calls[0][2]).toEqual({ headers: { port: "", chip: "" } });
  });
});
