import fs from "node:fs/promises";
import { transcriptPath, CONTEXT_WINDOW_TOKENS } from "./config.js";

export interface CtxInfo {
  ctxTokens: number;
  ctxPct: number;
}

/**
 * 上下文占用追踪:读各会话 transcript 尾部最新一条 assistant 的 message.usage,
 * 估算当前上下文 token(input + cache_read + cache_creation)与百分比。
 * 见 docs/02-claude-code-observability.md(面 3)。窗口大小随模型不同,这里用常见值近似,UI 标"约"。
 */
export class ContextTracker {
  private map = new Map<string, CtxInfo>();

  get(sessionId: string): CtxInfo | undefined {
    return this.map.get(sessionId);
  }

  /** 刷新给定会话(sessionId+cwd)的上下文占用;清理已消失的。 */
  async refresh(entries: { sessionId: string; cwd: string }[]): Promise<void> {
    const live = new Set(entries.map((e) => e.sessionId));
    for (const k of [...this.map.keys()]) if (!live.has(k)) this.map.delete(k);
    await Promise.all(
      entries.map(async (e) => {
        const info = await this.readOne(e.cwd, e.sessionId);
        if (info) this.map.set(e.sessionId, info);
      }),
    );
  }

  private async readOne(cwd: string, sessionId: string): Promise<CtxInfo | null> {
    if (!cwd) return null;
    const fh = await fs.open(transcriptPath(cwd, sessionId), "r").catch(() => null);
    if (!fh) return null; // transcript 还没生成
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 65536); // 只读尾部 64KB
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString("utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!.trim();
        if (!line || line[0] !== "{") continue; // 跳过尾部截断的半行
        let o: { type?: string; message?: { usage?: Record<string, number> } };
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        if (o.type !== "assistant") continue;
        const u = o.message?.usage;
        if (!u) continue;
        const tokens =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0);
        const pct = Math.min(100, Math.round((tokens / CONTEXT_WINDOW_TOKENS) * 100));
        return { ctxTokens: tokens, ctxPct: pct };
      }
      return null;
    } finally {
      await fh.close();
    }
  }
}
