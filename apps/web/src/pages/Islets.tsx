import { useMemo } from "react";
import { generateIslets, type Bounds, type Islet } from "@lotw/domain";
import { HEX_SIZE, coastPath, hexCenter, hexPoints } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { CoastOver, CoastUnder } from "./MapLayers";

/** Раскладка островков по гексам поля (детерминирована, считается один раз на карту). */
export function useIslets(hexes: MapHexDto[], size: number, bounds: Bounds | null): Islet[] {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  return useMemo(() => (bounds && hexes.length ? generateIslets(hexes, size, bounds) : []), [key, size, bounds]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Островки: те же гексы местности, что и на поле (узоры из HexTiles по clipId), без сетки, с тем же берегом —
 * отмель, песок, растворение песка в местность. Слой без событий; лежит под берегом поля в SVG мира.
 */
export function IsletsLayer({ islets, clipId, size = HEX_SIZE }: { islets: Islet[]; clipId: string; size?: number }) {
  if (!islets.length) return null;
  const poly = hexPoints(size, 1.01);
  return (
    <g className="islets coast" pointerEvents="none">
      {islets.map((isl, i) => {
        const d = coastPath(isl.hexes, size);
        // Берег у маленьких островков уже, иначе песок съедает всю сушу одиночного гекса.
        const sc = isl.hexes.length === 1 ? 0.42 : isl.hexes.length === 2 ? 0.58 : 0.75;
        return (
          <g key={i}>
            <CoastUnder d={d} size={size} scale={sc} />
            {isl.hexes.map((h) => {
              const c = hexCenter(h, size);
              return <polygon key={`${h.q},${h.r}`} points={poly} transform={`translate(${c.x},${c.y})`} fill={`url(#${clipId}-${h.terrain}-${h.rotation % 6})`} />;
            })}
            <CoastOver d={d} size={size} scale={sc} />
          </g>
        );
      })}
    </g>
  );
}
