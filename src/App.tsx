import { useEffect } from "react";

import { BoardView } from "./components/board/BoardView";
import { BoardPanel } from "./components/BoardPanel";
import { ComingSoon } from "./components/ComingSoon";
import { Hangar } from "./components/Hangar";
import { Header } from "./components/Header";
import { Rail } from "./components/Rail";
import { Settings } from "./components/Settings";
import { Toasts } from "./components/Toasts";
import { useApp } from "./store";

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => s.ready);
  const section = useApp((s) => s.section);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app">
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
      <Toasts />
    </div>
  );
}
