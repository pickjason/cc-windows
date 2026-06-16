// 历史用量统计视图的前端小工具(自包含,不跨 import 服务端 value 模块,
// 仅从 server/journal/types 取「类型」)。见 docs/11。
import type { AggregateResult, DayOut, Usage } from "../../server/journal/types";

/** 1234567 → "1.23M" */
export function fmt(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export function totalTokens(u: Usage): number {
  return u.input + u.output + u.cacheCreation + u.cacheRead;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hm(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayOf(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 同天显示 "10:02–15:28",跨天显示 "06-10 13:28 – 06-11 11:47" */
export function timeRange(start: string, end: string): string {
  if (dayOf(start) === dayOf(end)) return `${hm(start)}–${hm(end)}`;
  return `${dayOf(start)} ${hm(start)} – ${dayOf(end)} ${hm(end)}`;
}

export type Metric = "totalTokens" | "output" | "sessions" | "userMessages";

export function metricValue(d: DayOut, metric: Metric): number {
  switch (metric) {
    case "sessions": return d.sessions;
    case "userMessages": return d.userMessages;
    case "output": return d.usage.output;
    default: return totalTokens(d.usage);
  }
}

/** 取某年的 [day, DayOut][](按需排序由调用方决定) */
export function yearDays(data: AggregateResult, year: string): Array<[string, DayOut]> {
  return Object.entries(data.days).filter(([day]) => day.startsWith(String(year)));
}

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)
  );
}

/** 极简 markdown → HTML(标题/加粗/引用/列表/分割线/段落),内容先转义 */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list = false;
  let quote = false;
  const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  const closeBlocks = () => {
    if (list) { out.push("</ul>"); list = false; }
    if (quote) { out.push("</blockquote>"); quote = false; }
  };
  for (const line of md.split("\n")) {
    if (line.startsWith("### ")) { closeBlocks(); out.push(`<h5>${inline(line.slice(4))}</h5>`); }
    else if (line.startsWith("## ")) { closeBlocks(); out.push(`<h4>${inline(line.slice(3))}</h4>`); }
    else if (line.startsWith("# ")) { closeBlocks(); out.push(`<h3>${inline(line.slice(2))}</h3>`); }
    else if (/^\s*-{3,}\s*$/.test(line)) { closeBlocks(); out.push("<hr/>"); }
    else if (line.startsWith(">")) {
      if (!quote) { closeBlocks(); out.push("<blockquote>"); quote = true; }
      out.push(inline(line.replace(/^> ?/, "")) + "<br/>");
    } else if (/^[-*] /.test(line)) {
      if (!list) { closeBlocks(); out.push("<ul>"); list = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (!line.trim()) {
      closeBlocks();
    } else {
      closeBlocks();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeBlocks();
  return out.join("\n");
}
