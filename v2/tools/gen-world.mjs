// Снимок мира по зерну: карта строится тем же генератором, что и в игре (packages/domain, generateMap),
// без сервера и базы. Нужен, чтобы проверять форму земли на других картах, а не только на «Осени».
// Запуск из корня репозитория (пакет domain должен быть собран: npm run build -w packages/domain):
//   node v2/tools/gen-world.mjs 12345 "Проба 12345" [команд=3] [перекрёстков=250] > v2/data/world_12345.json
import { generateMap } from "../../packages/domain/dist/index.js";

const seed = Number(process.argv[2]);
if (!Number.isFinite(seed)) { console.error("Укажите зерно карты (число)"); process.exit(1); }
const name = process.argv[3] ?? `Карта ${seed}`;
const teamCount = Number(process.argv[4] ?? 3);
const nodeCount = Number(process.argv[5] ?? 250);
const map = generateMap({ seed, teamCount, nodeCount });

const world = {
  format: 1,
  name,
  seed,
  // [q, r, местность, остров]
  hexes: [...map.hexes].sort((a, b) => a.r - b.r || a.q - b.q).map((h) => [h.q, h.r, h.terrain, h.island]),
  // [ключ, вид, тип города, книга, остров, у берега]
  nodes: [...map.nodes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => [
    n.id, n.kind === "city" ? "CITY" : n.kind === "start" ? "START" : "EMPTY", n.cityType ?? null, n.bookCode ?? null, n.island, n.coastal ? 1 : 0,
  ]),
  // [ключ, ключ]
  edges: map.edges.map((e) => [e.a, e.b]),
};
const lines = ["{", `  "format": ${world.format},`, `  "name": ${JSON.stringify(world.name)},`, `  "seed": ${world.seed},`];
for (const key of ["hexes", "nodes", "edges"]) {
  lines.push(`  "${key}": [`);
  lines.push(world[key].map((row) => "    " + JSON.stringify(row)).join(",\n"));
  lines.push(key === "edges" ? "  ]" : "  ],");
}
lines.push("}");
process.stdout.write(lines.join("\n") + "\n");
