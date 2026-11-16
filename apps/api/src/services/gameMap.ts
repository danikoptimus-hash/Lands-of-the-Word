import { prisma } from "../db.js";
import { onPublish } from "./events.js";

/**
 * Неизменная карта партии в памяти сервера (ревизия скорости, этап 2). Гексы, перекрёстки и дороги после генерации карты
 * не меняются, но читались из базы при каждом пересчёте карты каждой команды: 818 строк, и ещё раз — дороги и города
 * при досоздании сторон. Теперь они читаются один раз на партию.
 *
 * Здесь только то, что задаёт генерация: вид перекрёстка, книга и тип города, остров, берег. Изменяемое — разорён ли
 * город (`ruined`), уровень защиты, адресат — в память не кладётся и читается из базы, как раньше.
 * Память сбрасывается генерацией карты и событием `game`; на случай правки базы в обход игры — живёт не дольше пяти минут.
 */
const load = (gameId: string) => Promise.all([
  prisma.mapHex.findMany({ where: { gameId }, select: { q: true, r: true, terrain: true, rotation: true, island: true } }),
  prisma.mapNode.findMany({ where: { gameId }, select: { key: true, corner: true, q: true, r: true, kind: true, bookCode: true, cityType: true, teamIndex: true, island: true, coastal: true } }),
  prisma.mapEdge.findMany({ where: { gameId }, select: { aKey: true, bKey: true } }),
]).then(([hexes, nodes, edges]) => ({ hexes, nodes, edges }));
export type StaticMap = Awaited<ReturnType<typeof load>>;
const TTL_MS = 5 * 60_000, MAX_GAMES = 50;
const cache = new Map<string, { at: number; value: Promise<StaticMap> }>();

export function staticMap(gameId: string): Promise<StaticMap> {
  const hit = cache.get(gameId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = load(gameId);
  const entry = { at: Date.now(), value };
  cache.set(gameId, entry);
  value.catch(() => { if (cache.get(gameId) === entry) cache.delete(gameId); });
  if (cache.size > MAX_GAMES) { const oldest = [...cache].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) cache.delete(oldest[0]); }
  return value;
}
/** Сбросить память карты партии: карту сгенерировали заново или правили базу напрямую. */
export function dropStaticMap(gameId: string): void { cache.delete(gameId); }
onPublish((gameId, ev) => { if (ev.type === "game") dropStaticMap(gameId); });
