import fsp from "node:fs/promises";
import path from "node:path";

/**
 * 递归扫描 ~/.claude/projects 下所有 jsonl:
 * 主会话在 <project>/<session>.jsonl,子代理转录在 <project>/<session>/subagents/agent-*.jsonl
 */
export async function scanJsonlFiles(claudeDir: string): Promise<string[]> {
  const projectsDir = path.join(claudeDir, "projects");
  let entries;
  try {
    entries = await fsp.readdir(projectsDir, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    // parentPath 需 Node ≥20.12,旧版用已废弃的 path 字段兜底
    const parent = (e as { parentPath?: string; path?: string }).parentPath ?? (e as { path?: string }).path;
    if (parent) out.push(path.join(parent, e.name));
  }
  return out.sort();
}
