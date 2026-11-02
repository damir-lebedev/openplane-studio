// «Меню в очках» (CMS, пункт 151): как войти стиками — картинка двух
// стиков, и тренажёр — тот же экран, что нарисует прошивка, клавишами или
// кнопками. Правки тренажёра на плату не уходят.

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerUpLeft, Menu } from "lucide-react";
import { KeyboardEvent, useState } from "react";

import { MenuExit, MenuKey, menuChanges, menuPress, menuScreen, menuStart } from "../../core/osdMenu";
import { t } from "../../i18n";
import { useCopterBoard } from "./common";

// Стик: квадрат хода и точка; x, y — −1…1 (y + — от себя / газ вверх).
function Gimbal({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <figure className="cms-gimbal">
      <svg viewBox="-50 -50 100 100" width="96" height="96" aria-hidden>
        <rect x="-44" y="-44" width="88" height="88" rx="14" className="cms-gimbal-box" />
        <line x1="-44" y1="0" x2="44" y2="0" className="cms-gimbal-axis" />
        <line x1="0" y1="-44" x2="0" y2="44" className="cms-gimbal-axis" />
        <line x1="0" y1="0" x2={x * 34} y2={-y * 34} className="cms-gimbal-arm" />
        <circle cx={x * 34} cy={-y * 34} r="9" className="cms-gimbal-dot" />
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

const KEYS: Record<string, MenuKey> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Escape: "back", Backspace: "back" };

export function OsdMenuCard() {
  const board = useCopterBoard();
  const [state, setState] = useState(() => menuStart(board));
  const [exit, setExit] = useState<MenuExit>(null);
  if (!board.params.p_roll) return null;

  const press = (k: MenuKey) => {
    if (exit) {
      setExit(null);
      setState(menuStart(board));
      return;
    }
    const r = menuPress(board, state, k);
    setState(r.state);
    setExit(r.exit);
  };
  const onKey = (e: KeyboardEvent) => {
    const k = KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    press(k);
  };
  const changes = menuChanges(board, state);
  const rows = exit ? [] : menuScreen(board, state);

  return (
    <div className="card wide cms-card" data-testid="osd-menu-card">
      <div className="row" style={{ gap: 10 }}>
        <Menu size={18} />
        <h3 className="grow" style={{ margin: 0 }}>
          {t("Меню в очках")}
        </h3>
        <span className="mono dim">CMS</span>
      </div>
      <p className="sub">{t("PID, расходы, ползунки, канал и мощность VTX, учебные ограничения — стиками прямо в очках, без компьютера. Пока меню открыто, коптер не армится.")}</p>
      <div className="cms-layout">
        <div>
          <div className="cms-enter">
            <Gimbal x={-1} y={0} label={t("газ в центре, рыск влево")} />
            <Gimbal x={0} y={1} label={t("тангаж от себя")} />
          </div>
          <p className="hint">{t("Вход: без ARM подержать так полсекунды и отпустить стики в центр.")}</p>
          <ul className="cms-legend">
            <li>
              <ArrowUp size={13} /> <ArrowDown size={13} /> {t("тангаж — строка выше или ниже")}
            </li>
            <li>
              <ArrowRight size={13} /> {t("крен вправо — войти, значение больше")}
            </li>
            <li>
              <ArrowLeft size={13} /> {t("крен влево — значение меньше")}
            </li>
            <li>
              <CornerUpLeft size={13} /> {t("рыск влево — назад; из главного — выйти без сохранения")}
            </li>
          </ul>
          <p className="hint">{t("SAVE+EXIT — записать и применить. EXIT, ARM или потеря связи — всё изменённое в меню отменяется.")}</p>
        </div>
        <div>
          <div className="cms-screen" tabIndex={0} onKeyDown={onKey} aria-label={t("Тренажёр меню: стрелки, Esc — назад")}>
            {exit ? (
              <div className="cms-exit">{exit === "save" ? t("В очках: сохранено, меню закрыто.") : t("В очках: изменения отменены, меню закрыто.")}</div>
            ) : (
              rows.map((r, i) => (
                <div key={i} className="cms-row">
                  {r}
                </div>
              ))
            )}
          </div>
          <div className="cms-pad">
            <button className="btn ghost small" onClick={() => press("back")} title={t("рыск влево")}>
              <CornerUpLeft size={14} />
            </button>
            <button className="btn ghost small" onClick={() => press("up")} title={t("тангаж от себя")}>
              <ArrowUp size={14} />
            </button>
            <button className="btn ghost small" onClick={() => press("down")} title={t("тангаж на себя")}>
              <ArrowDown size={14} />
            </button>
            <button className="btn ghost small" onClick={() => press("left")} title={t("крен влево")}>
              <ArrowLeft size={14} />
            </button>
            <button className="btn ghost small" onClick={() => press("right")} title={t("крен вправо")}>
              <ArrowRight size={14} />
            </button>
          </div>
          <p className="hint">
            {changes.length
              ? t("Тренажёр: {list} — на плату не отправлено.", { list: changes.map((c) => `${c.name} ${c.from} → ${c.to}`).join(", ") })
              : t("Тренажёр: попробуйте стрелками — на плату ничего не уходит.")}
          </p>
        </div>
      </div>
    </div>
  );
}
