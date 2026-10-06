import { hexDistance, hexKey, hexNeighbors, type Hex } from "./hex.js";
import type { Island } from "./mapgen.js";
import { shuffle, type Rng } from "./random.js";

/**
 * Моря Библии на карте (решение владельца 06.10). Пролив между островами — Великое море (Средиземное: Чис. 34:6,
 * Нав. 1:4; Иона, плавания Павла). Внутри островов вырезаются внутренние моря по заветам: на Ветхом Завете Чермное
 * море (Исх. 14), Солёное море (Быт. 14:3, Нав. 3:16) и воды Меромские (Нав. 11:5); на Новом — Галилейское море
 * (Мф. 4:18; оно же Киннереф, Чис. 34:11, Тивериадское, Ин. 21:1, Геннисаретское озеро, Лк. 5:1) и Адриатическое
 * море (Деян. 27:27). Море открывается заданиями-вахтами; открытое море команда переходит один раз с берега на
 * противоположный берег.
 */
export interface SeaSpec { code: string; name: string; nameEn: string; island: Island; /** Сколько гексов занимает море: один (решение владельца 06.10: «1 море = 1 гекс»). */ hexes: number }
export const INLAND_SEAS: readonly SeaSpec[] = [
  { code: "red", name: "Чермное море", nameEn: "The Red Sea", island: "OT", hexes: 1 },
  { code: "salt", name: "Солёное море", nameEn: "The Salt Sea", island: "OT", hexes: 1 },
  { code: "merom", name: "Воды Меромские", nameEn: "The Waters of Merom", island: "OT", hexes: 1 },
  { code: "galilee", name: "Галилейское море", nameEn: "The Sea of Galilee", island: "NT", hexes: 1 },
  { code: "adria", name: "Адриатическое море", nameEn: "The Adriatic Sea", island: "NT", hexes: 1 },
];
/** Пролив между островами: гексов у него нет, берег — береговые узлы обоих островов. */
export const GREAT_SEA: SeaSpec = { code: "great", name: "Великое море", nameEn: "The Great Sea", island: "OT", hexes: 0 };
export const SEAS: readonly SeaSpec[] = [GREAT_SEA, ...INLAND_SEAS];
export const seaName = (code: string, locale: "ru" | "en" = "ru"): string => { const s = SEAS.find((x) => x.code === code); return s ? (locale === "en" ? s.nameEn : s.name) : code; };

/** Минимальное расстояние между гексами разных морей: два гекса суши между ними, чтобы берега не делились. */
const SEA_GAP = 3;

/**
 * Вырезает внутренние моря в поле острова: только «глубокие» гексы (все шесть соседей — на этом же острове),
 * чтобы море не выходило к проливу и остров оставался связным кольцом суши вокруг него. Каждое море — один гекс
 * (решение владельца 06.10); берег — его шесть углов. Возвращает код моря по гексу.
 */
export function carveSeas(rng: Rng, field: Hex[], specs: readonly SeaSpec[]): Map<string, string> {
  const fieldSet = new Set(field.map(hexKey));
  const deep = (h: Hex) => hexNeighbors(h).every((n) => fieldSet.has(hexKey(n)));
  const out = new Map<string, string>();
  const taken: Hex[] = [];
  const farFromOthers = (h: Hex, own: Hex[]) => taken.every((t) => own.includes(t) || hexDistance(h, t) >= SEA_GAP);
  for (const spec of specs) {
    let best: Hex[] = [];
    for (const seed of shuffle(rng, field.filter((h) => deep(h) && farFromOthers(h, [])))) {
      const blob: Hex[] = [seed];
      // Растим пятно случайными соседями, пока не наберём нужный размер.
      let guard = 0;
      while (blob.length < spec.hexes && guard++ < 40) {
        const cands = shuffle(rng, blob.flatMap((b) => hexNeighbors(b)).filter((n) => deep(n) && !blob.some((b) => hexKey(b) === hexKey(n)) && farFromOthers(n, blob)));
        if (!cands.length) break;
        blob.push(cands[0]!);
      }
      if (blob.length > best.length) best = blob;
      if (best.length >= spec.hexes) break;
    }
    if (best.length < 1) continue;
    for (const h of best) { out.set(hexKey(h), spec.code); taken.push(h); }
  }
  return out;
}
