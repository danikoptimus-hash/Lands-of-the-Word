/**
 * Названия стартовых точек (решение владельца 16.09): команды начинают путь «из плена» — библейские пленения и иго,
 * по порядку номеров команд. Первые три — великие пленения, дальше — иго времён Судей.
 */
export const START_NAMES: ReadonlyArray<{ ru: string; en: string }> = [
  { ru: "Египетский плен", en: "Egyptian captivity" },
  { ru: "Вавилонский плен", en: "Babylonian captivity" },
  { ru: "Ассирийский плен", en: "Assyrian captivity" },
  { ru: "Филистимское иго", en: "Philistine yoke" },
  { ru: "Мадиамское иго", en: "Midianite yoke" },
  { ru: "Моавитское иго", en: "Moabite yoke" },
  { ru: "Аммонитское иго", en: "Ammonite yoke" },
  { ru: "Хананейское иго", en: "Canaanite yoke" },
];
/** Название стартовой точки команды по её номеру (с нуля); при большем числе команд — по кругу. */
export function startName(teamIndex: number, locale: "ru" | "en" = "ru"): string {
  const s = START_NAMES[((teamIndex % START_NAMES.length) + START_NAMES.length) % START_NAMES.length]!;
  return locale === "en" ? s.en : s.ru;
}
