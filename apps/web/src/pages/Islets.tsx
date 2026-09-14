import { useMemo } from "react";
import { SHAPE_N, generateIslets, type Bounds, type Islet } from "@lotw/domain";
import { HEX_SIZE, TERRAIN_COLOR, hexCenter, hexPoints } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { CoastOver, CoastUnder } from "./MapLayers";

/** Раскладка островков по гексам поля (детерминирована, считается один раз на карту). */
export function useIslets(hexes: MapHexDto[], size: number, bounds: Bounds | null): Islet[] {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  return useMemo(() => (bounds && hexes.length ? generateIslets(hexes, size, bounds) : []), [key, size, bounds]); // eslint-disable-line react-hooks/exhaustive-deps
}

const f1 = (n: number) => n.toFixed(1);

/** Замкнутый гладкий контур островка (Катмулл-Ром → кубические Безье). */
function isletPath(isl: Islet): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < SHAPE_N; i++) {
    const a = (i / SHAPE_N) * Math.PI * 2, d = isl.r * isl.shape[i]!;
    pts.push([isl.x + Math.cos(a) * d, isl.y + Math.sin(a) * d]);
  }
  const n = pts.length, P = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${f1(P(0)[0])},${f1(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return d + "Z";
}

/**
 * Островки: плавный контур, внутри — те же картинки местности, что и на поле (узоры HexTiles по clipId),
 * положенные мягкими пятнами размером с гекс с радиальной маской: стыки растворяются, решётки не видно.
 * Берег — как у поля (отмель, песок), у маленьких островков уже. Слой без событий, лежит под берегом поля.
 */
export function IsletsLayer({ islets, clipId, size = HEX_SIZE }: { islets: Islet[]; clipId: string; size?: number }) {
  if (!islets.length) return null;
  const patch = hexPoints(size, 1.6);
  const maskId = `${clipId}-soft`;
  return (
    <g className="islets coast" pointerEvents="none">
      <defs>
        <radialGradient id={`${maskId}-g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.4" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id={maskId} maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill={`url(#${maskId}-g)`} /></mask>
      </defs>
      {islets.map((isl, i) => {
        const d = isletPath(isl);
        const sc = Math.min(1, Math.max(0.45, isl.r / (size * 2.4)));
        const base = isl.cells[0]?.terrain ?? "meadow";
        return (
          <g key={i}>
            <CoastUnder d={d} size={size} scale={sc} />
            <clipPath id={`${clipId}-isl-${i}`}><path d={d} /></clipPath>
            <g clipPath={`url(#${clipId}-isl-${i})`}>
              <path d={d} fill={TERRAIN_COLOR[base] ?? TERRAIN_COLOR.meadow} />
              {isl.cells.map((c) => {
                const p = hexCenter(c, size);
                return <polygon key={`${c.q},${c.r}`} points={patch} transform={`translate(${p.x},${p.y})`} fill={`url(#${clipId}-${c.terrain}-${c.rotation % 6})`} mask={`url(#${maskId})`} />;
              })}
            </g>
            <CoastOver d={d} size={size} scale={sc} />
          </g>
        );
      })}
    </g>
  );
}
