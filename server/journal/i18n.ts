export type Lang = "zh" | "en";

/** 优先级:--lang 参数 > JOURNAL_LANG > LC_ALL/LC_MESSAGES/LANG > Intl locale > en */
export function detectLang(explicit?: string): Lang {
  if (explicit === "zh" || explicit === "en") return explicit;
  const env =
    process.env.JOURNAL_LANG ||
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    process.env.LANG ||
    "";
  if (/zh/i.test(env)) return "zh";
  if (/^(en|c)(\.|_|$)/i.test(env)) return "en";
  try {
    if (/^zh/i.test(Intl.DateTimeFormat().resolvedOptions().locale)) return "zh";
  } catch {
    // 取不到 locale 时落到默认值
  }
  return "en";
}

interface CliMessages {
  parsing: string;
  refreshDone: (s: { sessions: number; projects: number; activeDays: number; start: string; end: string }) => string;
  statsTitle: string;
  statsOverview: (s: { start: string; end: string; projects: number; sessions: number; prompts: number; output: string }) => string;
  statsHeader: string;
  labelWidth: number;
  today: string;
  lastNDays: (n: number) => string;
  last14Title: string;
  topProjectsTitle: (n: number) => string;
  projectRow: (s: { sessions: number; output: string; total: string }) => string;
  serving: string;
  dataReady: (s: { sessions: number; activeDays: number; output: string }) => string;
  dashboardAt: string;
  generating: (model: string) => string;
}

export const CLI: Record<Lang, CliMessages> = {
  zh: {
    parsing: "解析中",
    refreshDone: (s) =>
      `完成:${s.sessions} 个会话 · ${s.projects} 个项目 · ${s.activeDays} 个活跃天 · 范围 ${s.start} ~ ${s.end}`,
    statsTitle: "Claude Code Journal — 统计速览",
    statsOverview: (s) =>
      `数据范围 ${s.start} ~ ${s.end} · ${s.projects} 项目 · ${s.sessions} 会话 · ${s.prompts} 指令 · 输出 ${s.output} tokens`,
    statsHeader: "  区间        会话   指令    输出      输入      cache",
    labelWidth: 10,
    today: "今天",
    lastNDays: (n) => `近 ${n} 天`,
    last14Title: "近 14 天输出 tokens:",
    topProjectsTitle: (n) => `项目排行(近 ${n} 天,按输出 tokens):`,
    projectRow: (s) => `${String(s.sessions).padStart(3)} 会话  输出 ${s.output.padStart(8)}  合计 ${s.total.padStart(9)}`,
    serving: "正在解析会话数据……",
    dataReady: (s) => `数据就绪:${s.sessions} 会话 · ${s.activeDays} 活跃天 · 输出 ${s.output} tokens`,
    dashboardAt: "Dashboard 已启动:",
    generating: (model) => `正在调用 claude(${model})生成日报……`,
  },
  en: {
    parsing: "Parsing",
    refreshDone: (s) =>
      `Done: ${s.sessions} sessions · ${s.projects} projects · ${s.activeDays} active days · range ${s.start} ~ ${s.end}`,
    statsTitle: "Claude Code Journal — Stats Overview",
    statsOverview: (s) =>
      `Range ${s.start} ~ ${s.end} · ${s.projects} projects · ${s.sessions} sessions · ${s.prompts} prompts · out ${s.output} tokens`,
    statsHeader: "  Period          Sess  Prompts    Output     Input      Cache",
    labelWidth: 14,
    today: "Today",
    lastNDays: (n) => `Last ${n} days`,
    last14Title: "Output tokens — last 14 days:",
    topProjectsTitle: (n) => `Top projects (last ${n} days, by output tokens):`,
    projectRow: (s) => `${String(s.sessions).padStart(3)} sess  out ${s.output.padStart(8)}  total ${s.total.padStart(9)}`,
    serving: "Parsing session data…",
    dataReady: (s) => `Data ready: ${s.sessions} sessions · ${s.activeDays} active days · out ${s.output} tokens`,
    dashboardAt: "Dashboard running at:",
    generating: (model) => `Generating report via claude (${model})…`,
  },
};

interface SummaryMessages {
  title: (day: string) => string;
  overviewLabel: string;
  overview: (s: { sessions: number; prompts: number; output: string; input: string; cache: string; total: string }) => string;
  noData: string;
  noSessions: string;
  projectHeading: (project: string, n: number) => string;
  untitled: string;
  llmPrompt: string;
}

export const SUM: Record<Lang, SummaryMessages> = {
  zh: {
    title: (day) => `# Claude Code 日报 · ${day}`,
    overviewLabel: "概览",
    overview: (s) =>
      `${s.sessions} 个会话 · ${s.prompts} 条指令 · 输出 ${s.output} / 输入 ${s.input} / cache ${s.cache} tokens(合计 ${s.total})`,
    noData: "无统计数据",
    noSessions: "当天没有会话记录。",
    projectHeading: (project, n) => `## ${project}(${n} 个会话)`,
    untitled: "(无标题)",
    llmPrompt: [
      // 标记开头,统计时排除本工具产生的会话,避免自指污染
      "[journal-summary] 你是我的工作日志助手。以下是我某一天使用 Claude Code 的会话素材(按项目分组,引用块是我当天发出的指令原文)。",
      "请基于素材写一份简洁的中文日报,要求:",
      "1. 按项目归纳当天做了什么,相关会话合并叙述;",
      "2. 明确区分「完成的事项」与「进行中/未完成的事项」;",
      "3. 保留素材开头的概览统计行;",
      "4. 末尾用一句话总结当天的工作主题;",
      "5. 只输出日报正文 markdown,不要解释。",
    ].join("\n"),
  },
  en: {
    title: (day) => `# Claude Code Daily Report · ${day}`,
    overviewLabel: "Overview",
    overview: (s) =>
      `${s.sessions} sessions · ${s.prompts} prompts · out ${s.output} / in ${s.input} / cache ${s.cache} tokens (total ${s.total})`,
    noData: "No data",
    noSessions: "No sessions on this day.",
    projectHeading: (project, n) => `## ${project} (${n} session${n > 1 ? "s" : ""})`,
    untitled: "(untitled)",
    llmPrompt: [
      "[journal-summary] You are my work journal assistant. Below is material from one day of my Claude Code usage (grouped by project; quoted lines are the prompts I sent that day).",
      "Write a concise daily report in English based on the material:",
      "1. Summarize per project what was done, merging related sessions;",
      "2. Clearly separate completed items from in-progress/unfinished items;",
      "3. Keep the overview stats line from the top of the material;",
      "4. End with a one-line summary of the day's overall theme;",
      "5. Output only the report markdown, no explanations.",
    ].join("\n"),
  },
};
