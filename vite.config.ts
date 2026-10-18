import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tauri ждёт dev-сервер на постоянном порту (tauri.conf.json → devUrl).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    // 127.0.0.1, а не localhost: Vite иначе слушает только IPv6 (::1), а
    // WebView2 идёт на IPv4 — окно приложения видит «localhost refused».
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
