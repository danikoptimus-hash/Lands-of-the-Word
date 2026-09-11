// Ищет русский текст в JSX/строках, не обёрнутый в t(): грубая проверка перед релизом. node scripts/i18n-check.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const root = "apps/web/src";
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(p) && !/i18n|\/en\//.test(p)) files.push(p); } })(root);
let n = 0;
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return; // комментарии
    const code = line.replace(/t\((["'`])(?:(?!\1).)*\1/g, "").replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "");
    const jsx = code.match(/>\s*[^<>{}]*[А-Яа-яЁё][^<>{}]*</g);
    const str = code.match(/(["'`])[^"'`]*[А-Яа-яЁё][^"'`]*\1/g);
    const hits = [...(jsx ?? []), ...(str ?? [])].filter((h) => !/aria-|title=|placeholder=/.test(h));
    if (hits.length) { n++; console.log(`${f}:${i + 1}: ${hits.map((h) => h.trim().slice(0, 60)).join(" | ")}`); }
  });
}
console.log(`\n${n} строк с русским текстом вне t()`);
