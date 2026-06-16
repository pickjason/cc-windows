import fsp from "node:fs/promises";
import path from "node:path";
import { parseFile } from "./parser.js";
import { scanJsonlFiles } from "./scanner.js";
import type { ParsedFile } from "./types.js";

const CACHE_VERSION = 1;

interface CacheEntry {
  size: number;
  mtimeMs: number;
  parsed: ParsedFile;
}

interface CacheData {
  version: number;
  files: Record<string, CacheEntry>;
}

export interface RefreshProgress {
  (done: number, total: number, file: string): void;
}

async function loadCache(cachePath: string): Promise<CacheData> {
  try {
    const raw = await fsp.readFile(cachePath, "utf8");
    const data = JSON.parse(raw) as CacheData;
    if (data.version === CACHE_VERSION && data.files) return data;
  } catch {
    // 缓存不存在或损坏 → 全量重建
  }
  return { version: CACHE_VERSION, files: {} };
}

/**
 * 增量刷新:只重新解析新增/变化的 jsonl(按 size+mtime 判断),返回全部解析结果。
 */
export async function refresh(
  claudeDir: string,
  dataDir: string,
  onProgress?: RefreshProgress
): Promise<ParsedFile[]> {
  const cachePath = path.join(dataDir, "cache.json");
  const cache = await loadCache(cachePath);
  const files = await scanJsonlFiles(claudeDir);

  const stale: Array<{ file: string; size: number; mtimeMs: number }> = [];
  // 以缓存为基础:Claude Code 默认 30 天清理旧会话,源文件消失后保留已解析的历史,让 journal 长期积累
  const fresh: Record<string, CacheEntry> = { ...cache.files };

  for (const file of files) {
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      continue;
    }
    const hit = cache.files[file];
    if (!hit || hit.size !== st.size || hit.mtimeMs !== st.mtimeMs) {
      stale.push({ file, size: st.size, mtimeMs: st.mtimeMs });
    }
  }

  let done = 0;
  for (const { file, size, mtimeMs } of stale) {
    const base = path.basename(file);
    const forceSidechain =
      base.startsWith("agent-") || file.includes(`${path.sep}subagents${path.sep}`);
    const parsed = await parseFile(file, forceSidechain);
    fresh[file] = { size, mtimeMs, parsed };
    done++;
    onProgress?.(done, stale.length, file);
  }

  if (stale.length > 0) {
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(cachePath, JSON.stringify({ version: CACHE_VERSION, files: fresh }));
  }

  return Object.values(fresh).map((e) => e.parsed);
}
