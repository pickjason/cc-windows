import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { transcriptPath, CONTEXT_WINDOW_TOKENS } from "./config.js";

export interface CtxInfo {
  ctxTokens?: number;
  ctxPct?: number;
  /** 该会话最近一条真人输入(单行、已截断),用于在看板区分同目录的多个会话。 */
  lastPrompt?: string;
}

/** 每轮读尾部多少:够拿 ctx,且能即时捕获刚提交的输入(重度工具活动会把旧输入推得更远,靠 sticky 缓存兜底)。 */
const TAIL = 256 * 1024;
/** 引导期一次性深扫上限:服务启动时输入可能已被埋在很靠前(实测可达数百 KB),回读至多这么多找回它。 */
const DEEP_CAP = 16 * 1024 * 1024;

/** 合成 / 非真人输入的 user 条目(中断标记、警示、slash 命令包裹、本地命令回显、系统提醒),抽取「最近输入」时跳过。 */
const SYNTHETIC_PROMPT_RE =
  /^\s*(\[Request interrupted|Caveat:|<command-|<local-command|<user-memory-input|<system-reminder)/;

/** 单行化、去标签、截断,作为卡片副标题展示。 */
function tidyPrompt(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/**
 * 从一条 transcript 条目里取「真人输入文本」;非真人输入(工具结果、sidechain、meta、合成标记)返回 null。
 * 真人 prompt 的 message.content 多为纯字符串;多模态时为数组,取其中 text 块。
 */
function userText(o: {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { content?: unknown };
}): string | null {
  if (o.type !== "user" || o.isSidechain || o.isMeta) return null;
  const c = o.message?.content;
  let raw = "";
  if (typeof c === "string") raw = c;
  else if (Array.isArray(c))
    raw = c
      .filter(
        (b): b is { type: string; text: string } =>
          !!b && b.type === "text" && typeof b.text === "string",
      )
      .map((b) => b.text)
      .join(" ");
  if (!raw.trim()) return null;
  // slash 命令:取命令名展示(如 /init),比当作合成消息丢掉更有信息量。
  const cmd = /<command-name>([^<]+)<\/command-name>/.exec(raw);
  if (cmd) return tidyPrompt(cmd[1]!);
  if (SYNTHETIC_PROMPT_RE.test(raw)) return null;
  return tidyPrompt(raw) || null;
}

/** 倒扫一段 transcript 文本:取最新 assistant.usage(ctx)与最近一条真人输入(prompt)。 */
function scanBack(
  text: string,
  want: { ctx: boolean; prompt: boolean },
): { ctxTokens?: number; ctxPct?: number; prompt?: string } {
  const lines = text.split("\n");
  const out: { ctxTokens?: number; ctxPct?: number; prompt?: string } = {};
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((!want.ctx || out.ctxTokens != null) && (!want.prompt || out.prompt != null)) break;
    const line = lines[i]!.trim();
    if (!line || line[0] !== "{") continue; // 跳过尾部 / 深扫起点截断的半行
    let o: {
      type?: string;
      isSidechain?: boolean;
      isMeta?: boolean;
      message?: { usage?: Record<string, number>; content?: unknown };
    };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (want.ctx && out.ctxTokens == null && o.type === "assistant" && o.message?.usage) {
      const u = o.message.usage;
      const tokens =
        (u.input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0);
      out.ctxTokens = tokens;
      out.ctxPct = Math.min(100, Math.round((tokens / CONTEXT_WINDOW_TOKENS) * 100));
      continue;
    }
    if (want.prompt && out.prompt == null) {
      const t = userText(o);
      if (t) out.prompt = t;
    }
  }
  return out;
}

async function readChunk(fh: FileHandle, start: number, len: number): Promise<string> {
  const buf = Buffer.alloc(len);
  await fh.read(buf, 0, len, start);
  return buf.toString("utf8");
}

/**
 * 上下文占用 + 最近输入追踪:读各会话 transcript 尾部,倒扫取:
 *  - 最新一条 assistant 的 message.usage → 估算上下文 token 与百分比;
 *  - 最近一条真人输入 → 卡片副标题,用于区分同目录会话。
 * 见 docs/02-claude-code-observability.md(面 3)。窗口大小随模型不同,这里用常见值近似,UI 标"约"。
 */
export class ContextTracker {
  private map = new Map<string, CtxInfo>();
  /** 已做过引导深扫的会话:确保深扫每会话最多一次(之后靠尾扫 + sticky 缓存)。 */
  private deepScanned = new Set<string>();

  get(sessionId: string): CtxInfo | undefined {
    return this.map.get(sessionId);
  }

  /** 刷新给定会话(sessionId+cwd)的上下文占用与最近输入;清理已消失的。 */
  async refresh(entries: { sessionId: string; cwd: string }[]): Promise<void> {
    const live = new Set(entries.map((e) => e.sessionId));
    for (const k of [...this.map.keys()]) if (!live.has(k)) this.map.delete(k);
    for (const k of [...this.deepScanned]) if (!live.has(k)) this.deepScanned.delete(k);
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
      if (size === 0) return null;
      const tailLen = Math.min(size, TAIL);
      const tail = await readChunk(fh, size - tailLen, tailLen);
      const s = scanBack(tail, { ctx: true, prompt: true });

      // sticky:尾部没扫到真人输入(被工具活动推到窗口之外)则沿用上次已知输入,避免标题闪空。
      const prev = this.map.get(sessionId)?.lastPrompt;
      let lastPrompt = s.prompt ?? prev;

      // 引导期:首次见到该会话、连尾部都没有输入、且文件比尾窗大 → 一次性回读历史找回最近输入。
      if (lastPrompt == null && !this.deepScanned.has(sessionId) && size > tailLen) {
        const from = Math.max(0, size - DEEP_CAP);
        const deep = await readChunk(fh, from, size - from);
        lastPrompt = scanBack(deep, { ctx: false, prompt: true }).prompt;
      }
      this.deepScanned.add(sessionId);

      const info: CtxInfo = { ctxTokens: s.ctxTokens, ctxPct: s.ctxPct, lastPrompt };
      return info.ctxTokens != null || info.lastPrompt != null ? info : null;
    } finally {
      await fh.close();
    }
  }
}
