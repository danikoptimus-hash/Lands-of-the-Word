import { useMemo } from "react";
import { SHAPE_N, generateIslets, type Bounds, type Islet, type Palm } from "@lotw/domain";
import { HEX_SIZE } from "../lib/hexmap";
import type { MapHexDto } from "../lib/api";

/** Раскладка островков по гексам поля (детерминирована, считается один раз на карту). */
export function useIslets(hexes: MapHexDto[], size: number, bounds: Bounds | null): Islet[] {
  const key = hexes.map((h) => `${h.q},${h.r}`).join(";");
  return useMemo(() => (bounds && hexes.length ? generateIslets(hexes, size, bounds) : []), [key, size, bounds]); // eslint-disable-line react-hooks/exhaustive-deps
}

const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

/** Замкнутый гладкий контур островка (Катмулл-Ром → кубические Безье) с масштабом s вокруг центра. */
function isletPath(isl: Islet, s = 1): string {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < SHAPE_N; i++) {
    const a = (i / SHAPE_N) * Math.PI * 2, d = isl.r * isl.shape[i]! * s;
    pts.push([isl.x + Math.cos(a) * d, isl.y + Math.sin(a) * d]);
  }
  const n = pts.length, P = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M${f1(P(0)[0])},${f1(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f1(c1x)},${f1(c1y)} ${f1(c2x)},${f1(c2y)} ${f1(p2[0])},${f1(p2[1])}`;
  }
  return d + "Z";
}

/** Кокосовая пальма: тень, изогнутый ствол с кольцами, 6–8 листьев веером, кокосы. Единица — высота h, основание в (x, y). */
function PalmTree({ p }: { p: Palm }) {
  const h = p.h, lean = p.lean * 0.28;
  const tx = lean * h, ty = -h; // верхушка ствола
  const fronds = 6 + Math.floor(p.seed * 3);
  const leaves: React.ReactNode[] = [];
  for (let i = 0; i < fronds; i++) {
    // Листья веером во все стороны, чуть гуще против наклона; длина и провис — с вариациями от seed.
    const a = (i / fronds) * Math.PI * 2 + p.seed * 2.1 + (i % 2) * 0.15;
    const L = h * (0.5 + 0.18 * Math.sin(p.seed * 9 + i * 1.7));
    const dx = Math.cos(a), up = Math.sin(a); // up<0 — лист смотрит вверх на экране
    const ex = tx + dx * L, ey = ty + up * L * 0.45 + L * 0.42; // конец листа провисает вниз
    const cx = tx + dx * L * 0.55, cy = ty + up * L * 0.4 - L * 0.28; // дуга вверх
    const w = h * 0.075;
    const nx = -(ey - ty), ny = ex - tx, nl = Math.hypot(nx, ny) || 1;
    const ox = (nx / nl) * w, oy = (ny / nl) * w;
    const light = up < -0.2 || (dx > 0.3 && up < 0.3);
    leaves.push(<path key={i} d={`M${f2(tx)},${f2(ty)}Q${f2(cx + ox)},${f2(cy + oy)} ${f2(ex)},${f2(ey)}Q${f2(cx - ox)},${f2(cy - oy)} ${f2(tx)},${f2(ty)}Z`} fill={light ? "#5B9A48" : "#3F7A38"} />);
  }
  const trunk = `M${f2(-h * 0.05)},0Q${f2(lean * h * 0.35)},${f2(-h * 0.55)} ${f2(tx - h * 0.028)},${f2(ty)}L${f2(tx + h * 0.028)},${f2(ty)}Q${f2(lean * h * 0.35 + h * 0.07)},${f2(-h * 0.55)} ${f2(h * 0.06)},0Z`;
  const rings: React.ReactNode[] = [];
  for (let i = 1; i <= 4; i++) {
    const t = i / 5, bx = lean * h * 0.35 * 2 * t * (1 - t) + tx * t * t, by = -h * 0.55 * 2 * t * (1 - t) + ty * t * t; // точка на квадратичной кривой ствола
    rings.push(<line key={i} x1={f2(bx - h * 0.05)} y1={f2(by)} x2={f2(bx + h * 0.05)} y2={f2(by)} stroke="#6A4E2E" strokeWidth={h * 0.02} />);
  }
  return (
    <g transform={`translate(${f1(p.x)},${f1(p.y)})`}>
      <ellipse cx={h * 0.12} cy={h * 0.04} rx={h * 0.34} ry={h * 0.1} fill="rgba(40,30,10,.18)" />
      <path d={trunk} fill="#8C6A3F" />
      {rings}
      {leaves}
      <circle cx={tx - h * 0.04} cy={ty + h * 0.03} r={h * 0.04} fill="#6B4A2B" />
      <circle cx={tx + h * 0.04} cy={ty + h * 0.05} r={h * 0.04} fill="#7A5733" />
      <circle cx={tx} cy={ty + h * 0.08} r={h * 0.036} fill="#5E3F24" />
    </g>
  );
}

/**
 * Островки: отмель кольцами (как у берега поля), песок, зелёная суша с бликом, лагуна, камни, кусты, пальмы.
 * Слой без событий; лежит под берегом поля в том же SVG мира, поэтому масштабируется и двигается вместе с ним.
 */
export function IsletsLayer({ islets, size = HEX_SIZE }: { islets: Islet[]; size?: number }) {
  if (!islets.length) return null;
  return (
    <g className="islets coast" pointerEvents="none">
      <defs>
        <radialGradient id="islet-land" cx="0.42" cy="0.38" r="0.7">
          <stop offset="0" stopColor="#A6BE6C" />
          <stop offset="0.7" stopColor="#7E9C50" />
          <stop offset="1" stopColor="#6B8A44" />
        </radialGradient>
        <radialGradient id="islet-sand" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#F0E2B8" />
          <stop offset="1" stopColor="#E6D3A6" />
        </radialGradient>
      </defs>
      {islets.map((isl, i) => {
        const outer = isletPath(isl);
        const w = Math.min(size, isl.r * 0.75); // ширина полос отмели: у мелких банок — уже
        const sand = Math.min(size * 0.55, isl.r * 0.4); // ширина пляжа
        const land = isl.kind === "bank" ? null : isletPath(isl, Math.max(0.35, 1 - sand / isl.r));
        return (
          <g key={i} fill="none" strokeLinejoin="round" strokeLinecap="round">
            <g opacity={0.16}><path d={outer} stroke="#CFEAF0" strokeWidth={w * 3.2} /></g>
            <g opacity={0.2}><path d={outer} stroke="#CFEAF0" strokeWidth={w * 2.6} /></g>
            <g opacity={0.26}><path d={outer} stroke="#D7EEF2" strokeWidth={w * 2.0} /></g>
            <g opacity={0.36}><path d={outer} stroke="#E0F2F5" strokeWidth={w * 1.5} /></g>
            <path d={outer} fill="url(#islet-sand)" stroke="#E6D3A6" strokeWidth={w * 0.5} />
            {land && <path d={land} fill="url(#islet-land)" />}
            {land && <g opacity={0.35}><path d={isletPath(isl, Math.max(0.3, 1 - sand / isl.r) * 0.72)} fill="#B9CD7E" transform={`translate(${f1(-isl.r * 0.08)},${f1(-isl.r * 0.1)})`} /></g>}
            {isl.lagoon && <ellipse cx={isl.lagoon.x} cy={isl.lagoon.y} rx={isl.lagoon.r * 1.25} ry={isl.lagoon.r * 0.9} fill="#8FD0DC" stroke="#E6D3A6" strokeWidth={isl.lagoon.r * 0.35} />}
            <g opacity={0.35}><path className="coast-wet" d={outer} stroke="#B8975E" /></g>
            {isl.bushes.map((b, j) => (
              <g key={"b" + j}>
                <circle cx={b.x - b.r * 0.5} cy={b.y + b.r * 0.1} r={b.r * 0.8} fill="#4F8340" />
                <circle cx={b.x + b.r * 0.4} cy={b.y} r={b.r * 0.85} fill="#5A9048" />
                <circle cx={b.x} cy={b.y - b.r * 0.35} r={b.r * 0.75} fill="#6AA455" />
              </g>
            ))}
            {isl.rocks.map((r, j) => (
              <g key={"r" + j} transform={`translate(${f1(r.x)},${f1(r.y)}) rotate(${f1((r.a * 180) / Math.PI)})`}>
                <ellipse rx={r.r * 1.3} ry={r.r * 0.9} fill="#857D70" />
                <ellipse cx={-r.r * 0.3} cy={-r.r * 0.3} rx={r.r * 0.7} ry={r.r * 0.45} fill="#A59D8E" />
              </g>
            ))}
            {isl.palms.map((p, j) => <PalmTree key={"p" + j} p={p} />)}
          </g>
        );
      })}
    </g>
  );
}
