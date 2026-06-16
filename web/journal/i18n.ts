// 历史用量统计视图的 UI 文案(zh/en),从 cc-journal web/app.js 的 I18N 移植。
// 与 server/journal/i18n.ts 不同:那份是日报 markdown + CLI 文案,这份是看板 UI 文案。
import type { DayOut, SessionOut } from "../../server/journal/types";
import { fmt, type Metric, totalTokens } from "./util";

export type Lang = "zh" | "en";

export interface JournalMessages {
  chipSessions: string;
  chipActiveDays: string;
  chipProjects: string;
  chipPrompts: string;
  chipOutput: string;
  chipTotal: string;
  lblYear: string;
  lblMetric: string;
  metricOptions: Record<Metric, string>;
  heatmapTitle: (y: string, m: string) => string;
  heatTip: (day: string, d: DayOut) => string;
  h2Trend: string;
  h2Hours: string;
  h2Projects: string;
  h2Models: string;
  sOutput: string;
  sInput: string;
  sCacheWrite: string;
  sCacheRead: string;
  hoursTip: (h: string | number, v: number) => string;
  dayTitle: (d: string) => string;
  daySummary: (d: DayOut) => string;
  sessionStats: (s: SessionOut) => string;
  noActivity: string;
  noSessions: string;
  untitled: string;
  footer: string;
  reportTitle: string;
  sessionsTitle: (n: number) => string;
  btnLlm: string;
  btnRegen: string;
  generating: string;
  cachedTag: string;
  ruleTag: string;
  reportFailed: (m: string) => string;
  calendarNameMap: "ZH" | "EN";
}

export const I18N: Record<Lang, JournalMessages> = {
  zh: {
    chipSessions: "会话",
    chipActiveDays: "活跃天",
    chipProjects: "项目",
    chipPrompts: "指令",
    chipOutput: "输出 tokens",
    chipTotal: "总 tokens",
    lblYear: "年份",
    lblMetric: "热力图指标",
    metricOptions: {
      totalTokens: "总 tokens",
      output: "输出 tokens",
      sessions: "会话数",
      userMessages: "指令数",
    },
    heatmapTitle: (y, m) => `${y} 活跃热力图 · ${m}`,
    heatTip: (day, d) =>
      `<b>${day}</b><br/>会话 ${d.sessions} · 指令 ${d.userMessages}<br/>` +
      `输出 ${fmt(d.usage.output)} · 总 ${fmt(totalTokens(d.usage))} tokens`,
    h2Trend: "每日 token 趋势",
    h2Hours: "时段分布(几点最肝)",
    h2Projects: "项目排行(输出 tokens)",
    h2Models: "模型分布(输出 tokens)",
    sOutput: "输出",
    sInput: "输入",
    sCacheWrite: "cache 创建",
    sCacheRead: "cache 读取",
    hoursTip: (h, v) => `${h} 点:${v} 条消息`,
    dayTitle: (d) => `当日明细 · ${d}`,
    daySummary: (d) =>
      `<b>${d.sessions}</b> 个会话 · <b>${d.userMessages}</b> 条指令 · ` +
      `输出 <b>${fmt(d.usage.output)}</b> / 输入 <b>${fmt(d.usage.input)}</b> / ` +
      `cache <b>${fmt(d.usage.cacheCreation + d.usage.cacheRead)}</b> tokens` +
      (d.sidechain.output > 0 ? ` · 其中子代理输出 ${fmt(d.sidechain.output)}` : ""),
    sessionStats: (s) =>
      `${s.userMessages} 条指令 · 输出 ${fmt(s.usage.output)} · 输入 ${fmt(s.usage.input)} · ` +
      `cache ${fmt(s.usage.cacheCreation + s.usage.cacheRead)} tokens`,
    noActivity: "这一天没有使用记录",
    noSessions: "这一天没有会话",
    untitled: "(无标题)",
    footer: "数据来源:~/.claude/projects · 本地离线解析,不上传任何数据",
    reportTitle: "📝 日报",
    sessionsTitle: (n) => `💬 会话(${n})`,
    btnLlm: "✨ LLM 日报",
    btnRegen: "重新生成",
    generating: "生成中…(约 20–60 秒,调用本机 claude)",
    cachedTag: "(缓存)",
    ruleTag: "规则提取 · 点右侧按钮生成 LLM 版",
    reportFailed: (m) => `生成失败:${m}`,
    calendarNameMap: "ZH",
  },
  en: {
    chipSessions: "sessions",
    chipActiveDays: "active days",
    chipProjects: "projects",
    chipPrompts: "prompts",
    chipOutput: "output tokens",
    chipTotal: "total tokens",
    lblYear: "Year",
    lblMetric: "Heatmap metric",
    metricOptions: {
      totalTokens: "Total tokens",
      output: "Output tokens",
      sessions: "Sessions",
      userMessages: "Prompts",
    },
    heatmapTitle: (y, m) => `${y} Activity Heatmap · ${m}`,
    heatTip: (day, d) =>
      `<b>${day}</b><br/>${d.sessions} sessions · ${d.userMessages} prompts<br/>` +
      `out ${fmt(d.usage.output)} · total ${fmt(totalTokens(d.usage))} tokens`,
    h2Trend: "Daily Token Trend",
    h2Hours: "Hourly Activity",
    h2Projects: "Top Projects (output tokens)",
    h2Models: "Models (output tokens)",
    sOutput: "Output",
    sInput: "Input",
    sCacheWrite: "Cache write",
    sCacheRead: "Cache read",
    hoursTip: (h, v) => `${h}:00 — ${v} messages`,
    dayTitle: (d) => `Day Detail · ${d}`,
    daySummary: (d) =>
      `<b>${d.sessions}</b> sessions · <b>${d.userMessages}</b> prompts · ` +
      `out <b>${fmt(d.usage.output)}</b> / in <b>${fmt(d.usage.input)}</b> / ` +
      `cache <b>${fmt(d.usage.cacheCreation + d.usage.cacheRead)}</b> tokens` +
      (d.sidechain.output > 0 ? ` · subagent out ${fmt(d.sidechain.output)}` : ""),
    sessionStats: (s) =>
      `${s.userMessages} prompts · out ${fmt(s.usage.output)} · in ${fmt(s.usage.input)} · ` +
      `cache ${fmt(s.usage.cacheCreation + s.usage.cacheRead)} tokens`,
    noActivity: "No activity on this day",
    noSessions: "No sessions on this day",
    untitled: "(untitled)",
    footer: "Data source: ~/.claude/projects · parsed locally, nothing is uploaded",
    reportTitle: "📝 Daily Report",
    sessionsTitle: (n) => `💬 Sessions (${n})`,
    btnLlm: "✨ LLM Report",
    btnRegen: "Regenerate",
    generating: "Generating… (~20–60s, via local claude CLI)",
    cachedTag: "(cached)",
    ruleTag: "rule-based · click the button for the LLM version",
    reportFailed: (m) => `Failed: ${m}`,
    calendarNameMap: "EN",
  },
};

export function detectLang(): Lang {
  try {
    const url = new URLSearchParams(location.search).get("lang");
    if (url === "zh" || url === "en") return url;
    const saved = localStorage.getItem("journal-lang");
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // location/localStorage 不可用时落默认
  }
  // cc-window 主体是中文 UI,默认 zh
  return (navigator.language || "").startsWith("en") ? "en" : "zh";
}
