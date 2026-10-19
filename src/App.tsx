import { useEffect } from "react";

import { BoardView } from "./components/board/BoardView";
import { BoardPanel } from "./components/BoardPanel";
import { ComingSoon } from "./components/ComingSoon";
import { Hangar } from "./components/Hangar";
import { Header } from "./components/Header";
import { Rail } from "./components/Rail";
import { Settings } from "./components/Settings";
import { SetupDialog } from "./components/Setup";
import { Toasts } from "./components/Toasts";
import { getLanguage } from "./i18n";
import { useApp } from "./store";

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const section = useApp((s) => s.section);
  // смена языка — перерисовать всё: t() читается при рендере
  const language = useApp((s) => s.settings.language) ?? getLanguage();

  useEffect(() => {
    void init();
  }, [init]);

  // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) — правки самолёта; в поле ввода — его собственная отмена.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement | null)?.isContentEditable) return;
      const key = e.key.toLowerCase();
      const st = useApp.getState();
      if (key === "z" && !e.shiftKey) {
        if (st.canUndo()) st.undo();
        e.preventDefault();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        if (st.canRedo()) st.redo();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app" key={language}>
      <Rail />
      <Header />
      <main className="main">
        {!ready ? null : section === "hangar" ? (
          <Hangar />
        ) : section === "board" ? (
          <BoardView />
        ) : section === "settings" ? (
          <Settings />
        ) : (
          <ComingSoon section={section} />
        )}
      </main>
      <BoardPanel />
      <SetupDialog />
      <Toasts />
    </div>
  );
}
