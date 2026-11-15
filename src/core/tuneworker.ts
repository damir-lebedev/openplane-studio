// Измерение и автонастройка по журналу — в фоне: спектры, подгонка модели и
// перебор настройки занимают секунды, окно не должно замирать.

import { analyze, ChirpSeries, TuneReport } from "./chirptune";

export interface TuneRequest {
  series: ChirpSeries | null;
  info: Record<string, string>;
}

export type TuneReply = { report: TuneReport } | { error: string };

self.onmessage = (e: MessageEvent<TuneRequest>) => {
  try {
    (self as unknown as Worker).postMessage({ report: analyze(e.data.series, e.data.info) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ error: String(err) });
  }
};
