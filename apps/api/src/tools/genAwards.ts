/**
 * Генерация значков наград через OpenAI Images (решение владельца 29.10: «сгенерить через chat gpt очивки… минималистично,
 * красиво и под стиль игры»). Запускается на сервере, где лежит ключ:
 *   node apps/api/dist/tools/genAwards.js <папка> [код ...]
 * Пишет <папка>/<code>.png (1024×1024, прозрачный фон). Уже существующие файлы не перегенерирует.
 * Ключ берётся из OPENAI_API_KEY; в чат и в репозиторий ключ не попадает.
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AWARDS } from "@lotw/domain";

const STYLE = "Minimalist emblem badge for a Bible-themed map game for church youth. Flat vector style with a subtle engraved, hand-drawn feel. " +
  "Circular medallion: a warm parchment disc (#F2E7CF) with a thin bronze ring (#B9873F) and a slightly darker bronze outline (#7A4E17); the central symbol drawn in dark bronze (#7A4E17) with small gold highlights (#E0B35C). " +
  "Centered symbol, generous margins, no text, no letters, no numbers, no watermark, no shadow outside the disc. Transparent background outside the medallion.";

async function main() {
  const [dir, ...only] = process.argv.slice(2);
  if (!dir) { console.error("usage: genAwards <dir> [code ...]"); process.exit(2); }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error("OPENAI_API_KEY is not set"); process.exit(2); }
  mkdirSync(dir, { recursive: true });
  const list = AWARDS.filter((a) => !only.length || only.includes(a.code));
  for (const a of list) {
    const file = join(dir, `${a.code}.png`);
    if (existsSync(file) && !only.length) { console.log("skip", a.code); continue; }
    const prompt = `${STYLE} The symbol: ${a.symbol}.`;
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-image-1", prompt, n: 1, size: "1024x1024", quality: "medium", background: "transparent", output_format: "png" }),
    });
    if (!res.ok) { console.error("fail", a.code, res.status, (await res.text()).slice(0, 300)); continue; }
    const body = (await res.json()) as { data: Array<{ b64_json: string }> };
    writeFileSync(file, Buffer.from(body.data[0]!.b64_json, "base64"));
    console.log("ok", a.code);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
