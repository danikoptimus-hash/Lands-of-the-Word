import { useMemo } from "react";
import { SHAPE_N, generateIslets, type Bounds, type Islet } from "@lotw/domain";
import { HEX_SIZE, TERRAIN_COLOR, hexCenter, hexPoints } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";
import { CoastOver, CoastUnder, IMG } from "./MapLayers";

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
 * положенные мягкими пятнами чуть больше гекса с радиальной маской: стыки растворяются, решётки не видно.
 * Берег — как у поля (отмель, песок), у маленьких островков уже. Слой без событий, лежит под берегом поля.
 */
/** Местности островков (см. ZONE_TERRAIN в домене) и четыре варианта раскладки картинки: без поворота, вверх ногами, зеркально, и то и другое. */
const ISLET_TERRAINS = ["oasis", "meadow", "hills", "mountains", "desert"];
const VARIANTS = ["", "rotate(180 .5 .5)", "matrix(-1 0 0 1 1 0)", "matrix(-1 0 0 -1 1 1)"];

export function IsletsLayer({ islets, clipId, size = HEX_SIZE }: { islets: Islet[]; clipId: string; size?: number }) {
  if (!islets.length) return null;
  // Пятно чуть больше гекса (1.22): соседние пятна перекрываются на треть, а текстура растянута почти как на поле —
  // при большом приближении островки такие же резкие, как гексы (картинки местности всего 512 px).
  const patch = hexPoints(size, 1.22);
  const maskId = `${clipId}-soft`;
  return (
    <g className="islets coast" pointerEvents="none">
      <defs>
        {/* Узоры островков: картинка местности без увеличения (у гексов поля она растянута в 1.4 раза ради поворотов на 60°),
            поэтому при большом приближении островки резче; разнообразие — четырьмя зеркальными вариантами. */}
        {ISLET_TERRAINS.map((t) => VARIANTS.map((tr, v) => (
          <pattern key={`${t}${v}`} id={`${clipId}-isl-${t}-${v}`} patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width={1} height={1}>
            <rect width={1} height={1} fill={TERRAIN_COLOR[t] ?? TERRAIN_COLOR.meadow} />
            <image href={IMG.terrain(t)} x={0} y={0} width={1} height={1} preserveAspectRatio="none" transform={tr || undefined} />
          </pattern>
        )))}
        <radialGradient id={`${maskId}-g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.62" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id={maskId} maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill={`url(#${maskId}-g)`} /></mask>
      </defs>
      {islets.map((isl, i) => {
        const d = isletPath(isl);
        // Пляж и отмель уже у маленьких островков: иначе песок съедает всю сушу.
        const sc = Math.min(1, Math.max(0.3, isl.r / (size * 3)));
        const base = isl.cells[0]?.terrain ?? "meadow";
        return (
          <g key={i}>
            <CoastUnder d={d} size={size} scale={sc} />
            <clipPath id={`${clipId}-isl-${i}`}><path d={d} /></clipPath>
            <g clipPath={`url(#${clipId}-isl-${i})`}>
              <path d={d} fill={TERRAIN_COLOR[base] ?? TERRAIN_COLOR.meadow} />
              {isl.cells.map((c) => {
                const p = hexCenter(c, size);
                return <polygon key={`${c.q},${c.r}`} points={patch} transform={`translate(${p.x},${p.y})`} fill={`url(#${clipId}-isl-${c.terrain}-${c.rotation % 4})`} mask={`url(#${maskId})`} />;
              })}
            </g>
            <CoastOver d={d} size={size} scale={sc} />
          </g>
        );
      })}
    </g>
  );
}
