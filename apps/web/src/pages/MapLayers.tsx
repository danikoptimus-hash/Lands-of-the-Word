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
            <rect width={1} height={1} fill={TERRAIN_COLOR[t] ?? "#C9B27A"} />
            {/* Квадрат текстуры повёрнут вокруг центра и увеличен, чтобы закрыть углы гекса при любом повороте. */}
            <image href={IMG.terrain(t)} x={-0.2} y={-0.2} width={1.4} height={1.4} preserveAspectRatio="none" transform={`rotate(${r * 60} .5 .5)`} />
          </pattern>
        )))}
      </defs>
      {hexes.map((h) => {
        const c = hexCenter(h, size);
        if (!h.lit && h.lit !== undefined) return <polygon key={`f${h.q},${h.r}`} points={poly} transform={`translate(${c.x},${c.y})`} fill={FOG_COLOR} stroke="#2B2724" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        const t = TERRAINS.includes(h.terrain ?? "") ? h.terrain! : "desert";
        return <polygon key={`t${h.q},${h.r}`} points={poly} transform={`translate(${c.x},${c.y})`} fill={`url(#${clipId}-${t}-${(h.rotation ?? 0) % 6})`} stroke="rgba(31,27,22,.28)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
      })}
    </>
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
