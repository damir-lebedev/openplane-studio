import { Lightbulb } from "lucide-react";

import { bindingText, channelTitle, itemLabel } from "../../../core/labels";
import { Binding } from "../../../core/manifest";
import { availability, bindingItems, haveTokens, itemById, ItemKind, needText } from "../../../core/rules";
import { t } from "../../../i18n";
import { useApp } from "../../../store";
import { itemParams } from "../../../core/itemParams";
import { Advanced, Section, StepHead } from "../../ui";
import { ParamField } from "../ParamField";
import { Transmitter } from "../Transmitter";

function Palette() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const setStep = useApp((s) => s.setStep);
  const have = haveTokens(manifest, plane);
  const groups: [ItemKind, string][] = [
    ["mode", "Режимы"],
    ["feature", "Функции"],
    ["knob", "Крутилки"],
  ];
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      {groups.map(([kind, title]) => {
        const items = kind === "mode" ? manifest.modes : kind === "feature" ? manifest.features : manifest.knobs;
        return (
          <div key={kind} style={{ marginBottom: 10 }}>
            <div className="hint" style={{ marginBottom: 6 }}>
              {t(title)}
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {items.map((item) => {
                const av = availability(item, have);
                const cls = av.state === "unavailable" ? "badge" : av.state === "degraded" ? "badge warn" : "badge ok";
                const note =
                  av.state === "unavailable"
                    ? needText(manifest, kind, item.name, av.missing)
                    : av.state === "degraded"
                      ? t("работает, лучше с: {l}", { l: av.better.map((x) => manifest.needTokens[x] ?? x).join(", ") })
                      : item.doc;
                return (
                  <span
                    key={item.id}
                    className={cls}
                    title={note}
                    style={av.state === "unavailable" ? { opacity: 0.55, textDecoration: "line-through", cursor: "pointer" } : undefined}
                    onClick={() =>
                      av.state === "unavailable" &&
                      setStep(av.missing.every((x) => ["imu", "baro", "mag", "gps", "pitot"].includes(x)) ? "sensors" : "airframe")
                    }
                  >
                    {itemLabel(kind, item.id)}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      <div className="hint">
        {t("Зелёное работает, жёлтое работает хуже без какого-то датчика, зачёркнутое недоступно — наведите, чтобы узнать, чего не хватает.")}
      </div>
    </div>
  );
}

function Suggestions() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const have = haveTokens(manifest, plane);
  const usable = manifest.suggestions.filter((sg) =>
    bindingItems(sg).every(({ kind, id }) => {
      const item = itemById(manifest, kind, id);
      return item && availability(item, have).state !== "unavailable";
    }),
  );
  if (!usable.length) return null;
  const apply = (sg: Binding) =>
    updatePlane((p) => {
      const { channel } = sg;
      const clean = { ...sg } as Binding & { doc?: string };
      delete clean.doc;
      p.bindings = [...p.bindings.filter((b) => b.channel !== channel && !(clean.kind === "modes" && b.kind === "modes")), clean as Binding];
    });
  return (
    <Section title={t("Идеи из прошивки")} sub={t("закомментированные строки Controls.h — одним нажатием")}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {usable.map((sg, i) => (
          <button key={i} className="btn small" title={sg.doc} onClick={() => apply(sg)}>
            <Lightbulb size={13} />
            {bindingText(manifest, sg)}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Числа режимов, функций и крутилок, что стоят на тумблерах, — по одному блоку на каждый. */
function BoundNumbers() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const mode = useApp((s) => s.mode);
  const seen = new Set<string>();
  const items = plane.bindings
    .flatMap((b) => bindingItems(b))
    .filter(({ kind, id }) => {
      const key = `${kind}:${id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return itemParams(manifest, kind, id).length > 0;
    });
  if (!items.length) return null;
  return (
    <Advanced title={t("числа того, что на тумблерах: {list}", { list: items.map((x) => itemLabel(x.kind, x.id)).join(", ") })} defaultOpen={mode === "full"}>
      {items.map(({ kind, id }) => (
        <Section key={`${kind}:${id}`} title={itemLabel(kind, id)}>
          {itemParams(manifest, kind, id).map((name) => (
            <ParamField key={name} name={name} />
          ))}
        </Section>
      ))}
    </Advanced>
  );
}

export function SwitchesStep() {
  const mode = useApp((s) => s.mode);
  return (
    <>
      <StepHead title={t("Тумблеры")}>
        {t("Что делает каждый тумблер и крутилка пульта. Выберите роль тумблера, потом нажмите на положение — и выберите режим или функцию.")}
      </StepHead>
      <Palette />
      <Transmitter />
      <div style={{ marginTop: 22 }}>
        <Suggestions />
      </div>
      <BoundNumbers />
      {mode === "simple" && (
        <p className="hint">
          {t("Пульт FlySky FS-i6, приёмник iBUS, раскладка каналов — как в Channels.h. Изменить — шаг «Пульт» полного режима.")}
        </p>
      )}
    </>
  );
}

export function RcStep() {
  const manifest = useApp((s) => s.manifest)!;
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const channels = manifest.channels.list.filter((c) => c.name !== "COUNT");
  const count = manifest.channels.count;
  const indexOf = (name: string) => plane.channels[name] ?? channels.find((c) => c.name === name)?.index ?? 0;

  return (
    <>
      <StepHead title={t("Пульт и приёмник")}>
        {t("Какой пульт и как его каналы приходят на плату. Обычно менять ничего не надо — раскладка проверена на FS-i6.")}
      </StepHead>
      <Section title={t("Пульт")}>
        <div className="choices wide">
          <div className="choice selected">
            <div className="choice-title">FlySky FS-i6 / FS-i6X</div>
            <div className="choice-desc">{t("10 каналов, приёмник FS-iA6B по iBUS")}</div>
          </div>
          <div className="choice disabled">
            <div className="choice-title">Radiomaster / EdgeTX</div>
            <div className="choice-desc">{t("скоро: нужен приёмник CRSF/ELRS в прошивке")}</div>
          </div>
        </div>
      </Section>
      <Section title={t("Раскладка каналов")} sub={t("Channels.h: какой орган пульта на каком канале")}>
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <tbody>
              {channels.map((c) => (
                <tr key={c.name}>
                  <td style={{ width: 120 }} className="mono">
                    {channelTitle(c.name)}
                  </td>
                  <td style={{ width: 140 }}>
                    <select
                      className="select"
                      value={indexOf(c.name)}
                      onChange={(e) =>
                        updatePlane((p) => {
                          const v = Number(e.target.value);
                          if (v === c.index) delete p.channels[c.name];
                          else p.channels[c.name] = v;
                        })
                      }
                    >
                      {Array.from({ length: count }, (_, i) => (
                        <option key={i} value={i}>
                          CH{i + 1}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="hint">{c.doc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={t("Каналы и потеря связи")}>
        <ParamField name="CHANNEL_REVERSED" label={t("Реверс каналов")} />
        <ParamField name="SWITCH_ON_US" label={t("Тумблер «включён» выше")} />
        <ParamField name="ARM_SWITCH_ON_US" label={t("ARM включён выше")} />
        <ParamField name="THROTTLE_LOW_US" label={t("Газ «внизу» ниже")} />
        <ParamField name="RX_FAILSAFE_THROTTLE_US" label={t("Газ ниже этого = потеря связи")} />
        <ParamField name="RX_TIMEOUT_US" label={t("Нет кадров дольше — приёмник потерян")} />
      </Section>
    </>
  );
}
