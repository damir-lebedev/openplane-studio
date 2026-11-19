// Сторож: эффект без фигурных скобок возвращает React'у значение выражения как
// «функцию очистки». В новом Android WebView scrollIntoView()/scrollTo() возвращают
// Promise — уход с вкладки ронял всё приложение («l is not a function», P48 b).
// Разрешены только `() => () => …` (очистка) и `setX(…)` (useState возвращает undefined).
// типов Node в проекте нет — как в tips.test.ts
// @ts-ignore
import { readdirSync, readFileSync, statSync } from "node:fs";
// @ts-ignore
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return (readdirSync(dir) as string[]).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" ? [] : files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe("эффекты React", () => {
  it("без скобок — только очистка или setState", () => {
    const bad: string[] = [];
    for (const f of files("src")) {
      const s: string = readFileSync(f, "utf-8");
      for (const m of s.matchAll(/use(?:Layout)?Effect\(\s*\(\)\s*=>(?!\s*\{)\s*([^\n]{0,60})/g)) {
        const body = m[1];
        if (/^\(\)\s*=>/.test(body) || /^set[A-Z]\w*\(/.test(body)) continue;
        bad.push(`${f}:${s.slice(0, m.index).split("\n").length}: ${body}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
