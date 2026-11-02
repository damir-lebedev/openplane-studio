// «Почему не армится — словами и кнопкой „исправить“» (P10): у каждого
// флага BF из "@live" — что случилось (ARM_TEXT), что сделать руками,
// значок, слово как в очках (copter armBlockWord) и, где можно, кнопка:
// калибровка, закрыть CLI, сохранить или отменить, перейти на вкладку.

import { N_ } from "../i18n";
import { ARM_BENCH_OK, ARM_TEXT, CopterTab } from "./copterParams";

export type ArmIcon = "radio" | "throttle" | "switch" | "level" | "chip" | "battery" | "gps" | "wait" | "motor" | "save" | "cli" | "crash" | "reboot";

export type ArmFix =
  /** клавиша консоли платы (калибровки: i, o) */
  | { kind: "key"; key: string; label: string }
  /** команда платы (exit — закрыть CLI) */
  | { kind: "command"; cmd: string; label: string }
  | { kind: "save"; label: string }
  | { kind: "revert"; label: string }
  | { kind: "tab"; tab: CopterTab; label: string };

export interface ArmWhy {
  code: string;
  /** слово в очках — как armBlockWord в прошивке */
  word: string;
  /** что случилось */
  what: string;
  /** что сделать руками */
  how: string;
  icon: ArmIcon;
  fixes: ArmFix[];
  /** на столе без пульта и батареи — нормально */
  bench: boolean;
}

const tab = (t: CopterTab, label: string): ArmFix => ({ kind: "tab", tab: t, label });

const WHY: Record<string, Omit<ArmWhy, "code" | "what" | "bench">> = {
  NOGYRO: { word: "NO GYRO", how: N_("Датчик не отвечает: перезагрузите плату; повторяется — плата неисправна или не та прошивка."), icon: "chip", fixes: [] },
  FAILSAFE: { word: "WAIT LINK", how: N_("Подождите пару секунд с включённым пультом — после failsafe связь должна продержаться."), icon: "radio", fixes: [tab("failsafe", N_("Настройки failsafe"))] },
  RXLOSS: { word: "NO RADIO", how: N_("Включите пульт и проверьте привязку: приёмник должен светиться ровно."), icon: "radio", fixes: [tab("receiver", N_("Открыть «Приёмник»"))] },
  NOT_DISARMED: { word: "ARM SW OFF", how: N_("Выключите тумблер ARM и включите снова."), icon: "switch", fixes: [] },
  BOXFAILSAFE: { word: "FS SWITCH", how: N_("Выключите тумблер режима FAILSAFE."), icon: "switch", fixes: [tab("modes", N_("Открыть «Режимы»"))] },
  RUNAWAY: { word: "RUNAWAY", how: N_("Коптер рванул на взлёте: проверьте порядок и направление моторов, винты и установку платы. Потом выключите ARM."), icon: "crash", fixes: [tab("motors", N_("Проверить моторы"))] },
  CRASH: { word: "CRASH", how: N_("Была авария: осмотрите винты и раму, выключите ARM."), icon: "crash", fixes: [] },
  THROTTLE: { word: "THR DOWN", how: N_("Опустите газ до упора. Внизу, а не пускает — поправьте нижнюю точку газа в «Приёмнике»."), icon: "throttle", fixes: [tab("receiver", N_("Открыть «Приёмник»"))] },
  ANGLE: { word: "NOT LEVEL", how: N_("Поставьте коптер ровно. Стоит ровно, а не пускает — откалибруйте установку платы."), icon: "level", fixes: [{ kind: "key", key: "o", label: N_("Откалибровать установку") }] },
  BOOTGRACE: { word: "WAIT", how: N_("Пара секунд после включения — подождите."), icon: "wait", fixes: [] },
  NOPREARM: { word: "PREARM", how: N_("Сначала включите тумблер PREARM, потом ARM."), icon: "switch", fixes: [tab("modes", N_("Открыть «Режимы»"))] },
  LOAD: { word: "CPU LOAD", how: N_("Процессор не успевает: снизьте частоту цикла или выключите лишнее (фильтры, ящик)."), icon: "chip", fixes: [tab("filters", N_("Открыть «Фильтры»"))] },
  CALIB: { word: "WAIT GYRO", how: N_("Не трогайте коптер пару секунд — гироскоп калибруется."), icon: "wait", fixes: [] },
  CLI: { word: "CLI OPEN", how: N_("Закройте CLI — ARM в нём запрещён."), icon: "cli", fixes: [{ kind: "command", cmd: "exit", label: N_("Закрыть CLI") }] },
  CMS: { word: "MENU OPEN", how: N_("Выйдите из меню в очках стиками (Exit)."), icon: "cli", fixes: [] },
  BST: { word: "BST", how: N_("Шина BST занята — отключите её устройство."), icon: "chip", fixes: [] },
  MSP: { word: "NOT SAVED", how: N_("В приложении несохранённые изменения: сохраните их в плату или отмените."), icon: "save", fixes: [{ kind: "save", label: N_("Сохранить") }, { kind: "revert", label: N_("Отменить") }] },
  PARALYZE: { word: "PARALYZE", how: N_("Включён PARALYZE — до перезагрузки не армится."), icon: "reboot", fixes: [] },
  GPS: { word: "NO GPS", how: N_("Нужен GPS для возврата домой: дождитесь спутников на открытом месте или разрешите ARM без GPS."), icon: "gps", fixes: [tab("gps", N_("Открыть «GPS»"))] },
  RESC: { word: "RESCUE SW", how: N_("Выключите тумблер возврата домой."), icon: "switch", fixes: [tab("modes", N_("Открыть «Режимы»"))] },
  RPMFILTER: { word: "NO RPM", how: N_("Регуляторы не шлют обороты: включите dshot_bidir и прошивку регуляторов, которая его умеет."), icon: "motor", fixes: [tab("motors", N_("Открыть «Моторы»"))] },
  REBOOT_REQD: { word: "REBOOT", how: N_("Сменились рама или выходы — перезагрузите плату (отключите и подключите питание)."), icon: "reboot", fixes: [] },
  DSHOT_BBANG: { word: "DSHOT FAIL", how: N_("DShot не запустился: выберите другой протокол или пины моторов."), icon: "motor", fixes: [tab("motors", N_("Открыть «Моторы»"))] },
  NO_ACC_CAL: { word: "CALIBRATE", how: N_("Покажите, как плата стоит в раме: три позы по подсказкам."), icon: "level", fixes: [{ kind: "key", key: "o", label: N_("Откалибровать установку") }] },
  MOTOR_PROTO: { word: "MOTOR PROTO", how: N_("Выберите протокол моторов, который понимают регуляторы."), icon: "motor", fixes: [tab("motors", N_("Открыть «Моторы»"))] },
  ARMSWITCH: { word: "ARM SW OFF", how: N_("ARM был включён до связи — выключите тумблер и включите снова."), icon: "switch", fixes: [] },
  MOVING: { word: "MOVING", how: N_("Коптер качают — поставьте на землю и не трогайте."), icon: "level", fixes: [] },
  BATTERY: { word: "LOW BATT", how: N_("Батарея разряжена — поставьте заряженную. Полная, а не пускает — проверьте напряжение банки в «Питании»."), icon: "battery", fixes: [tab("power", N_("Открыть «Питание»"))] },
  MOTOR_TEST: { word: "MOTOR TEST", how: N_("Идёт проверка моторов — остановите её."), icon: "motor", fixes: [tab("motors", N_("Открыть «Моторы»"))] },
  NO_ARM_AUX: { word: "NO ARM SW", how: N_("Назначьте ARM на тумблер пульта."), icon: "switch", fixes: [tab("modes", N_("Открыть «Режимы»"))] },
  CONFIG: { word: "CONFIG", how: N_("Описание коптера не сходится с платой — что именно, пишет `status` в CLI."), icon: "cli", fixes: [tab("cli", N_("Открыть CLI"))] },
};

export function armWhy(code: string): ArmWhy {
  const w = WHY[code];
  const what = ARM_TEXT[code] ?? N_("причина без описания");
  const bench = ARM_BENCH_OK.includes(code);
  if (!w) return { code, word: code, what, how: "", icon: "chip", fixes: [], bench };
  return { code, what, bench, ...w };
}

/** Причины по порядку: сначала то, что надо чинить, потом обычное на столе. */
export function armWhyList(codes: string[]): ArmWhy[] {
  const all = codes.map(armWhy);
  return [...all.filter((x) => !x.bench), ...all.filter((x) => x.bench)];
}

/** Коды, у которых есть объяснение (для теста полноты). */
export const ARM_WHY_CODES = Object.keys(WHY);
