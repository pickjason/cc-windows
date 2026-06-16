import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, PieChart } from "echarts/charts";
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

// 按需注册(tree-shaking),只引这几块图用到的部件,避免整包 echarts。
echarts.use([
  BarChart, HeatmapChart, PieChart,
  CalendarComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent,
  CanvasRenderer,
]);

/** echarts 的 React 薄封装:init / setOption(notMerge)/ ResizeObserver / 点击 / dispose。 */
export function EChart({
  option,
  height,
  onDayClick,
}: {
  option: EChartsCoreOption | null;
  height: number | string;
  onDayClick?: (day: string) => void;
}) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const chart = echarts.init(el, null, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onDayClick) return;
    const handler = (p: any) => {
      if (p?.data?.[0]) onDayClick(p.data[0]);
    };
    chart.on("click", handler);
    return () => {
      chart.off("click", handler);
    };
  }, [onDayClick]);

  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, true);
  }, [option]);

  return <div ref={elRef} style={{ width: "100%", height }} />;
}
