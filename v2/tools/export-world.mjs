// Снимок мира для версии 2: только геометрия карты (гексы, перекрёстки, стороны), без людей и команд.
// Запуск из корня репозитория:
//   DATABASE_URL=postgresql://… node v2/tools/export-world.mjs "Осень" > v2/data/world_osen.json
// Позже этот же формат будет отдавать сервер (шаг 0.4 дорожной карты).
import { PrismaClient } from "@prisma/client";
import { isletRows, worldText } from "./islets.mjs";

const name = process.argv[2];
if (!name) { console.error("Укажите название игры"); process.exit(1); }
const prisma = new PrismaClient();
const game = await prisma.game.findFirst({ where: { name }, select: { id: true, name: true, mapSeed: true } });
if (!game) { console.error(`Игра «${name}» не найдена`); process.exit(1); }

const [hexes, nodes, edges] = await Promise.all([
  prisma.mapHex.findMany({ where: { gameId: game.id }, orderBy: [{ r: "asc" }, { q: "asc" }] }),
  prisma.mapNode.findMany({ where: { gameId: game.id }, orderBy: { key: "asc" } }),
  prisma.mapEdge.findMany({ where: { gameId: game.id }, orderBy: [{ aKey: "asc" }, { bKey: "asc" }] }),
]);

const world = {
  name: game.name,
  // зерно карты: от него зависят мелкие детали рельефа
  seed: game.mapSeed ?? 0,
  // [q, r, местность, остров]
  hexes: hexes.map((h) => [h.q, h.r, h.terrain, h.island]),
  // [ключ, вид, тип города, книга, остров, у берега]
  nodes: nodes.map((n) => [n.key, n.kind, n.cityType, n.bookCode, n.island, n.coastal ? 1 : 0]),
  // [ключ, ключ]
  edges: edges.map((e) => [e.aKey, e.bKey]),
  // [x, z, r, картинка, охват, каменоломня] — малые острова, метры
  islets: isletRows(hexes),
};
process.stdout.write(worldText(world));
await prisma.$disconnect();
