// Поиск по настройкам коптера и переход с Betaflight: по имени BF
// («p_roll», «dyn_notch») или словами («газ висения») — на какой вкладке
// это у нас. Настройки — с платы; то, что у нас зовётся иначе, живёт в
// другом месте или ещё не сделано, — в словаре BF_TOPICS. Без React.

import { N_ } from "../i18n";
import { BEGINNER_TABS, CopterBoard, CopterTab, GROUP_TAB, TABS } from "./copterParams";

/** Имя BF или понятие, которого нет среди настроек платы: куда смотреть и почему. */
export interface BfTopic {
  /** имена BF (по началу: «dyn_notch» — и dyn_notch_count, и dyn_notch_q) */
  keys: string[];
  /** слова, по которым найти (по-русски; ищется и перевод) */
  words: string;
  tab: CopterTab;
  note: string;
}

export const BF_TOPICS: BfTopic[] = [
  { keys: ["dyn_notch", "gyro_lpf", "gyro_lowpass", "dterm_lpf", "dterm_lowpass", "gyro_notch", "dterm_notch", "rpm_filter"], words: N_("фильтры режекторы шум вибрации фнч"), tab: "filters", note: N_("Фильтры гироскопа и D строит модель коптера; руками — ползунки фильтров. Типы и частоты как в BF — позже.") },
  { keys: ["hover_throttle", "thr_hover", "gps_rescue_throttle_hover", "thr_mid"], words: N_("газ висения висение"), tab: "overview", note: N_("Газ висения прошивка выводит из описания коптера (масса, винты, моторы) и уточняет в полёте — он виден в «Чёрном ящике».") },
  { keys: ["thr_expo", "throttle_limit_type", "throttle_limit_percent"], words: N_("кривая газа предел газа"), tab: "rates", note: N_("Кривой и предела газа пока нет — газ линейный.") },
  { keys: ["rates_type"], words: N_("тип расходов actual kiss"), tab: "rates", note: N_("Тип расходов один: центр, максимум и экспо — по смыслу как ACTUAL в BF.") },
  { keys: ["motor_pwm_protocol", "dshot", "motor_pwm_rate"], words: N_("протокол регуляторов"), tab: "motors", note: N_("Протокол регуляторов задаёт сборка прошивки (вкладка «Коптер»).") },
  { keys: ["serial", "resource", "timer", "dma"], words: N_("порты uart распиновка ножки"), tab: "overview", note: N_("Порты и ножки задаёт сборка; с платы Betaflight приложение снимает распиновку само.") },
  { keys: ["aux", "mode_"], words: N_("тумблеры режимы arm"), tab: "modes", note: N_("Режимы на тумблерах — как aux в BF.") },
  { keys: ["adjrange", "adjustment"], words: N_("регулировки с тумблера"), tab: "modes", note: N_("Регулировок с тумблера (Adjustments) пока нет.") },
  { keys: ["map", "rxrange", "rssi_channel"], words: N_("порядок каналов aetr"), tab: "receiver", note: N_("Порядок каналов и их ход — вкладка «Приёмник».") },
  { keys: ["beeper", "beacon"], words: N_("пищалка маяк"), tab: "osd", note: N_("Пищалка по условиям BF и маяк DShot — позже.") },
  { keys: ["led_strip", "ledstrip", "led"], words: N_("светодиоды лента"), tab: "other", note: N_("LED-ленты пока нет.") },
  { keys: ["servo", "smix"], words: N_("сервы"), tab: "other", note: N_("Сервоприводы — у самолёта, в коптере их нет.") },
  { keys: ["feature"], words: N_("функции флажки"), tab: "other", note: N_("Флажков feature нет: каждое включается своей настройкой.") },
  { keys: ["preset"], words: N_("пресеты готовые настройки"), tab: "flight", note: N_("Пресетов нет: PID и фильтры считает модель коптера, подстроить — ползунками «Настройки полёта».") },
  { keys: ["acc_calibration", "calibrate", "acc_trim"], words: N_("калибровка акселерометра горизонт"), tab: "setup", note: N_("Калибровки — вкладка «Подготовка».") },
  { keys: ["diff", "dump", "get", "save"], words: N_("командная строка консоль"), tab: "cli", note: N_("CLI — те же команды, что в BF; diff BF вставляется туда же.") },
  { keys: ["betaflight", "bf"], words: N_("я с betaflight переход отличия"), tab: "frombf", note: N_("Какая вкладка BF где у нас и что сделано иначе.") },
];

export interface SearchHit {
  tab: CopterTab;
  /** настройка, которую подсветить на вкладке */
  param?: string;
  /** крупно (ключ перевода): описание настройки или вкладка */
  title: string;
  /** мелко: имя BF */
  name?: string;
  /** почему здесь (для тем BF) */
  note?: string;
  score: number;
}

/** Нижний регистр, ё → е, пробел и «_» — одно и то же. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").replace(/[\s_]+/g, " ").trim();
}

/** Все слова запроса есть в тексте. */
function words(query: string, text: string): boolean {
  const hay = norm(text);
  return norm(query).split(" ").every((w) => hay.includes(w));
}

/** Насколько имя BF похоже на запрос: целиком 100, началом 80, внутри 60. */
function byName(q: string, name: string): number {
  const n = norm(name);
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (q.length >= 3 && n.includes(q)) return 60;
  return 0;
}

const TAB_TITLE: Record<string, string> = Object.fromEntries([...TABS, ...BEGINNER_TABS].map((x) => [x.id, x.title]));

/** Название вкладки (ключ перевода). */
export function tabTitle(tab: CopterTab): string {
  return TAB_TITLE[tab] ?? tab;
}

/**
 * Поиск: настройки платы (если прочитаны), темы BF и сами вкладки. tr —
 * перевод (t), чтобы искать и на языке интерфейса. Лучшие сверху, не больше limit.
 */
export function searchCopter(query: string, board: CopterBoard | null, tr: (s: string) => string = (s) => s, limit = 12): SearchHit[] {
  const q = norm(query);
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];

  for (const name of board?.order ?? []) {
    const p = board!.params[name];
    if (!p) continue;
    const tab = GROUP_TAB[p.group] ?? "other";
    const s = byName(q, p.name) || (words(q, `${p.text} ${tr(p.text)}`) ? 40 : 0);
    if (s) hits.push({ tab, param: p.name, title: p.text, name: p.name, score: s });
  }

  const found = new Set(hits.map((h) => h.param));
  for (const topic of BF_TOPICS) {
    // лучшее имя BF темы: целиком, началом, внутри — или запрос длиннее имени («dyn_notch_count»)
    let key = topic.keys[0];
    let s = 0;
    for (const k of topic.keys) {
      const ks = byName(q, k) || (q.startsWith(norm(k) + " ") || (q.startsWith(norm(k)) && k.endsWith("_")) ? 70 : 0);
      if (ks > s) [s, key] = [ks, k];
    }
    if (!s && words(q, `${topic.words} ${tr(topic.words)}`)) s = 35;
    // настройка с таким именем есть на плате — тема не нужна
    if (s && !found.has(q.replace(/ /g, "_"))) hits.push({ tab: topic.tab, title: tabTitle(topic.tab), name: key, note: topic.note, score: s - 1 });
  }

  for (const [tab, title] of Object.entries(TAB_TITLE)) {
    if (words(q, `${title} ${tr(title)} ${tab}`)) hits.push({ tab: tab as CopterTab, title, score: 50 });
  }

  hits.sort((a, b) => b.score - a.score || (a.name ?? "").length - (b.name ?? "").length);
  return hits.slice(0, limit);
}

// ---------------- страница «Я с Betaflight» ----------------

/** Вкладка конфигуратора BF → наши вкладки (пусто — у нас нет). */
export const BF_TABS: { bf: string; ours: CopterTab[]; note?: string }[] = [
  { bf: "Setup", ours: ["setup"], note: N_("положение коптера, почему не армится, калибровки") },
  { bf: "Ports", ours: ["overview"], note: N_("порты задаёт сборка, распиновку снимаем с Betaflight сами") },
  { bf: "Configuration", ours: ["overview", "other"], note: N_("рама, винты, моторы, батарея — описание коптера") },
  { bf: "Power & Battery", ours: ["power"] },
  { bf: "Failsafe", ours: ["failsafe"], note: N_("и угол ARM, airmode, crash recovery, runaway takeoff") },
  { bf: "Presets", ours: ["flight"], note: N_("пресетов нет: настройку считает модель коптера") },
  { bf: "PID Tuning", ours: ["pid", "rates", "filters"] },
  { bf: "Receiver", ours: ["receiver"] },
  { bf: "Modes", ours: ["modes"] },
  { bf: "Adjustments", ours: [], note: N_("пока нет") },
  { bf: "Motors", ours: ["motors"] },
  { bf: "OSD", ours: ["osd"] },
  { bf: "Video Transmitter", ours: ["vtx"] },
  { bf: "GPS", ours: ["gps"], note: N_("и GPS Rescue") },
  { bf: "Blackbox", ours: ["blackbox"], note: N_("журнал — в разделе «Чёрный ящик», формат BF") },
  { bf: "CLI", ours: ["cli"] },
  { bf: "LED Strip", ours: [], note: N_("пока нет") },
  { bf: "Servos", ours: [], note: N_("в коптере не нужны") },
];

/** Что у нас сделано иначе, чем в BF, и почему. param — что подсветить. */
export const BF_DIFFERENCES: { title: string; ours: string; bf: string; tab?: CopterTab; param?: string }[] = [
  { title: N_("PID и фильтры считает модель"), ours: N_("Из описания коптера (рама, винты, моторы, батарея, масса) — под ваш коптер, и подстраиваются в полёте."), bf: N_("Одни умолчания на все коптеры, дальше — руками. Вернуть их: tune_source = BETAFLIGHT."), tab: "pid", param: "tune_source" },
  { title: N_("Связь пропала — садится, а не падает"), ours: N_("failsafe_procedure = AUTO-LAND: ровно и снижение до касания."), bf: N_("DROP: моторы стоп, коптер падает."), tab: "failsafe", param: "failsafe_procedure" },
  { title: N_("GPS Rescue не бросает коптер"), ours: N_("Проверка в пути не прошла (GPS пропал, мало спутников, дом не приближается) — посадка на месте."), bf: N_("DISARM — коптер падает."), tab: "gps", param: "gps_rescue_sanity_checks" },
  { title: N_("Airmode и в воздухе"), ours: N_("Включается после газа выше порога или когда коптер уже летит."), bf: N_("Только после газа выше порога."), tab: "failsafe", param: "airmode_start_throttle_percent" },
  { title: N_("Банки не угадываем"), ours: N_("Число банок — из описания коптера: севший 6S Li-ion не спутать с полным 4S."), bf: N_("Угадывает по напряжению при подключении."), tab: "power", param: "force_battery_cell_count" },
  { title: N_("Провал под газом — не тревога"), ours: N_("Тревога батареи — если ниже порога 2 с подряд."), bf: N_("Сразу при провале."), tab: "power", param: "vbat_duration_for_warning" },
  { title: N_("Поправка на просадку батареи включена"), ours: N_("vbat_sag_compensation = 100: на севшей коптер отвечает как на полной."), bf: N_("Выключена (0)."), tab: "pid", param: "vbat_sag_compensation" },
  { title: N_("Правка работает сразу"), ours: N_("Настройка уходит на плату сразу, без перезагрузки; «Сохранить» — во флеш. Пока не сохранено, ARM запрещён."), bf: N_("Save and Reboot.") },
];
