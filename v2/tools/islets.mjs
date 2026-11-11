// Малые острова для снимка мира: та же раскладка, что на сайте (packages/domain, generateIslets) —
// у участников сайта и приложения острова стоят в одних местах. Единица длины — метры (гекс 100 м).
import { fieldBoundsOf, generateIslets } from "../../packages/domain/dist/index.js";

const HEX_SIZE = 100;

/** hexes — [{q, r}, …] или [[q, r, …], …]. Возвращает строки [x, z, r, картинка, охват, каменоломня]. */
export function isletRows(hexes) {
  const field = hexes.map((h) => (Array.isArray(h) ? { q: h[0], r: h[1] } : { q: h.q, r: h.r }));
  const round = (v) => Math.round(v * 100) / 100;
  return generateIslets(field, HEX_SIZE, fieldBoundsOf(field, HEX_SIZE)).map((i) => [round(i.x), round(i.y), round(i.r), i.img, round(i.cover), i.quarry ? 1 : 0]);
}

/** Текст снимка мира (формат 2: с малыми островами). */
export function worldText(world) {
  const lines = ["{", `  "format": 2,`, `  "name": ${JSON.stringify(world.name)},`, `  "seed": ${world.seed},`];
  const keys = ["hexes", "nodes", "edges", "islets"];
  keys.forEach((key, index) => {
    lines.push(`  "${key}": [`);
    lines.push(world[key].map((row) => "    " + JSON.stringify(row)).join(",\n"));
    lines.push(index === keys.length - 1 ? "  ]" : "  ],");
  });
  lines.push("}");
  return lines.join("\n") + "\n";
}
