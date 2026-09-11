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

/** Слой гексов: текстуры местности под клип-маской гекса, туман — тёмные гексы. */
export function HexTiles({ hexes, size = HEX_SIZE, clipId }: { hexes: MapHexDto[]; size?: number; clipId: string }) {
  const poly = hexPoints(size, 0.995);
  const box = size * 2.02; // квадрат текстуры, покрывающий гекс
  return (
    <>
      <defs><clipPath id={clipId}><polygon points={poly} /></clipPath></defs>
      {hexes.map((h) => {
        const c = hexCenter(h, size);
        if (!h.lit && h.lit !== undefined) return <polygon key={`f${h.q},${h.r}`} points={poly} transform={`translate(${c.x},${c.y})`} fill={FOG_COLOR} stroke="#2B2724" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        return (
          <g key={`t${h.q},${h.r}`} transform={`translate(${c.x},${c.y})`}>
            <g clipPath={`url(#${clipId})`}>
              <image href={IMG.terrain(h.terrain ?? "desert")} x={-box / 2} y={-box / 2} width={box} height={box} transform={`rotate(${(h.rotation ?? 0) * 60})`} preserveAspectRatio="xMidYMid slice" />
            </g>
            <polygon points={poly} fill="none" stroke="rgba(31,27,22,.28)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        );
      })}
    </>
  );
}

export { TERRAIN_COLOR };
