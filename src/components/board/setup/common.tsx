// Общее для проверок мастера наладки: карточка проверки, запись «пройдено»,
// совпадает ли прошивка на плате с проектом.

import { ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

import { Identity } from "../../../api";
import { SetupCheckId } from "../../../core/live";
import { configHash, PlaneProject, toFirmwareConfig } from "../../../core/project";
import { useApp } from "../../../store";

export type CheckState = "ok" | "warn" | "fail" | "todo" | "off" | "run";

const ICONS: Record<CheckState, ReactNode> = {
  ok: <CircleCheck size={18} color="var(--ok)" />,
  warn: <TriangleAlert size={18} color="var(--warn)" />,
  fail: <CircleAlert size={18} color="var(--err)" />,
  todo: <Circle size={18} color="var(--text-3)" />,
  off: <CircleDashed size={18} color="var(--text-3)" />,
  run: <CircleDashed size={18} color="var(--accent)" className="spin-slow" />,
};

export function CheckCard({
  num,
  title,
  summary,
  state,
  open,
  onToggle,
  children,
}: {
  num: number;
  title: string;
  summary?: ReactNode;
  state: CheckState;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`check${open ? " open" : ""} ${state}`}>
      <button className="check-head" onClick={onToggle}>
        <span className="check-num">{num}</span>
        {ICONS[state]}
        <span className="check-title">{title}</span>
        {summary && <span className="check-sum">{summary}</span>}
        <span className="grow" />
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && <div className="check-body">{children}</div>}
    </div>
  );
}

/** Паспорт платы, с которой сейчас связь. */
export function useBoardIdentity(): Identity | null {
  const link = useApp((s) => s.link);
  const ports = useApp((s) => s.ports);
  return link.state === "open" && link.port ? ports[link.port]?.identity ?? null : null;
}

/**
 * Прошивка на плате против проекта: "same" — этот проект и без правок после
 * прошивки; "edited" — этот проект, но его меняли после прошивки; "other" —
 * на плате другая конфигурация; null — не знаем (нет связи).
 */
export function useFirmwareMatch(plane: PlaneProject): "same" | "edited" | "other" | null {
  const manifest = useApp((s) => s.manifest);
  const identity = useBoardIdentity();
  const [current, setCurrent] = useState<string | null>(null);
  const last = plane.lastFlash;

  useEffect(() => {
    let alive = true;
    if (!manifest || !last) {
      setCurrent(null);
      return;
    }
    void configHash(toFirmwareConfig(manifest, plane), last.commit).then((h) => alive && setCurrent(h));
    return () => {
      alive = false;
    };
  }, [manifest, plane, last]);

  if (!identity) return null;
  if (!last || identity.config !== last.configHash) return "other";
  if (current && current !== last.configHash) return "edited";
  return "same";
}

/** Отметка «проверка пройдена» в проекте самолёта. */
export function usePassed(id: SetupCheckId) {
  const plane = useApp((s) => s.current())!;
  const updatePlane = useApp((s) => s.updatePlane);
  const identity = useBoardIdentity();
  const record = plane.setup?.[id];
  const pass = (note?: string) =>
    updatePlane((p) => {
      p.setup = { ...(p.setup ?? {}), [id]: { at: new Date().toISOString(), config: identity?.config ?? "", note } };
    });
  const reset = () =>
    updatePlane((p) => {
      if (!p.setup) return;
      const next = { ...p.setup };
      delete next[id];
      p.setup = next;
    });
  return { record, pass, reset };
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** Самолёт сбоку или спереди для поз калибровки: level, nose-up, right-down, tail-up, park. */
export function PoseArt({ pose, active, done }: { pose: "level" | "nose-up" | "right-down" | "tail-up" | "park"; active?: boolean; done?: boolean }) {
  const side = pose !== "right-down";
  // Сбоку — поворот вокруг хвоста, стоящего у земли; сзади — вокруг фюзеляжа.
  const transform =
    pose === "nose-up"
      ? "translate(-34 22) rotate(-35) translate(44 -2)"
      : pose === "park"
        ? "translate(-40 18) rotate(-11) translate(44 -2)"
        : pose === "tail-up"
          ? "translate(0 16)"
          : pose === "right-down"
            ? "translate(0 -4) rotate(32)"
            : "translate(0 6)";
  return (
    <svg className={`pose${active ? " active" : ""}${done ? " done" : ""}`} viewBox="-60 -40 120 80" width="120" height="80">
      <line x1="-58" y1="30" x2="58" y2="30" stroke="var(--line-2)" strokeWidth="2" />
      <g transform={transform}>
        {side ? (
          <>
            {/* фюзеляж, крыло, киль, стабилизатор — вид сбоку, нос вправо */}
            <path d="M-44 -2 Q-10 -9 30 -5 Q44 -3 46 0 Q44 3 30 4 Q-10 6 -44 2 Z" fill="var(--panel-3)" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M-44 -2 L-50 -18 L-38 -18 L-32 -3 Z" fill="var(--panel-3)" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M-2 -2 L14 -2 L10 1 L-4 1 Z" fill="var(--accent)" opacity="0.7" />
            <circle cx="46" cy="0" r="2" fill="var(--accent)" />
          </>
        ) : (
          <>
            {/* вид сзади, как самолёт держит пилот: правое крыло справа */}
            <rect x="-56" y="-2" width="112" height="4" rx="2" fill="var(--panel-3)" stroke="var(--accent)" strokeWidth="1.5" />
            <circle cx="0" cy="0" r="7" fill="var(--panel-3)" stroke="var(--accent)" strokeWidth="1.5" />
            <path d="M-1.5 -7 L-1.5 -22 L1.5 -22 L1.5 -7 Z" fill="var(--accent)" />
            <text x="46" y="-8" fontSize="9" fill="var(--text-2)">
              П
            </text>
          </>
        )}
      </g>
      {pose === "tail-up" && (
        <text x="-58" y="-28" fontSize="9" fill="var(--text-2)">
          хвост поднят
        </text>
      )}
    </svg>
  );
}
