import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { AssistantEvent, ParsedFile, UserMessage } from "./types.js";
import { truncate } from "./util.js";

/** 非人工输入的 user 行(命令回显、hook 输出、续聊摘要等),不计入指令数 */
const SKIP_PREFIXES = [
  "Caveat:",
  "<command-name>",
  "<command-message>",
  "<local-command-stdout>",
  "<bash-input>",
  "<bash-stdout",
  "<bash-stderr",
  "<task-notification>",
  "<teammate-message",
  "<system-reminder>",
  "[Request interrupted",
  "This session is being continued from a previous conversation",
];

const EXCLUDE_MARKER = "[journal-summary]";
const MAX_USER_MESSAGES = 500;
const TEXT_LIMIT = 300;
const TITLE_LIMIT = 200;

function extractText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (item && typeof item === "object" && (item as any).type === "text") {
      const t = (item as any).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

function isHumanText(text: string): boolean {
  return !SKIP_PREFIXES.some((p) => text.startsWith(p));
}

/** 项目目录名兜底解码:-Users-wang-IdeaProjects-journal → journal */
function projectFromFilePath(filePath: string): string {
  const dir = path.basename(path.dirname(filePath));
  const segs = dir.split("-").filter(Boolean);
  return segs[segs.length - 1] ?? dir;
}

export async function parseFile(filePath: string, forceSidechain: boolean): Promise<ParsedFile> {
  const result: ParsedFile = {
    file: filePath,
    sessionId: null,
    project: projectFromFilePath(filePath),
    cwd: null,
    gitBranch: null,
    excluded: false,
    forceSidechain,
    firstTs: null,
    lastTs: null,
    firstUserMessage: null,
    userMessages: [],
    events: [],
  };

  const seenKeys = new Set<string>();
  let firstUserSeen = false;
  let lineNo = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (!result.sessionId && typeof obj.sessionId === "string") result.sessionId = obj.sessionId;
    if (!result.cwd && typeof obj.cwd === "string") {
      result.cwd = obj.cwd;
      result.project = path.basename(obj.cwd) || result.project;
    }
    if (!result.gitBranch && typeof obj.gitBranch === "string") result.gitBranch = obj.gitBranch;

    const ts: string | undefined = typeof obj.timestamp === "string" ? obj.timestamp : undefined;
    const sidechain = forceSidechain || obj.isSidechain === true;

    if (obj.type === "assistant" && obj.message) {
      if (!ts) continue;
      if (!result.firstTs) result.firstTs = ts;
      result.lastTs = ts;

      const usage = obj.message.usage;
      if (!usage) continue;
      const model: string = typeof obj.message.model === "string" ? obj.message.model : "unknown";
      if (model === "<synthetic>") continue;

      // 同一 API 响应的多个 content block 各占一行且重复携带完整 usage,必须按 message.id 去重
      const key = `${obj.message.id ?? obj.uuid ?? `${filePath}#${lineNo}`}:${obj.requestId ?? ""}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const ev: AssistantEvent = {
        key,
        ts,
        model,
        sidechain,
        usage: {
          input: usage.input_tokens ?? 0,
          output: usage.output_tokens ?? 0,
          cacheCreation: usage.cache_creation_input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
        },
      };
      result.events.push(ev);
      continue;
    }

    if (obj.type === "user" && obj.message?.role === "user" && !obj.isMeta) {
      if (!ts) continue;
      if (!result.firstTs) result.firstTs = ts;
      result.lastTs = ts;

      const raw = extractText(obj.message.content);
      if (!raw) continue;
      const text = raw.trim();
      if (!text || !isHumanText(text)) continue;

      if (!firstUserSeen && !sidechain) {
        firstUserSeen = true;
        if (text.startsWith(EXCLUDE_MARKER)) result.excluded = true;
        result.firstUserMessage = truncate(text, TITLE_LIMIT);
      }

      if (result.userMessages.length < MAX_USER_MESSAGES) {
        const msg: UserMessage = {
          uuid: typeof obj.uuid === "string" ? obj.uuid : `${filePath}#${lineNo}`,
          ts,
          text: truncate(text, TEXT_LIMIT),
          sidechain,
        };
        result.userMessages.push(msg);
      }
    }
  }

  return result;
}
