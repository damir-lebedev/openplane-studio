// Сквозная проверка на настоящем журнале: прошивка в симуляторе пишет полёт с
// тремя свипами через чёрный ящик, Studio его разбирает и считает настройку.
// Журнал большой (7 МБ) и в репозитории не лежит — проверка включается
// переменной окружения:
//   в plane:  OPENPLANE_COPTER_CHIRP_DUMP=<файл> pio test -e native -f native/test_copter_blackbox
//   здесь:    OPENPLANE_CHIRP_LOG=<файл> npx vitest run src/core/chirplog.test.ts

import { describe, expect, it } from "vitest";
import { marginsOk } from "./autotune";
import { decodeFlight } from "./blackbox";
import { analyze } from "./chirptune";

// типов Node в проекте нет: окружение и файл — без них
const path = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.OPENPLANE_CHIRP_LOG;
const nodeFs = "node:" + "fs";

describe("журнал с chirp из прошивки", () => {
  (path ? it : it.skip)("разбирается, коптер измерен, настройка предложена", async () => {
    const fs = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync(file: string): Uint8Array };
    const flight = decodeFlight(new Uint8Array(fs.readFileSync(path!)));
    const q = flight.series.QCHIRP;
    expect(q.count).toBeGreaterThan(59000);
    expect(flight.info["tune.level_gain"]).toBeTruthy();
    expect(flight.events.some((e) => e.text.startsWith("chirp: roll"))).toBe(true);
    const c = q.cols;
    const report = analyze({ t: q.t, excite: c.excite, command: c.command, gyro: c.gyro, gyrof: c.gyrof, hz: c.hz, axis: c.axis, run: c.run }, flight.info);
    expect(report.problems).toEqual([]);
    expect(report.found).toBe(true);
    const lines: string[] = [];
    for (const a of report.axes) {
      const n = a!.next!;
      lines.push(
        `axis ${a!.axis}: K ${a!.plant.gain.toFixed(0)} tau ${(a!.plant.tau * 1e3).toFixed(1)} ms delay ${(a!.plant.delay * 1e3).toFixed(2)} ms | ` +
          `PID ${a!.now.bf.p}/${a!.now.bf.i}/${a!.now.bf.d}/${a!.now.bf.f} -> ${n.bf.p}/${n.bf.i}/${n.bf.d}/${n.bf.f} | ` +
          `crossover ${a!.now.margins.crossoverHz.toFixed(1)} -> ${n.margins.crossoverHz.toFixed(1)} Hz, pm ${n.margins.phaseMarginDeg.toFixed(1)}, gm ${n.margins.gainMarginDb.toFixed(1)}, ms ${n.margins.sensitivityDb.toFixed(1)} | ` +
          `flown ${a!.flown ? a!.flown.crossoverHz.toFixed(1) : "-"} Hz | step ${(a!.now.step.rise * 1e3).toFixed(0)} ms ${(a!.now.step.overshoot * 100).toFixed(0)}% -> ${(n.step.rise * 1e3).toFixed(0)} ms ${(n.step.overshoot * 100).toFixed(0)}%`,
      );
      expect(a!.sampleHz).toBeGreaterThan(990);
      expect(a!.sampleHz).toBeLessThan(1010);
      expect(marginsOk(n.margins, 44, 5.8, 6.3)).toBe(true);
      expect(n.margins.crossoverHz).toBeGreaterThan(a!.now.margins.crossoverHz);
      // контур по самой записи — там же, где по модели с регулятором из заголовка
      expect(Math.abs(a!.flown!.crossoverHz / a!.now.margins.crossoverHz - 1)).toBeLessThan(0.2);
    }
    console.log(lines.join("\n") + `\nD lpf ${report.dtermLpfHz.now} -> ${report.dtermLpfHz.next} Hz`);
    // 5" из каталога: K крена около 148 тыс. °/с² на единицу команды, мотор 30 мс, задержка 2 мс
    const roll = report.axes[0]!.plant;
    expect(Math.abs(roll.gain / 148000 - 1)).toBeLessThan(0.05);
    expect(Math.abs(roll.tau / 0.0305 - 1)).toBeLessThan(0.05);
    expect(Math.abs(roll.delay / 0.00195 - 1)).toBeLessThan(0.08);
  });
});
