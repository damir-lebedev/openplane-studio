// Разбор журнала в фоне: час полёта — десятки МБ, окно не должно замирать.

import { decodeFlight, Flight } from "./blackbox";

self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const flight = decodeFlight(new Uint8Array(e.data));
    const transfer: ArrayBuffer[] = [];
    for (const s of Object.values(flight.series)) {
      transfer.push(s.t.buffer as ArrayBuffer);
      for (const c of Object.values(s.cols)) transfer.push(c.buffer as ArrayBuffer);
    }
    (self as unknown as Worker).postMessage({ flight }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String(err) });
  }
};

export type WorkerReply = { flight: Flight } | { error: string };
