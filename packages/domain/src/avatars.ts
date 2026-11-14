/**
 * Готовые аватарки и гербы (решение владельца 14.11): участник выбирает аватарку из набора игры, капитан — герб
 * команды. Своих фото игра не принимает и не хранит: ни загрузки, ни проверки уместности. В базе — только код
 * картинки: «a001»…«a100» — аватарки участников, «g01»…«g50» — гербы команд. Сами картинки лежат в сайте:
 * /img/avatars и /img/crests, крупная (320) и мелкая в подпапке s (128) — для списков.
 */
export const AVATAR_COUNT = 100;
export const CREST_COUNT = 50;

const codes = (prefix: string, count: number, width: number): string[] =>
  Array.from({ length: count }, (_, i) => prefix + String(i + 1).padStart(width, "0"));

export const AVATAR_CODES: readonly string[] = codes("a", AVATAR_COUNT, 3);
/** Разделы набора аватарок — вкладки листа выбора: с какого номера по какой (включительно). */
export const AVATAR_GROUPS: ReadonlyArray<{ key: "people" | "animals" | "things"; from: number; to: number }> = [
  { key: "people", from: 1, to: 56 }, { key: "animals", from: 57, to: 86 }, { key: "things", from: 87, to: 100 },
];
export const CREST_CODES: readonly string[] = codes("g", CREST_COUNT, 2);
const AVATAR_SET = new Set(AVATAR_CODES), CREST_SET = new Set(CREST_CODES);

export function isAvatarCode(v: unknown): v is string { return typeof v === "string" && AVATAR_SET.has(v); }
export function isCrestCode(v: unknown): v is string { return typeof v === "string" && CREST_SET.has(v); }

/** Адрес картинки по коду; null — если кода в наборе нет (тогда показывается кружок с буквой). */
export function avatarImage(code: string | null | undefined, size: "sm" | "lg" = "sm"): string | null {
  const dir = isAvatarCode(code) ? "avatars" : isCrestCode(code) ? "crests" : null;
  return dir ? `/img/${dir}/${size === "sm" ? "s/" : ""}${code}.webp` : null;
}
