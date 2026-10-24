import sharp from "sharp";

/**
 * Аватарки (решение владельца 24.10): фото участника или команды сжимается до маленькой картинки и проверяется на
 * уместность через OpenAI (Moderation API принимает картинки; проверка на «портрет» владельцу не нужна — только
 * уместность). Хранится только сжатая копия: 256×256, WebP, без метаданных (геометки и модель телефона вырезаются
 * при сжатии). Без ключа OpenAI загрузка закрыта: проверка обязательна.
 */
export const AVATAR_SIZE = 256;
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;

export async function processAvatar(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: "none", limitInputPixels: 40_000_000 })
    .rotate() // по EXIF, затем метаданные не сохраняются
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toBuffer();
}

export interface ModerationResult { flagged: boolean; categories: Record<string, number> }
type Moderator = (image: Buffer) => Promise<ModerationResult>;

let apiKey: string | undefined;
let override: Moderator | null = null;
export function initModeration(key: string | undefined): void { apiKey = key; }
/** Подмена проверки в тестах. */
export function setModerationForTests(fn: Moderator | null): void { override = fn; }
export function moderationEnabled(): boolean { return Boolean(override || apiKey); }

/** Проверка картинки; исключение — если проверка недоступна (нет ключа, сеть, ошибка API): загрузку тогда не принимаем. */
export async function moderateImage(image: Buffer): Promise<ModerationResult> {
  if (override) return override(image);
  if (!apiKey) throw new Error("moderation disabled");
  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "omni-moderation-latest", input: [{ type: "image_url", image_url: { url: `data:image/webp;base64,${image.toString("base64")}` } }] }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`moderation ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ flagged: boolean; category_scores?: Record<string, number> }> };
  const r = body.results?.[0];
  if (!r) throw new Error("moderation: empty result");
  // Оставляем только заметные оценки — суперадмину для разбора.
  const categories = Object.fromEntries(Object.entries(r.category_scores ?? {}).filter(([, v]) => v >= 0.01).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  return { flagged: r.flagged, categories };
}
