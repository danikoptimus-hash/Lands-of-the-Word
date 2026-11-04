import { describe, expect, it } from "vitest";
import { hitTest, polylineDistance, segmentDistance, type HitModel } from "./lib/mapHit";

describe("нажатия на карте в коде (Э1)", () => {
  it("расстояние до отрезка и ломаной — с круглыми концами", () => {
    expect(segmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
    expect(segmentDistance({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(5); // за концом — до конца, как круглый кап
    expect(polylineDistance({ x: 10, y: 1 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBeCloseTo(0);
    expect(polylineDistance({ x: 12, y: 12 }, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBeCloseTo(Math.hypot(2, 2));
  });
  const model: HitModel<string> = {
    rects: [{ x: 95, y: 90, w: 10, h: 10, id: "city" }],
    routes: [{ pts: [{ x: 0, y: 50 }, { x: 100, y: 50 }], id: "route" }],
    edges: [{ pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }], id: "edge1" }, { pts: [{ x: 0, y: 0 }, { x: 0, y: 100 }], id: "edge2" }, { pts: [{ x: 0, y: 50 }, { x: 100, y: 50 }], id: "edgeUnderRoute" }],
  };
  it("полоса нажатия — band экранных пикселей при любом масштабе", () => {
    expect(hitTest({ x: 50, y: 10 }, model, 22, 1)).toBe("edge1"); // 10 ≤ 11
    expect(hitTest({ x: 50, y: 12 }, model, 22, 1)).toBeNull(); // 12 > 11
    expect(hitTest({ x: 50, y: 5 }, model, 22, 2)).toBe("edge1"); // при k=2 полоса 5,5 единиц карты
    expect(hitTest({ x: 50, y: 6 }, model, 22, 2)).toBeNull();
  });
  it("приоритет: город выше пути, путь выше стороны, последний в слое выше первого", () => {
    expect(hitTest({ x: 100, y: 100 }, model, 22, 1)).toBe("city");
    expect(hitTest({ x: 50, y: 50 }, model, 22, 1)).toBe("route");
    expect(hitTest({ x: 2, y: 2 }, model, 22, 1)).toBe("edge2"); // обе стороны под точкой — верхняя в SVG была последняя
    expect(hitTest({ x: 500, y: 500 }, model, 22, 1)).toBeNull();
  });
});
