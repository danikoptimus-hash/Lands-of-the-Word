import { onPublish, TEAM_ONLY, type GameEventType } from "./events.js";

/**
 * Готовые ответы для экранов команды (решение владельца 24.10: «команды, ленту тоже переделать… чтобы всё работало
 * хорошо»): состав, лента, испытания, положение, проходы, мир считаются один раз после изменения и хранятся в памяти,
 * запрос отдаёт готовое. Сброс — по событиям игры (publish): событие своей команды сбрасывает её ответ, общее — ответы
 * всех команд партии. Одновременные запросы ждут один расчёт. Страховка — не старше минуты.
 * Карта команды устроена так же, но отдельно (services/teamMap.ts): она ещё и рассылается разницей.
 */
interface ViewDef<T> {
  /** Ответ один на партию (положение) или свой у каждой команды. */
  scope: "game" | "team";
  /** Какие события сбрасывают ответ; событие `game` сбрасывает всё всегда. */
  events: readonly GameEventType[];
  compute: (gameId: string, teamId: string) => Promise<T>;
}
const TTL_MS = 60_000;
const defs = new Map<string, ViewDef<unknown>>();
const cache = new Map<string, { gameId: string; at: number; value: Promise<unknown> }>();
const keyOf = (name: string, def: ViewDef<unknown>, gameId: string, teamId: string) => `${name}:${def.scope === "game" ? gameId : teamId}`;

export function defineView<T>(name: string, def: ViewDef<T>): (gameId: string, teamId: string) => Promise<T> {
  defs.set(name, def as ViewDef<unknown>);
  return (gameId, teamId) => getView<T>(name, gameId, teamId);
}

export function getView<T>(name: string, gameId: string, teamId: string): Promise<T> {
  const def = defs.get(name);
  if (!def) throw new Error(`view ${name} is not defined`);
  const key = keyOf(name, def, gameId, teamId);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = def.compute(gameId, teamId);
  const entry = { gameId, at: Date.now(), value };
  cache.set(key, entry);
  value.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
  return value as Promise<T>;
}

/** Сброс ответов партии: только одной команды (событие её команды) или всех. Экспорт — для тестов и правок напрямую в базе. */
export function invalidateViews(gameId: string, teamId?: string, types?: readonly GameEventType[]): void {
  for (const [name, def] of defs) {
    if (types && !types.includes("game") && !def.events.some((e) => types.includes(e))) continue;
    if (def.scope === "game") { cache.delete(`${name}:${gameId}`); continue; }
    if (teamId) { cache.delete(`${name}:${teamId}`); continue; }
    for (const [key, entry] of cache) if (key.startsWith(`${name}:`) && entry.gameId === gameId) cache.delete(key);
  }
}
onPublish((gameId, ev) => invalidateViews(gameId, ev.teamId && TEAM_ONLY.has(ev.type) ? ev.teamId : undefined, [ev.type]));
