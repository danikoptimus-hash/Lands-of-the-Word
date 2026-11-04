import { describe, expect, it } from "vitest";
import { lineMesh, parseColor, VERT_FLOATS as F } from "./lib/glLines";

describe("линии на WebGL (Э2–Э3): сетка и цвета", () => {
  it("на отрезок — четыре вершины с концами, углом, соседями и длиной вдоль, шесть индексов", () => {
    const m = lineMesh([[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]]);
    expect(m.segs).toBe(2); expect(m.verts.length).toBe(2 * 4 * F); expect(m.idx.length).toBe(12);
    expect([...m.verts.slice(0, F)]).toEqual([0, 0, 10, 0, 0, -1, 0, 0, 10, 5, 0, 10]); // A, B, угол, до A (сама A), после B, длина у A и у B
    expect([...m.verts.slice(F * 2, F * 3)]).toEqual([0, 0, 10, 0, 1, 1, 0, 0, 10, 5, 0, 10]);
    expect([...m.idx.slice(0, 6)]).toEqual([0, 1, 2, 0, 2, 3]);
    expect([...m.verts.slice(F * 4, F * 5)]).toEqual([10, 0, 10, 5, 0, -1, 0, 0, 10, 5, 10, 15]); // второй отрезок: после B нет — сама B, длина 10..15
    expect(m.box).toEqual({ x0: 0, y0: 0, x1: 10, y1: 5 });
  });
  it("замкнутая ломаная (стрелка, контур гекса) — отрезок от последней точки к первой, соседи по кругу", () => {
    const m = lineMesh([[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }]], true);
    expect(m.segs).toBe(3); expect([...m.verts.slice(F * 8, F * 8 + 4)]).toEqual([0, 3, 0, 0]);
    expect([...m.verts.slice(F * 8 + 6, F * 8 + 10)]).toEqual([4, 0, 4, 0]);
  });
  it("несколько ломаных в одном буфере: длина вдоль считается у каждой с нуля", () => {
    const m = lineMesh([[{ x: 0, y: 0 }, { x: 3, y: 0 }], [{ x: 0, y: 1 }, { x: 0, y: 5 }]]);
    expect(m.segs).toBe(2);
    expect([...m.verts.slice(F + 10, F + 12)]).toEqual([0, 3]);
    expect([...m.verts.slice(F * 4 + 10, F * 4 + 12)]).toEqual([0, 4]);
  });
  it("цвета: hex, rgb, rgba", () => {
    expect(parseColor("#ff0080")).toEqual([1, 0, 128 / 255, 1]);
    expect(parseColor("#abc")).toEqual([0xaa / 255, 0xbb / 255, 0xcc / 255, 1]);
    expect(parseColor("rgb(255, 250, 240)")).toEqual([1, 250 / 255, 240 / 255, 1]);
    expect(parseColor("rgba(10,20,30,0.5)")).toEqual([10 / 255, 20 / 255, 30 / 255, 0.5]);
  });
});
