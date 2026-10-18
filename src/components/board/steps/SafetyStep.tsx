import { findBoard, Manifest } from "../../../core/manifest";
import { setParamValue } from "../../../core/params";
import { effectiveParam, PlaneProject } from "../../../core/project";
import { haveTokens } from "../../../core/rules";
import { N_, t } from "../../../i18n";
import { useApp } from "../../../store";
import { Choice, Section, StepHead } from "../../ui";
import { ParamField } from "../ParamField";

/** Что сделает самолёт, если что-то пойдёт не так, — простыми словами. */
export function safetyStory(manifest: Manifest, plane: PlaneProject): string[] {
  const have = haveTokens(manifest, plane);
  const v = (name: string) => effectiveParam(manifest, plane, name);
  const lines: string[] = [];
  if (v("FAILSAFE_RTH") === true && have.gps) {
    lines.push(t("Пропадёт связь в воздухе — полетит домой на {h} м и будет кружить над вами, пока связь не вернётся.", { h: String(v("RTH_ALTITUDE_M")) }));
  } else {
    lines.push(
      t("Пропадёт связь в воздухе — будет планировать: мотор выключен, крылья ровно, нос {p}°.", { p: String(v("FAILSAFE_GLIDE_PITCH_DEG")) }),
    );
  }
  lines.push(t("Пропадёт связь на земле — мотор стоит, рули в нейтрали, через несколько секунд пищалка."));
  const fenceBound = plane.bindings.some((b) => b.kind === "feature" && b.feature === "GEOFENCE");
  if (have.gps && (v("GEOFENCE_ALWAYS_ON") === true || fenceBound)) {
    lines.push(
      t("Дальше {r} м от дома или выше {h} м — домой{how}.", {
        r: String(v("FENCE_RADIUS_M")),
        h: String(v("FENCE_ALTITUDE_M")),
        how: v("GEOFENCE_ALWAYS_ON") === true ? t(" (всегда)") : t(" (когда геозабор включён тумблером)"),
      }),
    );
  }
  const limit = Number(v("THROTTLE_LIMIT_PCT"));
  if (limit < 100) lines.push(t("Газ ограничен {n} % — для стенда. Перед полётом верните 100 %.", { n: limit }));
  return lines;
}

export function SafetyStep() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const setFocus = useApp((s) => s.setFocus);
  const have = haveTokens(manifest, plane);
  const rth = effectiveParam(manifest, plane, "FAILSAFE_RTH") === true;

  return (
    <>
      <StepHead title={t("Безопасность")}>
        {t("Что делает самолёт, когда пропала связь, и где его граница.")}
      </StepHead>
      <Section title={t("Пропала связь в воздухе")}>
        <div className="choices wide" onMouseEnter={() => setFocus(["gps"])} onMouseLeave={() => setFocus([])}>
          <Choice
            title={t("Домой")}
            desc={t("С мотором летит к точке ARM, над домом кружит. Без GPS — всё равно планирует.")}
            selected={rth}
            note={!have.gps ? t("Для возврата домой нужен GPS — сейчас его нет, будет планирование") : undefined}
            onClick={() => updatePlane((p) => setParamValue(manifest, p, "FAILSAFE_RTH", true))}
          />
          <Choice
            title={t("Планировать")}
            desc={t("Мотор выключен, крылья ровно, нос чуть ниже горизонта.")}
            selected={!rth}
            onClick={() => updatePlane((p) => setParamValue(manifest, p, "FAILSAFE_RTH", false))}
          />
        </div>
      </Section>
      <Section title={t("Возврат и планирование")}>
        <ParamField name="RTH_ALTITUDE_M" label={t("Высота возврата")} />
        <ParamField name="FAILSAFE_GLIDE_PITCH_DEG" label={t("Тангаж планирования")} />
        <ParamField name="FAILSAFE_GLIDE_ROLL_DEG" label={t("Крен планирования (0 — прямо, 10–20 — круг)")} />
        <ParamField name="HOME_MIN_SATELLITES" label={t("Дом: спутников не меньше")} />
        <ParamField name="HOME_MAX_HACC_M" label={t("Дом: точность GPS не хуже")} />
      </Section>
      <Section title={t("Геозабор")}>
        <ParamField name="GEOFENCE_ALWAYS_ON" label={t("Геозабор всегда, без тумблера")} />
        <ParamField name="FENCE_RADIUS_M" label={t("Радиус")} />
        <ParamField name="FENCE_ALTITUDE_M" label={t("Потолок")} />
      </Section>
      <Section title={t("Газ и пищалка")}>
        <ParamField name="THROTTLE_LIMIT_PCT" label={t("Предел газа (стенд — меньше 100)")} />
        <ParamField name="LOST_MODEL_BEEP_DELAY_MS" label={t("Пищать «где я» через")} />
      </Section>
    </>
  );
}

const SYSTEM_GROUPS = [N_("Чёрный ящик"), N_("Телеметрия MAVLink по радиомодему"), N_("Веб-дашборд"), N_("Цикл управления"), "Debug"];

export function SystemStep() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const board = findBoard(manifest, plane.board);
  return (
    <>
      <StepHead title={t("Система")}>
        {t("Чёрный ящик, связь с землёй и служебные настройки. Обычно трогать не нужно.")}
      </StepHead>
      {SYSTEM_GROUPS.map((group) => {
        const params = manifest.params.filter((p) => p.group === group && p.board === null && !p.fixed);
        if (!params.length) return null;
        let note: string | null = null;
        if (group === "Чёрный ящик" && board?.blackbox === "none") note = t("На этой плате ящика нет — настройки не действуют.");
        if (group === "Телеметрия MAVLink по радиомодему" && board?.telemetry !== "mavlink") note = t("На этой плате MAVLink нет — связь по Wi-Fi.");
        if (group === "Веб-дашборд" && board?.telemetry !== "wifi") note = t("На этой плате Wi-Fi нет.");
        return (
          <Section key={group} title={t(group)}>
            {note && <p className="hint">{note}</p>}
            {params.map((p) => (
              <ParamField key={p.name} name={p.name} />
            ))}
          </Section>
        );
      })}
    </>
  );
}
