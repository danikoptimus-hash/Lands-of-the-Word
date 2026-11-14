/**
 * Готовые аватарки и гербы (решение владельца 14.11): участник выбирает аватарку из набора игры, капитан — герб
 * команды. Своих фото игра не принимает и не хранит: ни загрузки, ни проверки уместности. В базе — только код
 * картинки: «a001»…«a103» — аватарки участников, «g01»…«g50» — гербы команд. Сами картинки лежат в сайте:
 * /img/avatars и /img/crests, крупная (320) и мелкая в подпапке s (128) — для списков.
 */
/** Набор только растёт: новая картинка получает следующий номер. Занятый номер не меняют — его уже выбрали участники. */
export const AVATAR_COUNT = 103;
export const CREST_COUNT = 50;

const codes = (prefix: string, count: number, width: number): string[] =>
  Array.from({ length: count }, (_, i) => prefix + String(i + 1).padStart(width, "0"));

export const AVATAR_CODES: readonly string[] = codes("a", AVATAR_COUNT, 3);
/**
 * Разделы набора аватарок — вкладки листа выбора: отрезки номеров «с какого по какой» (включительно), в порядке показа.
 * Козёл и петух (a101, a102) возвращены по слову владельца 14.11 («отличные были… игроки хотят эти аватарки») — они
 * стоят в конце «Животных» под новыми номерами, чтобы уже выбранные аватарки не сдвинулись. Так же добавлен портрет
 * a103 (просьба владельца 14.11): он в конце «Людей».
 */
export const AVATAR_GROUPS: ReadonlyArray<{ key: "people" | "animals" | "things"; ranges: ReadonlyArray<readonly [number, number]> }> = [
  { key: "people", ranges: [[1, 56], [103, 103]] }, { key: "animals", ranges: [[57, 86], [101, 102]] }, { key: "things", ranges: [[87, 100]] },
];
/** Раздел аватарки по её номеру (1…AVATAR_COUNT); вне разделов — «люди». */
export function avatarGroupOf(n: number): "people" | "animals" | "things" {
  return AVATAR_GROUPS.find((g) => g.ranges.some(([from, to]) => n >= from && n <= to))?.key ?? "people";
}
export const CREST_CODES: readonly string[] = codes("g", CREST_COUNT, 2);
const AVATAR_SET = new Set(AVATAR_CODES), CREST_SET = new Set(CREST_CODES);

export function isAvatarCode(v: unknown): v is string { return typeof v === "string" && AVATAR_SET.has(v); }
export function isCrestCode(v: unknown): v is string { return typeof v === "string" && CREST_SET.has(v); }

/** Адрес картинки по коду; null — если кода в наборе нет (тогда показывается кружок с буквой). */
export function avatarImage(code: string | null | undefined, size: "sm" | "lg" = "sm"): string | null {
  const dir = isAvatarCode(code) ? "avatars" : isCrestCode(code) ? "crests" : null;
  return dir ? `/img/${dir}/${size === "sm" ? "s/" : ""}${code}.webp` : null;
}
