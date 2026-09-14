import { useMemo } from "react";
import { generateIslets, type Bounds, type Islet } from "@lotw/domain";
import { HEX_SIZE } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { CoastUnder } from "./MapLayers";

/** Раскладка островков по гексам поля (детерминирована, считается один раз на карту). */
export function useIslets(hexes: MapHexDto[], size: number, bounds: Bounds | null): Islet[] {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  return useMemo(() => (bounds && hexes.length ? generateIslets(hexes, size, bounds) : []), [key, size, bounds]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const ISLET_IMG = (n: number) => `/img/islet/islet-${n}.webp`;
const f1 = (n: number) => n.toFixed(1);

/** Замкнутый гладкий контур островка по снятому профилю (Катмулл-Ром → кубические Безье). */
function isletPath(isl: Islet): string {
  const n = isl.shape.length;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, d = isl.r * isl.shape[i]!;
    pts.push([isl.x + Math.cos(a) * d, isl.y + Math.sin(a) * d]);
  }
  const P = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${f1(P(0)[0])},${f1(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return d + "Z";
}

/**
 * Островки: нарисованные картинки (пляж уже на них), под каждой — отмель кольцами по снятому контуру, как у берега
 * поля. Слой без событий, лежит под берегом поля в SVG мира.
 */
export function IsletsLayer({ islets, size = HEX_SIZE }: { islets: Islet[]; size?: number }) {
  if (!islets.length) return null;
  return (
    <g className="islets coast" pointerEvents="none">
      {islets.map((isl, i) => {
        // Ширина отмели — от размера островка: у большого около его радиуса, у банки совсем узкая.
        const sc = Math.max(0.1, (isl.r / size) * 0.42);
        return (
          <g key={i}>
            <CoastUnder d={isletPath(isl)} size={size} scale={sc} sand={false} />
            <image href={ISLET_IMG(isl.img)} x={isl.x - isl.r} y={isl.y - isl.r} width={isl.r * 2} height={isl.r * 2} preserveAspectRatio="xMidYMid meet" />
          </g>
        );
      })}
    </g>
  );
}
