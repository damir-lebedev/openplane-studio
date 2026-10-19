import { itemLabel } from "../../../core/labels";
import { findBoard, isNone, SensorCategory, SENSOR_CATEGORIES } from "../../../core/manifest";
import { onboardSensors } from "../../../core/project";
import { N_, t } from "../../../i18n";
import { useApp } from "../../../store";
import { Advanced, Choice, Section, StepHead } from "../../ui";
import { ParamField } from "../ParamField";

const TITLES: Record<SensorCategory, { title: string; part: string; token: string; none?: string }> = {
  imu: { title: N_("IMU — гироскоп и акселерометр"), part: "board", token: "imu" },
  baro: { title: N_("Барометр — высота"), part: "baro", token: "baro", none: N_("Режимы с высотой будут недоступны") },
  mag: { title: N_("Компас"), part: "mag", token: "mag" },
  gps: { title: "GPS", part: "gps", token: "gps" },
  airspeed: { title: N_("Трубка Пито — воздушная скорость"), part: "pitot", token: "pitot" },
};

export function SensorsStep() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const setFocus = useApp((s) => s.setFocus);
  const mode = useApp((s) => s.mode);

  /** Что этот датчик открывает и что улучшает — из меток @needs/@better. */
  const gives = (token: string) => {
    const needs: string[] = [];
    const better: string[] = [];
    for (const m of manifest.modes) {
      if (m.needs?.includes(token)) needs.push(itemLabel("mode", m.id));
      else if (m.better.includes(token)) better.push(itemLabel("mode", m.id));
    }
    for (const f of manifest.features) if (f.needs?.includes(token)) needs.push(itemLabel("feature", f.id));
    return { needs, better };
  };

  const board = findBoard(manifest, plane.board);
  // Датчики на плате полётника выбраны платой; наборы других полётников самодельной плате ни к чему.
  const onboard = onboardSensors(manifest, board);
  const boardKits = new Set(manifest.boards.map((b) => b.kit).filter(Boolean));
  const kits = onboard ? [] : manifest.sensors.kits.filter((k) => Object.keys(k.sensors).length && !boardKits.has(k.id));
  const kitActive = (sensors: Partial<Record<SensorCategory, string>>) =>
    SENSOR_CATEGORIES.every((c) => sensors[c] === plane.sensors[c]);

  return (
    <>
      <StepHead title={t("Датчики")}>
        {t("Что подключено к плате. Режимы автопилота открываются датчиками: удержанию высоты нужен барометр, возврату домой и геозабору — GPS.")}
      </StepHead>
      {kits.length > 0 && (
        <Section title={t("Готовые наборы")} sub={t("из SensorSelection.h — одним нажатием")}>
          <div className="choices wide">
            {kits.map((k) => (
              <Choice
                key={k.id}
                title={k.id.replace("SENSOR_KIT_", "").replace(/_/g, " ")}
                desc={t(k.doc)}
                selected={kitActive(k.sensors)}
                onClick={() => updatePlane((p) => Object.assign(p.sensors, k.sensors))}
              />
            ))}
          </div>
        </Section>
      )}
      {SENSOR_CATEGORIES.map((cat) => {
        const info = TITLES[cat];
        const options = manifest.sensors.options[cat];
        const g = gives(info.token);
        const allowNone = cat === "baro";
        const hasNone = options.some((o) => o.id.endsWith("_NONE"));
        return (
          <Section
            key={cat}
            title={t(info.title)}
            sub={
              g.needs.length || g.better.length
                ? [g.needs.length ? t("открывает: {l}", { l: g.needs.join(", ") }) : "", g.better.length ? t("улучшает: {l}", { l: g.better.join(", ") }) : ""]
                    .filter(Boolean)
                    .join(" · ")
                : undefined
            }
          >
            <div className="choices" onMouseEnter={() => setFocus([info.part])} onMouseLeave={() => setFocus([])}>
              {onboard?.[cat] && (
                <Choice
                  title={`${t(options.find((o) => o.id === onboard[cat])?.title ?? onboard[cat]!)} 🔒`}
                  desc={t("Распаян на плате {board} — другой не выбрать.", { board: t(board?.title ?? "").split(" — ")[0] })}
                  selected
                  onClick={() => {}}
                />
              )}
              {!onboard?.[cat] && allowNone && !hasNone && (
                <Choice
                  title={t("Нет")}
                  desc={t(info.none ?? "")}
                  selected={isNone(plane.sensors[cat])}
                  onClick={() => updatePlane((p) => (p.sensors[cat] = "none"))}
                />
              )}
              {!onboard?.[cat] && options.map((o) => (
                <Choice
                  key={o.id}
                  title={o.bus === "none" ? t("Нет") : t(o.title)}
                  desc={o.bus === "none" ? undefined : t(o.doc || o.note)}
                  badge={o.bus !== "none" ? <span className="badge">{o.bus.toUpperCase()}</span> : undefined}
                  selected={plane.sensors[cat] === o.id}
                  onClick={() => updatePlane((p) => (p.sensors[cat] = o.id))}
                />
              ))}
            </div>
            {cat === "imu" && !onboard && <p className="hint">{t("IMU обязателен: без него работает только ручной режим.")}</p>}
            {cat === "imu" && onboard && (
              <p className="hint">{t("Плату в самолёт можно ставить как удобно: после прошивки покажите её установку тремя позами («Наладка» → «Установка IMU») — без этого ARM со стабилизацией не включится.")}</p>
            )}
            {onboard && (cat === "mag" || cat === "airspeed") && (
              <p className="hint">{t("Подключается к внешнему разъёму I2C платы (SDA/SCL, питание 3,3–5 В — по модулю).")}</p>
            )}
            {cat === "baro" && isNone(plane.sensors.baro) && (
              <p className="hint">{t("В прошивке останется драйвер по умолчанию — он просто не найдёт датчик, полёту это не мешает.")}</p>
            )}
          </Section>
        );
      })}
      <Advanced title={t("установка IMU и компаса, трубка Пито")} defaultOpen={mode === "full"}>
        <ParamField name="IMU_ROTATION_CW_DEG" label={t("Поворот IMU")} hint={t("Проще — калибровка установки тремя позами после прошивки («Наладка» → «Установка IMU»).")} />
        <ParamField name="MAG_ROTATION_CW_DEG" label={t("Поворот компаса")} />
        <ParamField name="PITOT_SCALE" label={t("Поправка трубки Пито")} />
        <ParamField name="PITOT_ZERO_SAMPLES" label={t("Отсчётов для нуля трубки")} />
        <ParamField name="PITOT_FILTER_TAU_S" label={t("Фильтр трубки")} />
      </Advanced>
    </>
  );
}
