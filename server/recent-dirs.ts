import fs from "node:fs/promises";
import { PATHS } from "./config.js";
import type { RosterPoller } from "./roster.js";

export interface RecentDir {
  path: string;
  lastSessionAt: number; // epoch ms;无可靠时间戳的来源为 0
}

/**
 * 「最近用过的目录」:合并当前 roster 的 cwd(带 startedAt)与 ~/.claude.json 的 projects(原始绝对路径 key)。
 * 见 docs/02-claude-code-observability.md(面 3)与 docs/05-protocol.md。
 */
export async function recentDirs(roster: RosterPoller): Promise<RecentDir[]> {
  const map = new Map<string, number>();

  // 活跃会话的 cwd(有 startedAt)
  for (const r of roster.getMap().values()) {
    map.set(r.cwd, Math.max(map.get(r.cwd) ?? 0, r.startedAt ?? 0));
  }

  // ~/.claude.json 的 projects(无可靠"最近使用"时间戳 → 0)
  try {
    const raw = await fs.readFile(PATHS.claudeJson, "utf8");
    const json = JSON.parse(raw) as { projects?: Record<string, unknown> };
    for (const p of Object.keys(json.projects ?? {})) {
      if (!map.has(p)) map.set(p, 0);
    }
  } catch {
    /* 读不到就只用 roster */
  }

  return [...map.entries()]
    .map(([path, lastSessionAt]) => ({ path, lastSessionAt }))
    .sort((a, b) => b.lastSessionAt - a.lastSessionAt);
}
