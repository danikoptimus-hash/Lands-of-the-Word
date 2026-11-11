// Дописать (или пересчитать) малые острова в готовом снимке мира — без сервера и базы.
// Запуск из корня репозитория: node v2/tools/add-islets.mjs v2/data/world_osen.json
import { readFileSync, writeFileSync } from "node:fs";
import { isletRows, worldText } from "./islets.mjs";

const path = process.argv[2];
if (!path) { console.error("Укажите файл снимка мира"); process.exit(1); }
const world = JSON.parse(readFileSync(path, "utf8"));
world.islets = isletRows(world.hexes);
writeFileSync(path, worldText(world));
console.error(`${path}: малых островов ${world.islets.length}`);
