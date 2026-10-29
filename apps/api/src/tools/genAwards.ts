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
  // Какие модели картинок доступны ключу: берём лучшую из известных; имена печатаем, чтобы было видно, что есть.
  const headers = { "content-type": "application/json", authorization: `Bearer ${key}` };
  const models = await fetch("https://api.openai.com/v1/models", { headers });
  const names: string[] = models.ok ? ((await models.json()) as { data: Array<{ id: string }> }).data.map((m) => m.id) : [];
  const imageModels = names.filter((n) => /image|dall-e/i.test(n)).sort();
  console.log("image models:", imageModels.join(", ") || "(none listed)");
  const PREFER = ["gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini", "dall-e-3"];
  const model = process.env.AWARDS_MODEL || PREFER.find((m) => imageModels.includes(m)) || imageModels.find((m) => m.startsWith("gpt-image")) || "dall-e-3";
  console.log("using:", model);
  const gptImage = model.startsWith("gpt-image");
  const list = AWARDS.filter((a) => !only.length || only.includes(a.code));
  for (const a of list) {
    const file = join(dir, `${a.code}.png`);
    if (existsSync(file) && !only.length) { console.log("skip", a.code); continue; }
    const prompt = `${STYLE} The symbol: ${a.symbol}.`;
    const body = gptImage
      ? { model, prompt, n: 1, size: "1024x1024", quality: "medium", background: "transparent", output_format: "png" }
      : { model, prompt, n: 1, size: "1024x1024", quality: "standard", response_format: "b64_json" };
    const res = await fetch("https://api.openai.com/v1/images/generations", { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) { console.error("fail", a.code, res.status, (await res.text()).slice(0, 300)); continue; }
    const out = (await res.json()) as { data: Array<{ b64_json: string }> };
    writeFileSync(file, Buffer.from(out.data[0]!.b64_json, "base64"));
    console.log("ok", a.code);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
