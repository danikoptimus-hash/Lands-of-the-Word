import { FOG_COLOR, HEX_SIZE, TERRAIN_COLOR, hexCenter, hexPoints } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";

export const IMG = {
  terrain: (t: string) => `/img/terrain/${t}.webp`,
  city: (type: string | null | undefined) => `/img/city/${type && type !== "" ? type : "village"}.webp`,
  start: (i: number) => `/img/start/${["babylon", "egypt", "wilderness", "assyria", "zin", "shipwreck"][i % 6]}.webp`,
};

/** Море вокруг острова: замощение текстурой воды на весь мир, рисуется под гексами. dim — приглушить (вид команды, туман). */
export function Sea({ size = HEX_SIZE, id, dim }: { size?: number; id: string; dim?: boolean }) {
  const tile = size * 6, R = 40000;
  return (
    <>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" width={tile} height={tile}>
          <image href="/img/brand/sea.webp" x={0} y={0} width={tile} height={tile} preserveAspectRatio="xMidYMid slice" />
        </pattern>
      </defs>
      <rect x={-R} y={-R} width={2 * R} height={2 * R} fill={`url(#${id})`} opacity={dim ? 0.3 : 1} />
    </>
  );
}

const TERRAINS = ["desert", "hills", "meadow", "mountains", "water", "oasis"];

/**
 * Слой гексов. Текстуры не вставляются в каждый гекс отдельной картинкой (270 картинок с обрезкой тяжело
 * рисовать на телефоне), а задаются паттернами: по одному на местность и поворот (6 × 6). Под паттерном —
 * цвет местности, поэтому карта видна сразу, ещё до загрузки текстур. Туман — тёмные гексы.
 */
export function HexTiles({ hexes, size = HEX_SIZE, clipId }: { hexes: MapHexDto[]; size?: number; clipId: string }) {
  const poly = hexPoints(size, 0.995);
  return (
    <>
      <defs>
        {TERRAINS.map((t) => Array.from({ length: 6 }, (_, r) => (
          <pattern key={`${t}${r}`} id={`${clipId}-${t}-${r}`} patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width={1} height={1}>
            <rect width={1} height={1} fill={TERRAIN_COLOR[t] ?? TERRAIN_COLOR.desert} />
            {/* Квадрат текстуры повёрнут вокруг центра и увеличен, чтобы закрыть углы гекса при любом повороте. */}
            <image href={IMG.terrain(t)} x={-0.2} y={-0.2} width={1.4} height={1.4} preserveAspectRatio="none" transform={`rotate(${r * 60} .5 .5)`} />
          </pattern>
        )))}
      </defs>
      {hexes.map((h) => {
        const c = hexCenter(h, size);
        if (!h.lit && h.lit !== undefined) return <polygon key={`f${h.q},${h.r}`} className="hex-fog" points={poly} transform={`translate(${c.x},${c.y})`} fill={FOG_COLOR} vectorEffect="non-scaling-stroke" />;
        const t = TERRAINS.includes(h.terrain ?? "") ? h.terrain! : "desert";
        return <polygon key={`t${h.q},${h.r}`} className="hex-tile" points={poly} transform={`translate(${c.x},${c.y})`} fill={`url(#${clipId}-${t}-${(h.rotation ?? 0) % 6})`} vectorEffect="non-scaling-stroke" />;
      })}
    </>
  );
}

/**
 * Значки карты одним набором SVG-символов (контур 2px, как у Icon): испытание, разведка, метки дел, столица.
 * Определяются один раз в <defs>, на карте ставятся через <use href="#m-…">; цвет — через CSS (currentColor).
 */
const SYMBOLS: Record<string, string> = {
  wave: "M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M2 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0",
  city: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01",
  telescope: "m4 14 12-7 3 5-12 7-3-5Zm12-7 3-2 3 5-3 2M9 17l3 5m-6-2 3-3",
  scroll: "M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4M8 21a2 2 0 0 1-2-2M6 5h12a2 2 0 0 1 2 2v10M10 9h6m-6 4h6",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-14v6l4 2",
  alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  crown: "m2 8 5 4 5-8 5 8 5-4-2 12H4L2 8Z",
};
export function MapSymbols() {
  return (
    <defs>
      {Object.entries(SYMBOLS).map(([name, d]) => (
        <symbol key={name} id={`m-${name}`} viewBox="0 0 24 24"><path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></symbol>
      ))}
    </defs>
  );
}

/** Прогрев кеша картинок карты: вызывается после входа, чтобы карта открывалась без ожидания. */
export function warmMapImages(): void {
  if (typeof window === "undefined") return;
  const urls = [...TERRAINS.map(IMG.terrain), "/img/brand/sea.webp", ...["village", "capital", "fortress", "hill_city", "port", "ruins", "temple_city", "tent_camp", "walled_city"].map((c) => IMG.city(c)), ...Array.from({ length: 6 }, (_, i) => IMG.start(i))];
  const go = () => urls.forEach((u) => { const im = new Image(); im.decoding = "async"; im.src = u; });
  if ("requestIdleCallback" in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(go); else setTimeout(go, 300);
}

export { TERRAIN_COLOR };
