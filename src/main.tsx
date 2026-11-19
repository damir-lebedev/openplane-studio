import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { startLanguage, switchLanguage } from "./i18n";
import { useApp } from "./store";
import "./styles.css";
import "./live.css";
import "./phone.css";

// В режиме разработки — состояние приложения из DevTools (проверки через CDP).
if (import.meta.env.DEV) (window as unknown as { __app: typeof useApp }).__app = useApp;

// Словарь не русского языка — до первого кадра, чтобы интерфейс не мигнул по-русски.
void switchLanguage(startLanguage()).finally(() =>
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  ),
);
