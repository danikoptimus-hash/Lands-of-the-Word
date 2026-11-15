// Заранее сжатые файлы сборки: рядом с каждым текстовым файлом кладутся .br (brotli) и .gz. Сервер отдаёт их готовыми
// (apps/api/src/app.ts, preCompressed). Запускается в конце `npm run build` пакета apps/web; зависимостей нет.
// Ревизия скорости 15.11: главный файл программы — 572 КБ в gzip «на лету» и 384 КБ в brotli.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = process.argv[2] ?? "dist";
const TEXT = /\.(js|css|html|svg|json|webmanifest|txt|xml)$/;
let files = 0, raw = 0, br = 0;
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!TEXT.test(name) || st.size < 1024) continue;
    const buf = readFileSync(p);
    const b = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    const g = gzipSync(buf, { level: 9 });
    // Сжатая копия кладётся, только если она заметно меньше исходника.
    if (b.length < buf.length * 0.95) writeFileSync(p + ".br", b);
    if (g.length < buf.length * 0.95) writeFileSync(p + ".gz", g);
    files++; raw += buf.length; br += b.length;
  }
})(root);
console.log(`сжато заранее: ${files} файлов, ${(raw / 1024).toFixed(0)} КБ → ${(br / 1024).toFixed(0)} КБ (brotli)`);
