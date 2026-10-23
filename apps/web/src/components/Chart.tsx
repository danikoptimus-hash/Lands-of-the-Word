import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, HeatmapChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, LineChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent, CanvasRenderer]);

/** Цвета темы для графиков: берутся из переменных CSS, чтобы графики жили в той же палитре, что страница. */
export function chartColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return { text: v("--text", "#2b2418"), muted: v("--muted", "#6b645a"), border: v("--border", "#d9c9a6"), accent: v("--accent", "#a8722e"), info: v("--info", "#2f6f8f"), success: v("--success", "#4f6b2f"), warn: v("--warn", "#9a6b12"), danger: v("--danger", "#8c2f2f"), surface: v("--surface", "#fbf6ea"), font: v("--font-ui", "system-ui") };
}

/** Общие части: сетка, подсказка, ползунок масштаба под графиком (как в Superset), легенда сверху. */
export function baseOption(c: ReturnType<typeof chartColors>, extra: echarts.EChartsCoreOption): echarts.EChartsCoreOption {
  return {
    textStyle: { fontFamily: c.font, color: c.text },
    grid: { left: 12, right: 12, top: 36, bottom: 64, containLabel: true },
    tooltip: { trigger: "axis", backgroundColor: c.surface, borderColor: c.border, textStyle: { color: c.text, fontFamily: c.font } },
    legend: { top: 0, textStyle: { color: c.muted } },
    dataZoom: [{ type: "inside" }, { type: "slider", height: 22, bottom: 10, borderColor: c.border, fillerColor: "rgba(168,114,46,0.18)", handleStyle: { color: c.accent }, dataBackground: { lineStyle: { color: c.border }, areaStyle: { color: c.border, opacity: 0.4 } }, textStyle: { color: c.muted } }],
    ...extra,
  };
}

/** Холст ECharts: сам подстраивается под ширину, пересоздаёт параметры при их смене. */
export function Chart({ option, height = 300, className }: { option: echarts.EChartsCoreOption; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    inst.current = echarts.init(ref.current, undefined, { renderer: "canvas" });
    const ro = new ResizeObserver(() => inst.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); inst.current?.dispose(); inst.current = null; };
  }, []);
  useEffect(() => { inst.current?.setOption(option, { notMerge: true }); }, [option]);
  return <div ref={ref} className={"chart" + (className ? " " + className : "")} style={{ height }} role="img" />;
}
