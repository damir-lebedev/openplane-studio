// Самолёт сверху: деталь, о которой сейчас речь в мастере, подсвечивается;
// то, чего нет (нет трубки Пито, нет шасси), растворяется. Временная 2D-версия
// «камеры-режиссёра» до 3D-модели (план, пункты 38–42).

import { isNone } from "../core/manifest";
import { PlaneProject } from "../core/project";
import { t } from "../i18n";

export function PlanePreview({ plane, focus = [], height }: { plane: PlaneProject; focus?: string[]; height?: number }) {
  const a = plane.airframe;
  const s = plane.sensors;
  const on = (id: string) => focus.includes(id);
  // Наведение на то, чего нет (датчик ещё не выбран), показывает деталь
  // пунктиром — где она будет.
  const cls = (id: string, present = true, line = false) =>
    `part${on(id) ? " on" : ""}${present ? "" : on(id) ? " ghost" : " gone"}${line ? " line" : ""}`;
  const pusher = a.motorPosition === "pusher";
  const motorY = pusher ? 296 : 22;
  const propY = pusher ? 305 : 13;

  return (
    <svg viewBox="0 0 400 320" style={height ? { height, width: "auto", maxWidth: "100%" } : undefined} aria-label={t("Самолёт сверху")}>
      {/* крыло */}
      <path className={cls("wing")} d="M44 106 L356 106 Q366 108 364 116 L358 138 Q356 141 352 141 L48 141 Q44 141 42 138 L36 116 Q34 108 44 106 Z" />
      {/* элероны */}
      <path className={cls("ailerons")} d="M54 131 L142 131 L142 141 L50 141 Z" />
      <path className={cls("ailerons")} d="M258 131 L346 131 L350 141 L258 141 Z" />
      {/* стабилизатор и руль высоты */}
      <path className={cls("tail")} d="M142 246 L258 246 L254 268 L146 268 Z" />
      <path className={cls("elevator")} d="M147 261 L253 261 L253 269 L147 269 Z" />
      {/* фюзеляж */}
      <path
        className={cls("fuselage")}
        d="M200 30 C213 30 219 48 219 72 L217 252 C217 270 209 284 200 289 C191 284 183 270 183 252 L181 72 C181 48 187 30 200 30 Z"
      />
      {/* киль и руль направления (вид сверху — линия) */}
      <line className={cls("tail", true, true)} x1="200" y1="236" x2="200" y2="276" strokeWidth="5" />
      <line className={cls("rudder", a.rudder, true)} x1="200" y1="276" x2="200" y2="292" strokeWidth="5" />
      {/* мотор и винт */}
      <circle className={cls("motor")} cx="200" cy={motorY} r="8" />
      <ellipse className={cls("motor")} cx="200" cy={propY} rx={a.motors > 1 ? 0 : 40} ry="3.5" />
      {/* шасси */}
      <g className={cls("gear", a.gear === "tail")}>
        <rect x="170" y="86" width="9" height="17" rx="3" />
        <rect x="221" y="86" width="9" height="17" rx="3" />
        <circle cx="200" cy="283" r="4" />
      </g>
      <g className={cls("gear", a.gear === "nose")}>
        <circle cx="200" cy="50" r="5" />
        <rect x="166" y="146" width="9" height="17" rx="3" />
        <rect x="225" y="146" width="9" height="17" rx="3" />
      </g>
      {/* трубка Пито на левом крыле, вне потока от винта */}
      <g className={cls("pitot", !isNone(s.airspeed))}>
        <line x1="96" y1="106" x2="96" y2="76" strokeWidth="3" className="line" />
        <circle cx="96" cy="74" r="3.5" />
      </g>
      {/* плата полётника с IMU и барометр */}
      <rect className={cls("board")} x="189" y="110" width="22" height="28" rx="3" strokeDasharray="3 2" />
      <circle className={cls("baro", !isNone(s.baro))} cx="200" cy="152" r="3.5" />
      {/* GPS и компас */}
      <rect className={cls("gps", !isNone(s.gps))} x="189" y="168" width="22" height="15" rx="3" />
      <rect className={cls("mag", !isNone(s.mag))} x="195" y="187" width="10" height="9" rx="2" />
      {/* грузовой отсек и камера */}
      <rect className={cls("payload", a.payload)} x="187" y="202" width="26" height="34" rx="4" strokeDasharray="4 3" />
      <circle className={cls("camera", a.camera)} cx="200" cy="64" r="6" />
    </svg>
  );
}
