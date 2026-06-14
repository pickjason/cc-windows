import os from "node:os";
import path from "node:path";

/** 监听地址 —— 仅回环,绝不对外暴露。 */
export const HOST = "127.0.0.1";
export const PORT = 4317;

const HOME = os.homedir();

/** Claude Code 相关路径(已对照本机 v2.1.177 核实)。 */
export const PATHS = {
  /** ~/.claude */
  claudeDir: path.join(HOME, ".claude"),
  /** ~/.claude/settings.json */
  settings: path.join(HOME, ".claude", "settings.json"),
  /** ~/.claude.json —— 注意在 HOME 根,不在 .claude/ 内;projects 以【原始绝对路径】为 key */
  claudeJson: path.join(HOME, ".claude.json"),
  /** ~/.claude/projects —— 子目录名为【横线编码】的 cwd */
  projects: path.join(HOME, ".claude", "projects"),
  /** ~/.claude/monitor —— 本工具的事件目录 */
  monitorDir: path.join(HOME, ".claude", "monitor"),
  /** ~/.claude/monitor/events.jsonl —— hooks 写入、服务端 tail */
  eventsFile: path.join(HOME, ".claude", "monitor", "events.jsonl"),
} as const;

/**
 * 把 cwd 编码成 ~/.claude/projects 下的子目录名。
 * 已核实规则:把 `/` 与 `.` 都替换成 `-`(故 /Users/wang/.claude -> -Users-wang--claude,双横线)。
 * 见 docs/02-claude-code-observability.md。
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/** 该会话 transcript .jsonl 的绝对路径。 */
export function transcriptPath(cwd: string, sessionId: string): string {
  return path.join(PATHS.projects, encodeCwd(cwd), `${sessionId}.jsonl`);
}

/** 轮询与门槛(可调)。 */
export const ROSTER_POLL_MS = 1500;
/**
 * 「抢先窗口」:用户刚提交 prompt 时 UserPromptSubmit/PreToolUse 等 hook 即时到达,但 roster
 * 还没翻成 busy(轮询有 ≤ROSTER_POLL_MS 延迟)。这段时间内据事件提前显示 WORKING,提升响应感。
 * 超过此窗口仍 roster=idle,则以 roster 为准(说明已结束,不再算工作中)。设短以免误判。
 */
export const WORKING_LEAD_MS = 4000;

/**
 * tmux 后端:用专用 socket(`tmux -L <socket>`)隔离 cc-window 的会话,
 * 不污染用户默认 tmux,且专用 server 的环境从首次 cleanEnv 起就是干净的。
 * tmux 会话名 = `<前缀><claude sessionId>`,便于服务重启后重新发现并接管。
 */
export const TMUX_SOCKET = "ccwindow";
export const TMUX_SESSION_PREFIX = "ccw_";

/**
 * 模型清单 —— `--model` 接受别名(始终映射到最新)或完整模型名。
 * 别名 opus/sonnet/fable 来自 `claude --help` 示例(已核实);haiku 为常见别名(落地前实测)。
 * 见 docs/05-protocol.md。
 */
export interface ModelOption {
  value: string;
  label: string;
}
export const MODELS: ModelOption[] = [
  { value: "opus", label: "Opus 4.8" },
  { value: "sonnet", label: "Sonnet 4.6" },
  { value: "haiku", label: "Haiku 4.5" },
  { value: "fable", label: "Fable 5" },
];

/** 默认模型(新建会话表单默认选中)。 */
export const DEFAULT_MODEL = "opus";
