import { findBoard } from "../../../core/manifest";
import { Airframe, setGear } from "../../../core/project";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { Choice, Section, StepHead, Toggle } from "../../ui";
import { ParamField } from "../ParamField";

const REVERSE = [
  ["AILERON_LEFT_REVERSED", "Левый элерон"],
  ["AILERON_RIGHT_REVERSED", "Правый элерон"],
  ["ELEVATOR_REVERSED", "Руль высоты"],
  ["RUDDER_REVERSED", "Руль направления и колесо"],
  ["FLAPS_REVERSED", "Закрылки и тормоз"],
  ["MOTOR_REVERSED", "Мотор (только двунаправленный ESC)"],
  ["AUX1_REVERSED", "Серво сброса груза"],
  ["AUX2_REVERSED", "Серво камеры"],
] as const;

export function AirframeStep() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const setFocus = useApp((s) => s.setFocus);
  const mode = useApp((s) => s.mode);
  const board = findBoard(manifest, plane.board);
  const a = plane.airframe;
  const toast = useApp((s) => s.toast);
  const set = <K extends keyof Airframe>(key: K, value: Airframe[K]) => updatePlane((p) => (p.airframe[key] = value));
  const gear = (value: Airframe["gear"]) => {
    let note: string | null = null;
    updatePlane((p) => (note = setGear(p, value)));
    if (note) toast("info", t(note));
  };
  const hover = (parts: string[]) => ({ onMouseEnter: () => setFocus(parts), onMouseLeave: () => setFocus([]) });

  const extra = (key: "payload" | "camera" | "buzzer" | "rudder", title: string, desc: string, available: boolean, part: string) => (
    <div className="card row" style={{ padding: "12px 14px" }} {...hover([part])}>
      <div className="grow">
        <div style={{ fontWeight: 600 }}>{title}</div>
        <div className="hint">{available ? desc : t("У платы {b} нет этого выхода", { b: board?.title ?? plane.board })}</div>
      </div>
      <Toggle on={a[key] && available} disabled={!available} onChange={(v) => set(key, v)} />
    </div>
  );

  return (
    <>
      <StepHead title={t("Самолёт")}>
        {t("Что стоит на самолёте. От этого зависят функции на тумблерах: закрылкам нужны две сервы элеронов, автовзлёту — шасси, реверсу — двунаправленный регулятор.")}
      </StepHead>

      <Section title={t("Моторы")}>
        <div className="choices" {...hover(["motor"])}>
          <Choice title={t("Один мотор")} selected={a.motors === 1} onClick={() => set("motors", 1)} />
          <Choice title={t("Два мотора")} desc={t("скоро в прошивке")} disabled />
          <Choice title={t("Три и больше")} desc={t("скоро в прошивке")} disabled />
        </div>
        <div className="choices" style={{ marginTop: 10 }} {...hover(["motor"])}>
          <Choice title={t("Тянущий")} desc={t("винт впереди")} selected={a.motorPosition === "tractor"} onClick={() => set("motorPosition", "tractor")} />
          <Choice title={t("Толкающий")} desc={t("винт сзади")} selected={a.motorPosition === "pusher"} onClick={() => set("motorPosition", "pusher")} />
        </div>
      </Section>

      <Section title={t("Регулятор мотора")}>
        <div className="choices wide" {...hover(["motor"])}>
          <Choice
            title={t("Двунаправленный (3D)")}
            desc={t("Можно назад — отрулить на земле. В BLHeliSuite: Motor Direction = Bidirectional.")}
            selected={a.esc === "bidirectional"}
            onClick={() => set("esc", "bidirectional")}
          />
          <Choice title={t("Обычный")} desc={t("Только вперёд, 1000 мкс — стоп.")} selected={a.esc === "normal"} onClick={() => set("esc", "normal")} />
        </div>
      </Section>

      <Section title={t("Элероны")}>
        <div className="choices wide" {...hover(["ailerons"])}>
          <Choice
            title={t("По серве на элерон")}
            desc={t("Можно закрылки (флапероны) и воздушный тормоз.")}
            selected={a.ailerons === "two"}
            onClick={() => set("ailerons", "two")}
          />
          <Choice title={t("Одна серва на оба")} desc={t("Через Y-кабель: без закрылок.")} selected={a.ailerons === "one"} onClick={() => set("ailerons", "one")} />
        </div>
      </Section>

      <Section title={t("Шасси")}>
        <div className="choices" {...hover(["gear"])}>
          <Choice title={t("Хвостовое колесо")} desc={t("Два спереди, рулевое сзади — как у Astro-Cargo")} selected={a.gear === "tail"} onClick={() => gear("tail")} />
          <Choice title={t("Носовое колесо")} desc={t("Трёхколёсное, стоит почти ровно")} selected={a.gear === "nose"} onClick={() => gear("nose")} />
          <Choice title={t("Без шасси")} desc={t("Запуск с руки: есть автовзлёт с руки — мотор сам включается после броска")} selected={a.gear === "none"} onClick={() => gear("none")} />
        </div>
      </Section>

      <Section title={t("Что ещё стоит")}>
        <div style={{ display: "grid", gap: 8 }}>
          {extra("rudder", t("Руль направления"), t("Серва руля и рулевого колеса"), !!board?.outputs.rudder, "rudder")}
          {extra("payload", t("Сброс груза (AUX1)"), t("Серво замка груза — функция PAYLOAD_DROP"), !!board?.outputs.aux1, "payload")}
          {extra("camera", t("Камера (AUX2)"), t("Серво наклона камеры — крутилка и стабилизация"), !!board?.outputs.aux2, "camera")}
          {extra("buzzer", t("Пищалка"), t("«Я здесь» — найти самолёт в траве"), !!board?.outputs.buzzer, "buzzer")}
        </div>
      </Section>

      <Section title={t("Реверс")} sub={t("если что-то двигается не туда — одна галочка вместо перепайки")}>
        {REVERSE.map(([name, label]) => (
          <ParamField key={name} name={name} label={t(label)} />
        ))}
      </Section>

      {mode === "full" && (
        <Section title={t("Ходы рулей")} sub={t("полный режим")}>
          <ParamField name="AILERON_MAX_US" label={t("Ход элеронов")} />
          <ParamField name="ELEVATOR_MAX_US" label={t("Ход руля высоты")} />
          <ParamField name="RUDDER_MAX_US" label={t("Ход руля направления")} />
          <ParamField name="FLAPS_DEPLOYED_US" label={t("Закрылки: отклонение")} />
          <ParamField name="FLAPS_TRANSITION_MS" label={t("Закрылки: время выпуска")} />
          <ParamField name="AIRBRAKE_US" label={t("Воздушный тормоз")} />
          <ParamField name="REVERSE_THROTTLE_LIMIT_PCT" label={t("Предел газа назад")} />
        </Section>
      )}
    </>
  );
}
