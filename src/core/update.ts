// Обновление приложения: что проверять при запуске, что предлагать и как
// показать ход загрузки. Сеть, файлы и установщик — в Rust (src-tauri/src/update.rs).

import type { Settings } from "../api";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  sha256: string | null;
}

export interface UpdateInfo {
  version: string;
  current: string;
  newer: boolean;
  notes: string;
  page: string;
  published: string;
  /** установщик этой системы; нет — только страница выпуска */
  asset: UpdateAsset | null;
}

export type UpdatePhase = "idle" | "checking" | "none" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdateState {
  phase: UpdatePhase;
  info?: UpdateInfo;
  done?: number;
  total?: number;
  /** когда пошла загрузка — для «осталось» */
  startedAt?: number;
  /** скачанный установщик */
  path?: string;
  error?: string;
  /** проверка по кнопке: «последняя версия» и ошибки показываются */
  manual?: boolean;
  /** карточку закрыли «Позже» — до следующего запуска или кнопки в «Настройках» */
  hidden?: boolean;
}

/** Проверять ли при запуске: по умолчанию да, выключается в «Настройках». */
export function checkOnStart(settings: Settings): boolean {
  return settings.updateCheck !== false;
}

/** Показать ли карточку: версия новее и её не пропускали (по кнопке — всегда). */
export function shouldOffer(info: UpdateInfo, settings: Settings, manual: boolean): boolean {
  return info.newer && (manual || settings.updateSkip !== info.version);
}

/** Размер по-человечески: 212 МБ, 840 КБ. */
export function bytesText(n: number, mb: string, kb: string): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1)} ${mb}`;
  return `${Math.max(1, Math.round(n / 1024))} ${kb}`;
}

/** Сколько секунд осталось при нынешней скорости; рано судить — null. */
export function etaSeconds(done: number, total: number, elapsedMs: number): number | null {
  if (!total || done <= 0 || elapsedMs < 3000 || done >= total) return null;
  const speed = done / (elapsedMs / 1000);
  return Math.ceil((total - done) / speed);
}

/** Доля загрузки 0…1. */
export function fraction(done?: number, total?: number): number {
  if (!total || !done) return 0;
  return Math.min(1, done / total);
}

/** «Что нового» коротко: первые строки текста выпуска без пустых и markdown-заголовков. */
export function notesLines(notes: string, max = 6): { lines: string[]; more: boolean } {
  const all = notes
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\*\*/g, "").trim())
    .filter(Boolean);
  return { lines: all.slice(0, max), more: all.length > max };
}
