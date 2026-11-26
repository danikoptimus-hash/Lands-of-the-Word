import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef } from "react";
import { VictoryFireworksLayer } from "./pages/VictoryFireworksLayer";
import { victoryWindow } from "./lib/victoryFx";
const q = new URLSearchParams(location.search);
const night = q.get("tod") === "night";
const W = Number(q.get("w") ?? 390), H = Number(q.get("h") ?? 844);
function App() {
  const view = useRef({ k: Number(q.get("k") ?? 0.6), tx: 0, ty: 0 });
  const subs = useRef(new Set<(v: typeof view.current) => void>());
  const bg = useRef<HTMLDivElement>(null);
  const vp = useMemo(() => ({ view: view.current, viewRef: view, subscribe: (fn: any) => { subs.current.add(fn); return () => subs.current.delete(fn); } }), []);
  const apply = () => { const v = view.current; if (bg.current) bg.current.style.transform = `translate(${v.tx}px,${v.ty}px) scale(${v.k})`; subs.current.forEach((f) => f(v)); };
  useEffect(() => { (window as any).__setView = (v: any) => { Object.assign(view.current, v); apply(); }; apply(); }, []);
  const win = useMemo(() => (q.get("raw") ? { at: Date.now() - 30 * 3600e3, until: Date.now() + 42 * 3600e3 } : victoryWindow(null, Date.now())!), []);
  const anchors = useMemo(() => [{ x: 300, y: 500 }, { x: 700, y: 900 }, { x: 1100, y: 600 }, { x: 500, y: 1300 }], []);
  const land = [[300, 500, 380, 260], [700, 900, 420, 300], [1100, 600, 300, 250], [500, 1300, 360, 240], [1300, 1200, 300, 200]];
  return (
    <div style={{ position: "relative", width: W, height: H, overflow: "hidden", background: night ? "#0b2236" : "#4d97b4" }} className="map-canvas">
      <div ref={bg} style={{ position: "absolute", left: 0, top: 0, width: 2000, height: 2000, transformOrigin: "0 0", filter: night ? "brightness(.38) saturate(.7)" : "none" }}>
        <svg width={2000} height={2000}>
          <rect width={2000} height={2000} fill="#4d97b4" />
          {land.map(([x, y, rx, ry], i) => <g key={i}><ellipse cx={x} cy={y} rx={rx! + 24} ry={ry! + 24} fill="#bfe3e8" /><ellipse cx={x} cy={y} rx={rx} ry={ry} fill="#e6d3a6" /><ellipse cx={x! + 30} cy={y! - 20} rx={rx! * 0.6} ry={ry! * 0.5} fill="#8fae6a" /></g>)}
          {[[300, 500], [700, 900], [1100, 600], [500, 1300]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={26} fill="#a05a3a" stroke="#fff" strokeWidth={4} />)}
        </svg>
      </div>
      <VictoryFireworksLayer vp={vp as any} win={win} clock={Date.now} timeZone="UTC" anchors={anchors} />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
