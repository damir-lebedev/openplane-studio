import { Copy, FileCode, GraduationCap, Package, Plane, Plus, Trash, Triangle, Wind, Zap } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

import { COPTER_KITS, CopterProject, findCopterBuild, findCopterEnv } from "../core/copter";
import { findBoard, isNone, SENSOR_CATEGORIES } from "../core/manifest";
import { configHash, PlaneProject, sensorLabel, toFirmwareConfig } from "../core/project";
import { TEMPLATES } from "../core/templates";
import { locale, t } from "../i18n";
import { useApp } from "../store";
import { capLabel } from "./CopterView";
import { PlanePreview } from "./PlanePreview";
import { Choice, Modal } from "./ui";

function useFlashState(plane: PlaneProject): "never" | "flashed" | "changed" {
  const manifest = useApp((s) => s.manifest);
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    if (!manifest || !plane.lastFlash) return;
    let alive = true;
    void configHash(toFirmwareConfig(manifest, plane), plane.lastFlash.commit).then((h) => alive && setHash(h));
    return () => {
      alive = false;
    };
  }, [manifest, plane]);
  if (!plane.lastFlash) return "never";
  return hash && hash !== plane.lastFlash.configHash ? "changed" : "flashed";
}

function PlaneCard({ plane, onDelete }: { plane: PlaneProject; onDelete: () => void }) {
  const manifest = useApp((s) => s.manifest);
  const selectPlane = useApp((s) => s.selectPlane);
  const setSection = useApp((s) => s.setSection);
  const setStep = useApp((s) => s.setStep);
  const duplicatePlane = useApp((s) => s.duplicatePlane);
  const state = useFlashState(plane);
  const board = manifest ? findBoard(manifest, plane.board) : undefined;
  const sensors = manifest
    ? SENSOR_CATEGORIES.filter((c) => !isNone(plane.sensors[c]))
        .map((c) => sensorLabel(manifest, c, plane.sensors[c]))
        .join(", ")
    : "";
  const open = (review: boolean) => {
    selectPlane(plane.id);
    if (review) setStep("review");
    setSection("board");
  };
  return (
    <div className="card plane-card">
      <div className="art" onClick={() => open(false)} style={{ cursor: "pointer" }}>
        <PlanePreview plane={plane} height={104} />
      </div>
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          {plane.name}
        </h3>
        {state === "flashed" && <span className="badge ok">{t("прошит")}</span>}
        {state === "changed" && <span className="badge warn">{t("изменён")}</span>}
        {state === "never" && <span className="badge">{t("не прошит")}</span>}
      </div>
      <div className="kv">
        <span>{t("Плата")}</span>
        <span>{board ? t(board.title) : plane.board}</span>
        <span>{t("Датчики")}</span>
        <span>{sensors || "—"}</span>
        <span>{t("Прошит")}</span>
        <span>{plane.lastFlash ? new Date(plane.lastFlash.at).toLocaleString(locale()) : "—"}</span>
      </div>
      <div className="row" style={{ marginTop: "auto" }}>
        <button className="btn" onClick={() => open(false)}>
          {t("Настроить")}
        </button>
        <button className="btn primary" onClick={() => open(true)}>
          <Zap size={15} />
          {t("Прошить")}
        </button>
        <div className="grow" />
        <button className="btn ghost small" title={t("Дублировать")} onClick={() => duplicatePlane(plane.id)}>
          <Copy size={15} />
        </button>
        <button className="btn ghost small" title={t("Удалить")} onClick={onDelete}>
          <Trash size={15} />
        </button>
      </div>
    </div>
  );
}

/** Квадрокоптер X сверху — картинка карточки. */
export function CopterArt({ size = 96 }: { size?: number }) {
  const arms = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  return (
    <svg width={size} height={size} viewBox="-50 -50 100 100" aria-hidden>
      {arms.map(([x, y], i) => (
        <g key={i}>
          <line x1={0} y1={0} x2={x * 28} y2={y * 28} stroke="#3c6a8c" strokeWidth={6} strokeLinecap="round" />
          <circle cx={x * 28} cy={y * 28} r={17} fill="rgba(111,230,255,0.08)" stroke="#6fe6ff" strokeWidth={1.5} />
          <circle cx={x * 28} cy={y * 28} r={4} fill="#1c9fd3" />
        </g>
      ))}
      <rect x={-11} y={-15} width={22} height={30} rx={5} fill="#16263a" stroke="#6fe6ff" strokeWidth={1.5} />
      <path d="M0 -11 l5 7 h-10z" fill="#6fe6ff" />
    </svg>
  );
}

function CopterCard({ copter, onDelete }: { copter: CopterProject; onDelete: () => void }) {
  const manifest = useApp((s) => s.manifest);
  const selectCopter = useApp((s) => s.selectCopter);
  const setSection = useApp((s) => s.setSection);
  const duplicatePlane = useApp((s) => s.duplicatePlane);
  const env = findCopterEnv(manifest, copter.board);
  const build = findCopterBuild(manifest, env?.build);
  const open = () => {
    selectCopter(copter.id);
    setSection("copter");
  };
  const changed = copter.lastFlash && copter.lastFlash.board !== copter.board;
  return (
    <div className="card plane-card">
      <div className="art" onClick={open} style={{ cursor: "pointer" }}>
        <CopterArt />
      </div>
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          {copter.name}
        </h3>
        {env?.needsBoardDump ? (
          <span className="badge warn">{t("нужна распиновка")}</span>
        ) : changed ? (
          <span className="badge warn">{t("изменён")}</span>
        ) : copter.lastFlash ? (
          <span className="badge ok">{t("прошит")}</span>
        ) : (
          <span className="badge">{t("не прошит")}</span>
        )}
      </div>
      <div className="kv">
        <span>{t("Коптер")}</span>
        <span>{build ? t(build.title) : t("Квадрокоптер")}</span>
        <span>{t("Плата")}</span>
        <span>{env ? t(env.title) : copter.board || "—"}</span>
        <span>{t("Видео")}</span>
        <span>{t("потолок {cap}", { cap: capLabel(copter.vtxMaxPowerMw) })}</span>
        <span>{t("Прошит")}</span>
        <span>{copter.lastFlash ? new Date(copter.lastFlash.at).toLocaleString(locale()) : "—"}</span>
      </div>
      <div className="row" style={{ marginTop: "auto" }}>
        <button className="btn primary" onClick={open}>
          {t("Открыть")}
        </button>
        <div className="grow" />
        <button className="btn ghost small" title={t("Дублировать")} onClick={() => duplicatePlane(copter.id)}>
          <Copy size={15} />
        </button>
        <button className="btn ghost small" title={t("Удалить")} onClick={onDelete}>
          <Trash size={15} />
        </button>
      </div>
    </div>
  );
}

function NewCopterDialog({ onClose }: { onClose: () => void }) {
  const createCopter = useApp((s) => s.createCopter);
  const [kind, setKind] = useState<string>(`kit:${COPTER_KITS[0].id}`);
  const [name, setName] = useState(t("Квадрик 7\""));
  const valid = name.trim().length > 0;
  const create = () => {
    if (!valid) return;
    createCopter(kind, name.trim());
    onClose();
  };
  return (
    <Modal onClose={onClose} width={680}>
      <h2>{t("Новый коптер")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("Коптер — это сборка прошивки и комплектующие. Его настройки (PID, тумблеры, видео) живут на плате, как в Betaflight; приложение прошивает и делает первую настройку.")}
      </p>
      <div className="field" style={{ margin: "16px 0" }}>
        <label>{t("Название")}</label>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} />
      </div>
      <div className="choices wide">
        {COPTER_KITS.map((kit) => (
          <Choice
            key={kit.id}
            icon={<CopterArt size={20} />}
            title={t(kit.title)}
            desc={t(kit.desc)}
            selected={kind === `kit:${kit.id}`}
            onClick={() => setKind(`kit:${kit.id}`)}
          />
        ))}
        <Choice
          icon={<Plus size={18} />}
          title={t("С нуля")}
          desc={t("Первая сборка коптера из прошивки, комплектующие впишете сами.")}
          selected={kind === "blank"}
          onClick={() => setKind("blank")}
        />
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          {t("Отмена")}
        </button>
        <button className="btn primary" disabled={!valid} onClick={create}>
          {t("Создать")}
        </button>
      </div>
    </Modal>
  );
}

const TEMPLATE_ICONS: Record<string, ReactNode> = {
  trainer: <Plane size={18} />,
  student: <GraduationCap size={18} />,
  thermal: <Wind size={18} />,
  delivery: <Package size={18} />,
};

function NewPlaneDialog({ onClose }: { onClose: () => void }) {
  const createPlane = useApp((s) => s.createPlane);
  const manifest = useApp((s) => s.manifest);
  const planes = useApp((s) => s.planes);
  const [kind, setKind] = useState<string>(planes.length ? "tpl:trainer" : "import");
  const [name, setName] = useState(planes.length ? "" : "Astro-Cargo");
  const valid = name.trim().length > 0 && !!manifest;
  const create = () => {
    if (!valid) return;
    createPlane(kind, name.trim());
    onClose();
  };
  return (
    <Modal onClose={onClose} width={760}>
      <h2>{t("Новый самолёт")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {t("Самолёт — это настройки платы, датчиков и тумблеров. Хранится в папке ангара, прошивается в плату.")}
      </p>
      <div className="field" style={{ margin: "16px 0" }}>
        <label>{t("Название")}</label>
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={t("Например, Astro-Cargo #2")}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </div>
      <div className="section-title" style={{ marginBottom: 8 }}>
        {t("С чего начать")}
        <small>{t("шаблон только заполняет ответы — мастер всё равно проведёт по шагам")}</small>
      </div>
      <div className="choices wide">
        {TEMPLATES.map((tpl) => (
          <Choice
            key={tpl.id}
            icon={TEMPLATE_ICONS[tpl.id]}
            title={t(tpl.title)}
            desc={
              <>
                {t(tpl.desc)}
                <span className="tpl-for">{t(tpl.forWhom)}</span>
              </>
            }
            selected={kind === `tpl:${tpl.id}`}
            onClick={() => setKind(`tpl:${tpl.id}`)}
          />
        ))}
        <Choice
          icon={<Triangle size={18} />}
          title={t("Летающее крыло")}
          desc={t("Элевоны вместо элеронов и руля высоты — скоро в прошивке.")}
          disabled
        />
      </div>
      <div className="choices wide" style={{ marginTop: 10 }}>
        <Choice
          icon={<FileCode size={18} />}
          title={t("Из прошивки как есть")}
          desc={t("Берёт всё из твоих Config.h, Controls.h и SensorSelection.h: плату, датчики, тумблеры, числа.")}
          selected={kind === "import"}
          onClick={() => setKind("import")}
        />
        <Choice
          icon={<Plus size={18} />}
          title={t("С нуля")}
          desc={t("Плата по умолчанию, простые датчики, тумблер режимов MANUAL / STABILIZE / ALT_HOLD. Пройдёшь все шаги.")}
          selected={kind === "blank"}
          onClick={() => setKind("blank")}
        />
      </div>
      {!manifest && (
        <p className="locked-note">{t("Нет описания прошивки — укажите папку исходников в «Настройках».")}</p>
      )}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          {t("Отмена")}
        </button>
        <button className="btn primary" disabled={!valid} onClick={create}>
          {t("Создать")}
        </button>
      </div>
    </Modal>
  );
}

export function Hangar() {
  const planes = useApp((s) => s.planes);
  const copters = useApp((s) => s.copters);
  const removePlane = useApp((s) => s.removePlane);
  const manifestError = useApp((s) => s.manifestError);
  const info = useApp((s) => s.info);
  const [creating, setCreating] = useState(false);
  const [creatingCopter, setCreatingCopter] = useState(false);
  const [deleting, setDeleting] = useState<PlaneProject | CopterProject | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t("Ангар")}</h1>
          <p>{t("Ваши самолёты и коптеры. Каждый — со своей платой, датчиками и тумблерами.")}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => setCreatingCopter(true)}>
            <Plus size={16} />
            {t("Новый коптер")}
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            <Plus size={16} />
            {t("Новый самолёт")}
          </button>
        </div>
      </div>
      {manifestError && (
        <div className="issue warning" style={{ marginBottom: 18 }}>
          <div className="grow">{manifestError}</div>
        </div>
      )}
      <div className="planes">
        {planes.map((p) => (
          <PlaneCard key={p.id} plane={p} onDelete={() => setDeleting(p)} />
        ))}
        {copters.map((c) => (
          <CopterCard key={c.id} copter={c} onDelete={() => setDeleting(c)} />
        ))}
        <div className="card plane-card add split">
          <button onClick={() => setCreating(true)}>
            <Plus size={26} />
            {t("Новый самолёт")}
          </button>
          <button onClick={() => setCreatingCopter(true)}>
            <Plus size={26} />
            {t("Новый коптер")}
          </button>
        </div>
      </div>
      {info && (
        <p className="hint" style={{ marginTop: 24 }}>
          {t("Папка ангара: {dir}", { dir: info.hangar_dir })}
        </p>
      )}
      {creating && <NewPlaneDialog onClose={() => setCreating(false)} />}
      {creatingCopter && <NewCopterDialog onClose={() => setCreatingCopter(false)} />}
      {deleting && (
        <Modal onClose={() => setDeleting(null)} width={480}>
          <h2>{t("Удалить «{name}»?", { name: deleting.name })}</h2>
          <p className="muted">{t("Папка проекта переедет в Hangar/.trash — её можно вернуть вручную.")}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDeleting(null)}>
              {t("Отмена")}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                void removePlane(deleting.id);
                setDeleting(null);
              }}
            >
              {t("Удалить")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
