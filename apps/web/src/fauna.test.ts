import { describe, expect, it } from "vitest";
import { traceWorld } from "./pages/Fauna";
import { hexCenter } from "./lib/hexmap";
import type { MapHexDto } from "./lib/api";

/** Остров-полумесяц: центр масс лежит в воде, а длинные рога выступают далеко — радиальный профиль их не накрывает. */
function crescent(): MapHexDto[] {
  const hexes: MapHexDto[] = [];
  for (let q = -9; q <= 9; q++) for (let r = -9; r <= 9; r++) {
    const c = hexCenter({ q, r }, 1);
    const d = Math.hypot(c.x, c.y), d2 = Math.hypot(c.x - 4, c.y);
    if (d <= 11 && d >= 6.5 && c.x < 5 && !(d2 < 8.5 && c.x > 0)) hexes.push({ q, r, terrain: "desert", island: "OT" });
  }
  return hexes;
}

describe("живность не заходит на сушу", () => {
  it("корабли и звери держатся вне гексов суши даже у острова с длинными мысами", () => {
    const size = 26, hexes = crescent();
    const land = new Set(hexes.map((h) => `${h.q},${h.r}`));
    expect(hexes.length).toBeGreaterThan(40);
    const onLand = (x: number, y: number) => {
      const qf = (Math.sqrt(3) / 3 * x - y / 3) / size, rf = (2 / 3 * y) / size;
      let q = Math.round(qf), r = Math.round(rf); const sf = -qf - rf, sr = Math.round(sf);
      const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(sr - sf);
      if (dq > dr && dq > ds) q = -r - sr; else if (dr > ds) r = -q - sr;
      return land.has(`${q},${r}`);
    };
    const traces = traceWorld(hexes, size, 4000, 0.25);
    const bad: string[] = [];
    for (const tr of traces) {
      if (tr.kind === "flock" || tr.kind === "gull") continue; // птицы летают над сушей
      for (const [x, y] of tr.samples) if (onLand(x, y)) bad.push(`${tr.kind} @ ${x.toFixed(0)},${y.toFixed(0)}`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

/** Два острова как в настоящей партии (карта игры 10.10): узкое море между ними, где корабли сходились у берега. */
const TWO_ISLANDS: Array<[number, number, "OT" | "NT"]> = [[0,0,"OT"],[1,0,"OT"],[0,1,"OT"],[-1,1,"OT"],[-1,0,"OT"],[0,-1,"OT"],[1,-1,"OT"],[1,-2,"OT"],[-2,1,"OT"],[1,1,"OT"],[-1,-1,"OT"],[0,2,"OT"],[2,-1,"OT"],[-2,2,"OT"],[-1,2,"OT"],[0,-2,"OT"],[2,-2,"OT"],[3,-1,"OT"],[2,0,"OT"],[-2,0,"OT"],[-3,2,"OT"],[-3,1,"OT"],[3,-2,"OT"],[1,2,"OT"],[-1,3,"OT"],[-3,0,"OT"],[-1,-2,"OT"],[0,-3,"OT"],[2,1,"OT"],[-2,-1,"OT"],[-2,3,"OT"],[2,-3,"OT"],[1,-3,"OT"],[-3,3,"OT"],[3,0,"OT"],[3,-3,"OT"],[-4,1,"OT"],[0,3,"OT"],[4,-1,"OT"],[-4,3,"OT"],[-1,-3,"OT"],[2,-4,"OT"],[2,2,"OT"],[-1,4,"OT"],[4,-3,"OT"],[1,3,"OT"],[-4,2,"OT"],[3,1,"OT"],[-3,4,"OT"],[-3,-1,"OT"],[-2,-2,"OT"],[3,-4,"OT"],[4,-2,"OT"],[-2,4,"OT"],[1,-4,"OT"],[-4,0,"OT"],[5,-3,"OT"],[-5,2,"OT"],[4,-4,"OT"],[-4,4,"OT"],[2,-5,"OT"],[-2,-3,"OT"],[3,-5,"OT"],[2,3,"OT"],[5,-2,"OT"],[3,2,"OT"],[0,4,"OT"],[0,-4,"OT"],[4,0,"OT"],[12,0,"NT"],[11,1,"NT"],[11,0,"NT"],[13,0,"NT"],[13,-1,"NT"],[12,-1,"NT"],[12,1,"NT"],[14,-1,"NT"],[14,0,"NT"],[13,-2,"NT"],[11,-1,"NT"],[10,2,"NT"],[12,-2,"NT"],[10,1,"NT"],[13,1,"NT"],[11,2,"NT"],[12,2,"NT"],[14,-2,"NT"],[13,2,"NT"],[10,0,"NT"],[15,-2,"NT"],[14,-3,"NT"],[14,1,"NT"],[11,3,"NT"],[10,3,"NT"],[9,2,"NT"],[10,-1,"NT"],[15,-1,"NT"],[9,1,"NT"],[11,-2,"NT"],[9,3,"NT"],[13,-3,"NT"],[12,-3,"NT"],[15,-3,"NT"],[12,3,"NT"],[8,2,"NT"],[9,0,"NT"],[15,0,"NT"],[9,4,"NT"],[16,-3,"NT"],[8,3,"NT"],[15,-4,"NT"],[13,-4,"NT"],[8,1,"NT"],[16,-2,"NT"],[11,-3,"NT"],[14,2,"NT"]];
const twoIslands = (): MapHexDto[] => TWO_ISLANDS.map(([q, r, island]) => ({ q, r, terrain: "desert", island }));

describe("корабли расходятся", () => {
  it("корабли не упираются друг в друга и не висят у кормы (замечание владельца 21.10)", { timeout: 300000 }, () => {
    const size = 26, step = 1 / 24, hexes = twoIslands();
    const L: Record<string, number> = { sloop: size * 0.95, cog: size * 1.35, ship: size * 1.9 };
    const speed: Record<string, number> = { sloop: size * 0.24, cog: size * 0.19, ship: size * 0.16 };
    const bad: string[] = [];
    for (const seed of [4, 6, 8]) {
      const traces = traceWorld(hexes, size, 5000, step, null, seed).filter((t) => t.kind in L);
      expect(traces.length).toBe(5);
      // Застревание: за 30 секунд на маршруте корабль прошёл меньше четверти своего пути на обычном ходу.
      const win = Math.round(30 / step);
      for (const tr of traces) for (let i = win; i < tr.samples.length; i += win) {
        const a = tr.samples[i - win]!, b = tr.samples[i]!;
        if (a[3] > 0 || b[3] > 0) continue; // пауза за краем — не в счёт
        const moved = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (moved < speed[tr.kind]! * 30 * 0.25) bad.push(`seed ${seed}: ${tr.kind} t=${(i * step).toFixed(0)} стоит`);
      }
      for (let a = 0; a < traces.length; a++) for (let b = a + 1; b < traces.length; b++) {
        const ta = traces[a]!, tb = traces[b]!, sum = L[ta.kind]! + L[tb.kind]!;
        let contact = 0, tail = 0;
        for (let i = 0; i < ta.samples.length; i++) {
          const sa = ta.samples[i]!, sb = tb.samples[i]!;
          if (sa[3] > 0 || sb[3] > 0) { contact = 0; tail = 0; continue; }
          const d = Math.hypot(sa[0] - sb[0], sa[1] - sb[1]);
          // Наложение корпусов дольше 10 секунд подряд — корабли «сцепились».
          contact = d < sum * 0.5 ? contact + 1 : 0;
          if (contact * step > 10) { bad.push(`seed ${seed}: ${ta.kind}+${tb.kind} t=${(i * step).toFixed(0)} сцепились`); contact = -1e9; }
          // Хвост: суда на одном курсе ближе суммы длин дольше 45 секунд — быстрый висит у кормы медленного, а не обходит.
          const dh = Math.abs(((sa[2] - sb[2]) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
          tail = d < sum && dh < 0.6 ? tail + 1 : 0;
          if (tail * step > 45) { bad.push(`seed ${seed}: ${ta.kind}+${tb.kind} t=${(i * step).toFixed(0)} висит за кормой, d=${d.toFixed(0)}`); tail = -1e9; }
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });
});
