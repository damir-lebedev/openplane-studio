// Общее для вкладок коптера: плата на связи, живые кадры, строка настройки
// с умолчанием и единицами, панель «не сохранено».

import { CircleAlert, LoaderCircle, RotateCcw, Save, Undo2 } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

import { CopterLive } from "../../api";
import { CopterParam, isDefault, ParamValue, checkValue } from "../../core/copterParams";
import { isFresh } from "../../core/live";
import { t } from "../../i18n";
import { useApp } from "../../store";

/** Коптер с нашей прошивкой на связи и не заармлен — можно менять. */
export function useCopterLink() {
  const link = useApp((s) => s.link);
  const ports = useApp((s) => s.ports);
  const identity = link.state === "open" && link.port ? ports[link.port]?.identity : null;
  const copter = identity?.vehicle === "copter";
  return { open: link.state === "open", copter, identity, armed: !!identity?.armed, port: link.port };
}

/** Живой кадр коптера или null, если плата молчит дольше 1,5 с. */
export function useCopterLive(): CopterLive | null {
  const live = useApp((s) => s.clive);
  const at = useApp((s) => s.cliveAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return live && isFresh(at) ? live : null;
}

/** Настройки с платы: подключился коптер — прочитать их один раз. */
export function useCopterBoard() {
  const board = useApp((s) => s.copterBoard);
  const load = useApp((s) => s.copterLoad);
  const { copter } = useCopterLink();
  useEffect(() => {
    if (copter && !board.header && !board.loading && !board.errors.params) void load();
  }, [copter, board.header, board.loading, board.errors.params, load]);
  return board;
}

/** Вкладке нужна плата: что показать вместо неё. null — плата готова. */
export function NeedBoard({ children }: { children: ReactNode }) {
  const { open, copter } = useCopterLink();
  const board = useCopterBoard();
  const fcBf = useApp((s) => Object.values(s.fc).some((f) => f.variant === "BTFL"));
  if (!open || !copter) {
    return (
      <div className="card need-board">
        <CircleAlert size={22} color="var(--warn)" />
        <div>
          <h3>{t("Коптер не подключён")}</h3>
          <p className="sub">
            {fcBf && !copter
              ? t("На плате Betaflight. Прошейте её нашей прошивкой на вкладке «Коптер» — распиновку и родную прошивку приложение сохранит само.")
              : t("Настройки живут на плате, как в Betaflight. Подключите коптер с прошивкой OpenPlane по USB — вкладка оживёт сама.")}
          </p>
        </div>
      </div>
    );
  }
  if (!board.header) {
    return (
      <div className="card need-board">
        {board.loading ? <LoaderCircle className="spin" size={22} /> : <CircleAlert size={22} color="var(--warn)" />}
        <div>
          <h3>{board.loading ? t("Читаю настройки с платы…") : t("Настройки не прочитались")}</h3>
          {board.errors.params && <p className="sub">{board.errors.params}</p>}
          {!board.loading && (
            <button className="btn" onClick={() => void useApp.getState().copterLoad()}>
              {t("Прочитать снова")}
            </button>
          )}
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/** Панель «изменения на плате не сохранены»: сохранить во флеш или отменить. */
export function UnsavedBar() {
  const board = useApp((s) => s.copterBoard);
  const save = useApp((s) => s.copterSave);
  const revert = useApp((s) => s.copterRevert);
  const { armed } = useCopterLink();
  const pending = Object.keys(board.pending).length;
  if (!board.unsaved && !pending && !board.errors.save) return null;
  return (
    <div className="unsaved-bar">
      <span className="grow">
        {pending
          ? t("Отправляю на плату…")
          : board.errors.save
            ? t("Не сохранилось: {e}", { e: board.errors.save })
            : t("Изменения уже работают на плате, но не сохранены: после перезагрузки вернутся прежние. Пока не сохранено, ARM запрещён.")}
      </span>
      <button className="btn" disabled={armed} onClick={() => void revert()}>
        <Undo2 size={15} />
        {t("Отменить")}
      </button>
      <button className="btn primary" disabled={armed || pending > 0} onClick={() => void save()}>
        <Save size={15} />
        {t("Сохранить")}
      </button>
    </div>
  );
}

/** Значение, которое показывать: отправленное (ещё без ответа) или с платы. */
export function shown(name: string, p: CopterParam | undefined): ParamValue | undefined {
  const pending = useApp.getState().copterBoard.pending;
  return name in pending ? pending[name] : p?.value;
}

/** Поле значения настройки: выбор, число, текст. Отправка — по Enter или уходу с поля. */
export function ParamInput({ p, width, compact }: { p: CopterParam; width?: number; compact?: boolean }) {
  const pending = useApp((s) => s.copterBoard.pending[p.name]);
  const error = useApp((s) => s.copterBoard.errors[p.name]);
  const set = useApp((s) => s.copterSet);
  const { armed } = useCopterLink();
  const value = pending ?? p.value;
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState<string | null>(null);
  useEffect(() => setText(String(value)), [value]);

  const send = (v: ParamValue) => {
    if (String(v) === String(p.value)) return;
    const why = checkValue(p, v);
    setBad(why ? t(why) : null);
    if (!why) void set(p.name, v);
  };

  const title = bad ?? error ?? undefined;
  const cls = `${bad || error ? " bad" : ""}${pending !== undefined ? " pending" : ""}`;
  if (p.type === "enum") {
    return (
      <select className={`select${cls}`} style={{ width }} disabled={armed} value={String(value)} title={title} onChange={(e) => send(e.target.value)}>
        {(p.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={`input${compact ? " compact" : ""}${cls}`}
      style={{ width: width ?? (p.type === "string" ? 180 : 90) }}
      disabled={armed}
      value={text}
      title={title}
      inputMode={p.type === "string" ? "text" : "decimal"}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => send(p.type === "string" ? text : text.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(String(value));
      }}
    />
  );
}

const FROM_TEXT: Record<CopterParam["from"], string> = {
  table: "",
  tune: "из модели коптера",
  build: "из сборки",
  battery: "из батареи",
};

/** Строка настройки: имя BF, описание, поле, единицы, умолчание и «вернуть». */
export function ParamRow({ p, title }: { p: CopterParam; title?: string }) {
  const set = useApp((s) => s.copterSet);
  const error = useApp((s) => s.copterBoard.errors[p.name]);
  const { armed } = useCopterLink();
  const def = isDefault(p);
  const from = FROM_TEXT[p.from];
  return (
    <div className={`prow${def ? "" : " changed"}`}>
      <div className="prow-text">
        <div className="prow-title">{title ?? p.text}</div>
        <div className="prow-name mono">
          {p.name}
          {title ? ` · ${p.text}` : ""}
          {p.scope !== "master" && <span className="prow-scope">{p.scope === "pid" ? t("в профиле PID") : t("в профиле расходов")}</span>}
        </div>
        {error && <div className="hint warn-text">{error}</div>}
      </div>
      <div className="prow-value">
        <ParamInput p={p} />
        {p.units && <span className="hint">{t(p.units)}</span>}
      </div>
      <div className="prow-default hint">
        {def ? (
          t("по умолчанию")
        ) : (
          <button className="btn ghost small" disabled={armed} title={t("Вернуть умолчание")} onClick={() => void set(p.name, p.default)}>
            <RotateCcw size={13} />
            {String(p.default)}
          </button>
        )}
        {from && <div>{t(from)}</div>}
      </div>
    </div>
  );
}

/** Список настроек с заголовком. */
export function ParamList({ title, sub, params }: { title?: string; sub?: string; params: CopterParam[] }) {
  if (!params.length) return null;
  return (
    <div className="card">
      {title && <h3>{title}</h3>}
      {sub && <p className="sub">{sub}</p>}
      {params.map((p) => (
        <ParamRow key={p.name} p={p} />
      ))}
    </div>
  );
}

/** Выбор профиля PID или расходов (0…3) — сразу на плате. */
export function ProfilePicker({ kind }: { kind: "profile" | "rateprofile" }) {
  const header = useApp((s) => s.copterBoard.header);
  const cmd = useApp((s) => s.copterCommand);
  const load = useApp((s) => s.copterLoad);
  const { armed } = useCopterLink();
  if (!header) return null;
  const current = kind === "profile" ? header.profile : header.rateprofile;
  return (
    <div className="seg">
      {Array.from({ length: header.profiles }, (_, i) => (
        <button
          key={i}
          className={i === current ? "on" : ""}
          disabled={armed}
          onClick={async () => {
            await cmd(`${kind} ${i}`);
            setTimeout(() => void load(), 200);   // значения другого профиля
          }}
        >
          {kind === "profile" ? t("Профиль {n}", { n: i + 1 }) : t("Расходы {n}", { n: i + 1 })}
        </button>
      ))}
    </div>
  );
}
