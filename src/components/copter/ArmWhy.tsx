// Почему не армится (P10): причина словами, что сделать, слово в очках и
// кнопка «исправить». Живые коды — из "@live" (block).

import {
  BatteryLow,
  Cpu,
  Crosshair,
  Fan,
  Gauge,
  Hourglass,
  Radio,
  RotateCcw,
  Satellite,
  Save,
  SquareTerminal,
  ToggleLeft,
  TriangleAlert,
} from "lucide-react";

import { api, errorText } from "../../api";
import { ArmFix, ArmIcon, armWhyList } from "../../core/armWhy";
import { t } from "../../i18n";
import { useApp } from "../../store";
import { GoTo } from "./Search";

const ICONS: Record<ArmIcon, typeof Radio> = {
  radio: Radio,
  throttle: Gauge,
  switch: ToggleLeft,
  level: Crosshair,
  chip: Cpu,
  battery: BatteryLow,
  gps: Satellite,
  wait: Hourglass,
  motor: Fan,
  save: Save,
  cli: SquareTerminal,
  crash: TriangleAlert,
  reboot: RotateCcw,
};

export function ArmWhyList({ codes, armed, onGo }: { codes: string[]; armed: boolean; onGo?: GoTo }) {
  const save = useApp((s) => s.copterSave);
  const revert = useApp((s) => s.copterRevert);
  const toast = useApp((s) => s.toast);
  const run = async (f: ArmFix) => {
    try {
      if (f.kind === "key") await api.linkSend(f.key);
      else if (f.kind === "command") await api.linkCommand(f.cmd);
      else if (f.kind === "save") await save();
      else if (f.kind === "revert") await revert();
      else onGo?.(f.tab);
    } catch (e) {
      toast("err", errorText(e));
    }
  };
  return (
    <div className="arm-why">
      {armWhyList(codes).map((x) => {
        const Icon = ICONS[x.icon];
        return (
          <div key={x.code} className={`issue ${x.bench ? "info" : "warning"}`}>
            <Icon size={20} color={x.bench ? "var(--info)" : "var(--warn)"} />
            <div className="grow">
              <div>
                <b>{t(x.what)}</b> <span className="arm-why-word mono" title={t("Так написано в очках; код BF — {code}", { code: x.code })}>{x.word}</span>
              </div>
              {x.how && <div className="hint">{t(x.how)}</div>}
            </div>
            {x.fixes
              .filter((f) => f.kind !== "tab" || onGo)
              .map((f) => (
                <button key={f.label} className="btn" disabled={armed && f.kind !== "tab"} onClick={() => void run(f)}>
                  {t(f.label)}
                </button>
              ))}
          </div>
        );
      })}
    </div>
  );
}
