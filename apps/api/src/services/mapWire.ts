import { createHash } from "node:crypto";

/**
 * Карта команды «на провод» (ревизия скорости, этап 2). В полной карте текст дела — название, описание, направление —
 * вложен в каждую сторону: из 440 КБ ответа 172 КБ были одними и теми же текстами (сторон 282, разных текстов 70), ещё
 * 20 КБ — одинаковые номера команды и игры в каждой стороне. Здесь тексты дел отдаются один раз справочником `deedTexts`,
 * а у стороны остаётся ключ `deedKey`; номера команды и игры у сторон не шлются (приложение их не читает).
 *
 * Ключ — отпечаток самого текста: одинаковые тексты дают один ключ, а у дела с подстановкой книги или глав — свой на
 * каждую подстановку. От порядка сторон ключ не зависит, поэтому «разница» двух карт остаётся маленькой.
 *
 * Формат включается по просьбе приложения (заголовок `X-Lotw-Wire: 2`, у канала событий — `?w=2`): приложение прежней
 * версии, которое ещё не обновилось после выкладки, получает карту и «разницу» в прежнем виде.
 */
export const WIRE = "2";

const keys = new Map<string, string>();
function deedKey(deed: unknown): string {
  const json = JSON.stringify(deed);
  let k = keys.get(json);
  if (!k) {
    if (keys.size > 5000) keys.clear();
    k = createHash("sha1").update(json).digest("base64url").slice(0, 10);
    keys.set(json, k);
  }
  return k;
}

/** Стороны без вложенного текста дела и справочник текстов к ним. */
export function wireTasks<T extends { deed: unknown }>(tasks: T[]): { tasks: Array<Omit<T, "deed" | "teamId" | "gameId"> & { deedKey: string }>; deedTexts: Record<string, T["deed"]> } {
  const deedTexts: Record<string, T["deed"]> = {};
  const out = tasks.map((t) => {
    const { deed, teamId: _team, gameId: _game, ...rest } = t as T & { teamId?: unknown; gameId?: unknown };
    const key = deedKey(deed);
    deedTexts[key] ??= deed;
    return { ...rest, deedKey: key } as Omit<T, "deed" | "teamId" | "gameId"> & { deedKey: string };
  });
  return { tasks: out, deedTexts };
}
