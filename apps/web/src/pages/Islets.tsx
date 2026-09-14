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
  // Мягкий слой: тот же гекс, увеличенный в 1.5 раза, с радиальной маской (непрозрачен в центре, тает к краю).
  // Поверх жёстких гексов он размывает стыки местностей — переходы между текстурами становятся плавными.
  const soft = hexPoints(size, 1.5);
  const maskId = `${clipId}-soft`;
  return (
    <g className="islets coast" pointerEvents="none">
      <defs>
        <radialGradient id={`${maskId}-g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.45" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id={maskId} maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill={`url(#${maskId}-g)`} /></mask>
      </defs>
      {islets.map((isl, i) => {
        const d = coastPath(isl.hexes, size);
        // Берег у маленьких островков уже, иначе песок съедает всю сушу.
        const sc = isl.hexes.length <= 2 ? 0.58 : 0.75;
        return (
          <g key={i}>
            <CoastUnder d={d} size={size} scale={sc} />
            <clipPath id={`${clipId}-isl-${i}`}><path d={d} /></clipPath>
            {isl.hexes.map((h) => {
              const c = hexCenter(h, size);
              return <polygon key={`${h.q},${h.r}`} points={poly} transform={`translate(${c.x},${c.y})`} fill={`url(#${clipId}-${h.terrain}-${h.rotation % 6})`} />;
            })}
            <g clipPath={`url(#${clipId}-isl-${i})`}>
              {isl.hexes.map((h) => {
                const c = hexCenter(h, size);
                return <polygon key={`s${h.q},${h.r}`} points={soft} transform={`translate(${c.x},${c.y})`} fill={`url(#${clipId}-${h.terrain}-${h.rotation % 6})`} mask={`url(#${maskId})`} />;
              })}
            </g>
            <CoastOver d={d} size={size} scale={sc} />
          </g>
        );
      })}
    </g>
  );
}
