// Замкнутый контур с известным объектом — тот же опыт, что в прошивке
// (plane/test/native/test_copter/test_sysid.cpp, synthetic): объект
// K/(s(1 + sτ)) с задержкой в два цикла, PI-регулятор, chirp 1–200 Гц в
// команду, шум гироскопа. Генератор шума целочисленный — данные в обоих
// языках одни и те же.

export const SYN = { dt: 0.001, k: 120000, tau: 0.03, delay: 2, p: 0.0008, i: 0.012, filter: 0.6 };

export function synthetic(samples: number, noiseDps: number, gain = SYN.k) {
  const r: number[] = [],
    u: number[] = [],
    y: number[] = [],
    yf: number[] = [],
    hz: number[] = [];
  let seed = 12345;
  const noise = () => {
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      sum += seed / 4294967296 - 0.5;
    }
    return sum;
  };
  const f0 = 1,
    f1 = 200,
    total = samples * SYN.dt;
  const lag = 1 - Math.exp(-SYN.dt / SYN.tau);
  let motor = 0,
    rate = 0,
    integral = 0,
    filtered = 0,
    phase = 0;
  const queue = new Array(SYN.delay + 1).fill(0);
  for (let k = 0; k < samples; k++) {
    const t = k * SYN.dt;
    const f = f0 * Math.pow(f1 / f0, t / total);
    phase += 2 * Math.PI * f * SYN.dt;
    const excite = 0.05 * Math.sin(phase);
    const gyro = rate + noiseDps * noise();
    filtered += SYN.filter * (gyro - filtered);
    integral += SYN.i * (0 - filtered) * SYN.dt;
    const command = SYN.p * (0 - filtered) + integral + excite;
    r.push(excite);
    u.push(command);
    y.push(gyro);
    yf.push(filtered);
    hz.push(f);
    for (let i = SYN.delay; i > 0; i--) queue[i] = queue[i - 1];
    queue[0] = command;
    motor += lag * (queue[SYN.delay] - motor);
    rate += gain * motor * SYN.dt;
  }
  return { r, u, y, yf, hz };
}
