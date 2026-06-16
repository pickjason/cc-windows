// ECharts 配置构造器(纯函数:data + 状态 → option)。从 cc-journal app.js 移植,
// 调色板换成 cc-window 的暗色 token(见 web/styles.css :root)。
import type { EChartsCoreOption } from "echarts/core";
import type { AggregateResult, Usage } from "../../server/journal/types";
import type { JournalMessages } from "./i18n";
import { fmt, type Metric, metricValue, totalTokens, yearDays } from "./util";

// 对齐 cc-window 暗色主题
const DARK = {
  text: "#e6edf3",
  muted: "#95a1ae",
  border: "#1b222d",
  panel: "#0d1117",
  // 热力图绿阶:从面板底色渐变到 --accent
  greens: ["#10151d", "#0e3d2a", "#13643f", "#1fa362", "#34d399"],
  series: ["#58a6ff", "#34d399", "#d29922", "#bc8cff", "#f85149", "#76e3ea"],
};

const axisStyle = {
  axisLine: { lineStyle: { color: DARK.border } },
  axisLabel: { color: DARK.muted },
  splitLine: { lineStyle: { color: DARK.border, opacity: 0.4 } },
};

export function heatmapOption(
  data: AggregateResult,
  year: string,
  metric: Metric,
  t: JournalMessages,
): EChartsCoreOption {
  const days = yearDays(data, year);
  const cells = days.map(([day, d]) => [day, metricValue(d, metric)]);
  const values = cells.map((x) => x[1] as number).filter((v) => v > 0).sort((a, b) => a - b);
  // 用 95 分位做上限,避免单个爆量天把整年颜色压扁
  const p95 = values.length ? (values[Math.floor(values.length * 0.95)] ?? 1) : 1;

  return {
    tooltip: {
      formatter: (p: any) => {
        const d = data.days[p.data[0]];
        return d ? t.heatTip(p.data[0], d) : p.data[0];
      },
    },
    visualMap: { min: 0, max: Math.max(p95, 1), show: false, inRange: { color: DARK.greens } },
    calendar: {
      range: String(year),
      top: 30, left: 40, right: 10,
      cellSize: ["auto", 14],
      itemStyle: { borderWidth: 3, borderColor: DARK.panel, color: "#0b0f15" },
      splitLine: { show: false },
      dayLabel: { color: DARK.muted, nameMap: t.calendarNameMap, firstDay: 1 },
      monthLabel: { color: DARK.muted, nameMap: t.calendarNameMap },
      yearLabel: { show: false },
    },
    series: [{ type: "heatmap", coordinateSystem: "calendar", data: cells }],
  };
}

export function trendOption(data: AggregateResult, year: string, t: JournalMessages): EChartsCoreOption {
  const days = yearDays(data, year).sort((a, b) => a[0].localeCompare(b[0]));
  const x = days.map(([day]) => day.slice(5));
  const mk = (key: keyof Usage) => days.map(([, d]) => d.usage[key]);

  return {
    color: DARK.series,
    tooltip: { trigger: "axis", valueFormatter: (v: any) => fmt(v) },
    legend: {
      textStyle: { color: DARK.muted },
      // cache 量级远大于 input/output,默认隐藏避免压扁其他序列
      selected: { [t.sCacheRead]: false, [t.sCacheWrite]: false },
    },
    grid: { left: 60, right: 16, top: 40, bottom: 56 },
    dataZoom: [{
      type: "slider",
      startValue: Math.max(0, x.length - 60), end: 100,
      borderColor: DARK.border, backgroundColor: "#0b0f15",
      textStyle: { color: DARK.muted }, height: 18, bottom: 8,
    }],
    xAxis: { type: "category", data: x, ...axisStyle },
    yAxis: { type: "value", axisLabel: { color: DARK.muted, formatter: (v: any) => fmt(v) }, splitLine: axisStyle.splitLine },
    series: [
      { name: t.sOutput, type: "bar", stack: "t", data: mk("output") },
      { name: t.sInput, type: "bar", stack: "t", data: mk("input") },
      { name: t.sCacheWrite, type: "bar", stack: "t", data: mk("cacheCreation") },
      { name: t.sCacheRead, type: "bar", stack: "t", data: mk("cacheRead") },
    ],
  };
}

export function hoursOption(data: AggregateResult, year: string, t: JournalMessages): EChartsCoreOption {
  const sum = new Array<number>(24).fill(0);
  for (const [, d] of yearDays(data, year)) {
    d.hours.forEach((v, h) => (sum[h] = (sum[h] ?? 0) + v));
  }
  return {
    tooltip: { trigger: "axis", formatter: (p: any) => t.hoursTip(p[0].name, p[0].value) },
    grid: { left: 50, right: 16, top: 20, bottom: 30 },
    xAxis: { type: "category", data: sum.map((_, h) => h), ...axisStyle },
    yAxis: { type: "value", axisLabel: { color: DARK.muted, formatter: (v: any) => fmt(v) }, splitLine: axisStyle.splitLine },
    series: [{ type: "bar", data: sum, itemStyle: { color: "#1fa362", borderRadius: [3, 3, 0, 0] } }],
  };
}

export function projectsOption(data: AggregateResult, year: string): EChartsCoreOption {
  const totals = new Map<string, number>();
  for (const [, d] of yearDays(data, year)) {
    for (const [p, bp] of Object.entries(d.byProject)) {
      totals.set(p, (totals.get(p) ?? 0) + bp.usage.output);
    }
  }
  const top = [...totals.entries()].sort((a, b) => a[1] - b[1]).slice(-12);
  return {
    tooltip: { valueFormatter: (v: any) => fmt(v) },
    grid: { left: 10, right: 60, top: 10, bottom: 30, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: DARK.muted, formatter: (v: any) => fmt(v) }, splitLine: axisStyle.splitLine },
    yAxis: { type: "category", data: top.map(([p]) => p), axisLabel: { color: DARK.text }, axisLine: axisStyle.axisLine },
    series: [{
      type: "bar",
      data: top.map(([, v]) => v),
      itemStyle: { color: "#58a6ff", borderRadius: [0, 3, 3, 0] },
      label: { show: true, position: "right", color: DARK.muted, formatter: (p: any) => fmt(p.value) },
    }],
  };
}

export function modelsOption(data: AggregateResult, year: string): EChartsCoreOption {
  const totals = new Map<string, number>();
  for (const [, d] of yearDays(data, year)) {
    for (const [m, bm] of Object.entries(d.byModel)) {
      totals.set(m, (totals.get(m) ?? 0) + bm.usage.output);
    }
  }
  const pie = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }));
  return {
    color: DARK.series,
    tooltip: { valueFormatter: (v: any) => fmt(v) },
    legend: { bottom: 0, textStyle: { color: DARK.muted } },
    series: [{
      type: "pie",
      radius: ["45%", "70%"],
      center: ["50%", "44%"],
      itemStyle: { borderColor: DARK.panel, borderWidth: 2 },
      label: { color: DARK.text, formatter: (p: any) => `${p.name}\n${fmt(p.value)}` },
      data: pie,
    }],
  };
}

// 给 totalTokens 一个出口,JournalView 头部 chips 也要用
export { totalTokens };
