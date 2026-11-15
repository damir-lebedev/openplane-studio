// @vitest-environment jsdom
// «Измерение и автонастройка»: отчёт по журналу с chirp на экране — таблица
// «было → стало», графики осей, кнопка «применить» и слова про то, чего в
// журнале не хватило.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SYN, synthetic } from "../../core/__fixtures__/chirpSynthetic";
import { analyze, ChirpSeries, TuneReport } from "../../core/chirptune";
import { AxisCard, Summary } from "../copter/AutotuneTab";

vi.mock("../../api", async (orig) => {
  const real = await orig<typeof import("../../api")>();
  const api = new Proxy({}, { get: () => () => Promise.resolve([]) });
  return { ...real, api, inTauri: () => false };
});

const INFO: Record<string, string> = {
  loop_hz: "1000",
  "pid.roll": "25 49 0 0",
  "pid.pitch": "25 49 0 0",
  "pid.yaw": "25 20 0 0",
  "pid.dmax": "0 0 0",
  "rates.roll": "180 720 0.50",
  "rates.pitch": "180 720 0.50",
  "rates.yaw": "160 600 0.40",
  "filter.dterm": "0 110 0 0 0 0 0 0",
  "tune.level_gain": "8.00",
};

function log(axes: number[]): ChirpSeries {
  const s = { t: [] as number[], excite: [] as number[], command: [] as number[], gyro: [] as number[], gyrof: [] as number[], hz: [] as number[], axis: [] as number[], run: [] as number[] };
  let t = 5;
  axes.forEach((axis, n) => {
    const d = synthetic(16000, 0.6, axis === 2 ? SYN.k / 6 : SYN.k);
    for (let k = 0; k < 16000; k++) {
      s.t.push(t + k * SYN.dt);
      s.excite.push(d.r[k]);
      s.command.push(d.u[k]);
      s.gyro.push(d.y[k]);
      s.gyrof.push(d.yf[k]);
      s.hz.push(d.hz[k]);
      s.axis.push(axis);
      s.run.push(n + 1);
    }
    t += 20;
  });
  return s;
}

let full: TuneReport | null = null;
const report = () => (full ??= analyze(log([0, 1, 2]), INFO));

afterEach(cleanup);

describe("отчёт автонастройки", () => {
  it("таблица «было → стало», команды CLI и кнопка «применить»", () => {
    const r = report();
    const apply = vi.fn();
    render(<Summary report={r} onApply={apply} applied={false} />);
    const card = screen.getByTestId("tune-summary");
    expect(within(card).getByText("Предложение: было → стало")).toBeTruthy();
    // P крена: 25 → предложенное
    const row = within(card).getByText("P").closest("tr")!;
    expect(row.textContent).toContain(`25 → ${r.axes[0]!.next!.bf.p}`);
    // запасы по фазе у предложения — не меньше 45 (с округлением целых BF — 44)
    const pm = within(card).getByText("Запас по фазе, °").closest("tr")!;
    const next = Number(/→ (\d+)/.exec(pm.cells[1].textContent ?? "")![1]);
    expect(next).toBeGreaterThanOrEqual(44);
    expect(card.textContent).toContain(`set dterm_lpf1_static_hz = ${r.dtermLpfHz.next}`);
    const button = screen.getByTestId("tune-apply") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("без платы применить нельзя — остаются команды; после записи кнопка говорит «Сохранить»", () => {
    const r = report();
    const { rerender } = render(<Summary report={r} onApply={null} applied={false} />);
    expect((screen.getByTestId("tune-apply") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Плата не подключена — команды ниже можно вставить в CLI.")).toBeTruthy();
    rerender(<Summary report={r} onApply={() => {}} applied />);
    expect(screen.getByTestId("tune-apply").textContent).toBe("Записано в плату — осталось «Сохранить»");
  });

  it("графики оси: измеренные точки, модель, контур «было» и «стало», ступенька", () => {
    const r = report();
    render(<AxisCard a={r.axes[0]!} loopHz={r.loopHz} />);
    const card = screen.getByTestId("tune-axis-0");
    expect(within(card).getByText("Крен")).toBeTruthy();
    expect(card.querySelectorAll("figure.tune-plot").length).toBe(4);
    expect(card.querySelectorAll("path.tune-line.next").length).toBe(3);
    expect(card.querySelectorAll("path.tune-line.model").length).toBe(1);
    expect(card.querySelectorAll("circle.tune-dot").length).toBeGreaterThan(60);
    for (const p of Array.from(card.querySelectorAll("path.tune-line"))) expect(p.getAttribute("d")).not.toContain("NaN");
    // ступенька «стало» доходит до уставки: путь не пустой
    expect(card.querySelector("path.tune-line.next:last-of-type")!.getAttribute("d")!.length).toBeGreaterThan(100);
    expect(card.textContent).toContain("Запасы по самой записи, без модели");
  });

  it("в журнале нет третьей оси — сказано, какой; предложения нет", () => {
    const r = analyze(log([0, 1]), INFO);
    render(<Summary report={r} onApply={null} applied={false} />);
    expect(screen.getByText("Рысканье: свипа нет — тумблер CHIRP нужно включить ещё раз (оси идут по очереди).")).toBeTruthy();
    expect(screen.getByText("Измерение")).toBeTruthy();
    expect(screen.queryByTestId("tune-apply")).toBeNull();
    // измеренное всё равно показано: «было» без «стало»
    expect(screen.getByText("P").closest("tr")!.textContent).not.toContain("→");
  });
});
