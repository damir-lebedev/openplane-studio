// Анкета первого запуска (P01): по одному крупному вопросу на экран, с
// плавным переходом, справа — дрон, который собирается по ответам. Итог —
// профиль пилота и наборы функций (что видно в приложении). Пропустить можно:
// тогда «Основа» и мастер, остальное находит поиск. Открывается заново из
// «Настроек» — с прежними ответами.

import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { Component, lazy, ReactNode, Suspense, useState } from "react";

import {
  CLASSES,
  CRAFTS,
  CraftClass,
  DroneLook,
  droneLook,
  EXPERIENCES,
  Goal,
  GOALS,
  makeProfile,
  PACKS,
  PilotAnswers,
  profileOf,
} from "../../core/pilot";
import { t } from "../../i18n";
import { useApp } from "../../store";

const Drone3D = lazy(() => import("./Drone3D").then((m) => ({ default: m.Drone3D })));

const STEPS = 5;

class Fallback extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Без WebGL (и в тестах) — дрон рисунком сверху. */
function DroneFlat({ look }: { look: DroneLook }) {
  const arm = 38 * look.size;
  const prop = 22 * look.size;
  return (
    <svg className="onb-flat" viewBox="-100 -100 200 200" aria-hidden>
      {!look.quad && !look.wing && <rect x={-16} y={-16} width={32} height={32} rx={4} className="onb-flat-board" />}
      {look.wing && (
        <g transform={look.quad ? "translate(30 -40) scale(0.6)" : undefined}>
          <path d="M0 -40 L90 20 L90 34 L0 6 L-90 34 L-90 20 Z" className="onb-flat-body" />
        </g>
      )}
      {look.quad && (
        <g transform={look.wing ? "translate(-30 30) scale(0.8)" : undefined}>
          {[45, 135, 225, 315].map((a) => {
            const x = Math.cos((a * Math.PI) / 180) * arm;
            const y = Math.sin((a * Math.PI) / 180) * arm;
            return (
              <g key={a}>
                <line x1={0} y1={0} x2={x} y2={y} className="onb-flat-arm" />
                <circle cx={x} cy={y} r={prop} className={`onb-flat-prop${look.spin ? " spin" : ""}`} />
                {look.ducts && <circle cx={x} cy={y} r={prop + 3} className="onb-flat-duct" />}
              </g>
            );
          })}
          <rect x={-12} y={-18} width={24} height={36} rx={5} className="onb-flat-body" />
          {look.gps && <circle cx={0} cy={12} r={6} className="onb-flat-gps" />}
          {look.camera && <rect x={-6} y={-24} width={12} height={8} rx={2} className="onb-flat-cam" />}
          {look.payload && <rect x={-10} y={-8} width={20} height={14} rx={2} className="onb-flat-cargo" />}
        </g>
      )}
    </svg>
  );
}

const hasWebGL = () => typeof WebGL2RenderingContext !== "undefined";

function Stage({ look }: { look: DroneLook }) {
  const flat = <DroneFlat look={look} />;
  return (
    <div className="onb-stage">
      {hasWebGL() ? (
        <Fallback fallback={flat}>
          <Suspense fallback={flat}>
            <Drone3D look={look} />
          </Suspense>
        </Fallback>
      ) : (
        flat
      )}
    </div>
  );
}

function Card({ title, desc, on, onClick, multi }: { title: string; desc?: string; on: boolean; onClick: () => void; multi?: boolean }) {
  return (
    <button className={`onb-card${on ? " on" : ""}`} role={multi ? "checkbox" : "radio"} aria-checked={on} onClick={onClick}>
      <span className="onb-card-title">
        {title}
        {on && <Check size={16} />}
      </span>
      {desc && <span className="onb-card-desc">{desc}</span>}
    </button>
  );
}

export function Onboarding() {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const setOnboarding = useApp((s) => s.setOnboarding);
  const setSection = useApp((s) => s.setSection);
  const before = settings.pilot;
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [a, setA] = useState<Partial<PilotAnswers>>(
    before && !before.skipped
      ? { experience: before.experience, craft: before.craft, classes: before.classes, goals: before.goals, hasDrone: before.hasDrone }
      : { classes: [], goals: [] },
  );
  const set = (patch: Partial<PilotAnswers>) => setA((x) => ({ ...x, ...patch }));
  const go = (to: number) => {
    setDir(to > step ? "fwd" : "back");
    setStep(to);
  };
  const look = droneLook(a, step);

  const classes = (a.classes ?? []).filter((c) => a.craft === "both" || CLASSES.find((x) => x.id === c)?.craft === a.craft);
  const answers: PilotAnswers = {
    experience: a.experience ?? "new",
    craft: a.craft ?? "both",
    classes,
    goals: a.goals ?? [],
    hasDrone: a.hasDrone ?? null,
  };
  const profile = makeProfile(answers);

  const toggleClass = (c: CraftClass) => set({ classes: classes.includes(c) ? classes.filter((x) => x !== c) : [...classes, c] });
  const toggleGoal = (g: Goal) => {
    const goals = a.goals ?? [];
    set({ goals: goals.includes(g) ? goals.filter((x) => x !== g) : [...goals, g] });
  };

  const finish = async () => {
    await saveSettings({ pilot: { ...profile, showAll: before?.showAll } });
    setOnboarding(false);
    setSection("hangar");
  };
  const skip = async () => {
    // уже был профиль — ничего не меняем; не было — прежний режим без потерь
    if (!before) await saveSettings({ pilot: { ...profileOf(settings), skipped: true, at: new Date().toISOString() } });
    setOnboarding(false);
  };

  const canNext = step === 0 ? !!a.experience : step === 1 ? !!a.craft : step === 3 ? a.hasDrone !== undefined && a.hasDrone !== null : true;
  const shownClasses = CLASSES.filter((c) => a.craft === "both" || c.craft === a.craft);

  let body: ReactNode;
  if (step === 0) {
    body = (
      <>
        <h1>{t("Привет! Ты начинающий пилот?")}</h1>
        <p className="onb-sub">{t("Ответь на пару вопросов — приложение покажет только то, что нужно тебе. Остальное никуда не денется.")}</p>
        <div className="onb-cards">
          {EXPERIENCES.map((x) => (
            <Card key={x.id} title={t(x.title)} desc={t(x.desc)} on={a.experience === x.id} onClick={() => set({ experience: x.id })} />
          ))}
        </div>
      </>
    );
  } else if (step === 1) {
    body = (
      <>
        <h1>{t("На чём планируешь летать?")}</h1>
        <div className="onb-cards three">
          {CRAFTS.map((x) => (
            <Card key={x.id} title={t(x.title)} desc={t(x.desc)} on={a.craft === x.id} onClick={() => set({ craft: x.id })} />
          ))}
        </div>
        {a.craft && (
          <>
            <p className="onb-sub">{t("А какой? Можно несколько или ничего.")}</p>
            <div className="onb-cards small">
              {shownClasses.map((x) => (
                <Card key={x.id} multi title={t(x.title)} desc={t(x.desc)} on={classes.includes(x.id)} onClick={() => toggleClass(x.id)} />
              ))}
            </div>
          </>
        )}
      </>
    );
  } else if (step === 2) {
    body = (
      <>
        <h1>{t("Что будешь делать?")}</h1>
        <p className="onb-sub">{t("Можно несколько. Ничего не выбрал — останется «Основа».")}</p>
        <div className="onb-cards">
          {GOALS.map((x) => (
            <Card key={x.id} multi title={t(x.title)} desc={t(x.desc)} on={(a.goals ?? []).includes(x.id)} onClick={() => toggleGoal(x.id)} />
          ))}
        </div>
      </>
    );
  } else if (step === 3) {
    body = (
      <>
        <h1>{t("Дрон уже есть?")}</h1>
        <div className="onb-cards three">
          <Card title={t("Есть")} desc={t("Подключишь полётник — приложение узнает плату и прошивку")} on={a.hasDrone === true} onClick={() => set({ hasDrone: true })} />
          <Card title={t("Пока нет")} desc={t("Начни с симулятора; подберём дрон по ответам — в ангаре")} on={a.hasDrone === false} onClick={() => set({ hasDrone: false })} />
        </div>
        {a.hasDrone === true && <p className="onb-sub">{t("Дальше — ангар: подключи полётник по USB, и он появится сам.")}</p>}
      </>
    );
  } else {
    body = (
      <>
        <h1>
          <Sparkles size={26} /> {t("Твой набор")}
        </h1>
        <p className="onb-sub">{t("Вот что будет видно. Поменять можно в любой момент — в «Настройках», а поиск находит и скрытое.")}</p>
        <div className="onb-packs">
          {PACKS.map((p) => {
            const on = profile.packs.includes(p.id);
            return (
              <div key={p.id} className={`onb-pack${on ? " on" : ""}`}>
                <span className="onb-pack-dot">{on ? <Check size={13} /> : null}</span>
                <div>
                  <div className="onb-pack-title">{t(p.title)}</div>
                  <div className="onb-pack-desc">{t(p.desc)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <div className="onb" role="dialog" aria-label={t("Знакомство")}>
      <div className="onb-glow" />
      <div className="onb-left">
        <div className="onb-dots" aria-hidden>
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={i === step ? "on" : i < step ? "done" : ""} />
          ))}
        </div>
        <div key={step} className={`onb-step ${dir}`}>
          {body}
        </div>
        <div className="onb-actions">
          {step > 0 && (
            <button className="btn ghost" onClick={() => go(step - 1)}>
              <ArrowLeft size={16} />
              {t("Назад")}
            </button>
          )}
          <button className="btn ghost" onClick={() => void skip()}>
            {t("Пропустить")}
          </button>
          <div className="grow" />
          {step < STEPS - 1 ? (
            <button className="btn primary big" disabled={!canNext} onClick={() => go(step + 1)}>
              {t("Дальше")}
              <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn primary big" onClick={() => void finish()}>
              {t("Поехали")}
              <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
      <Stage look={look} />
    </div>
  );
}
