# 02 · Claude Code 可观测面(基石)

> 本文是整个项目的事实基础。所有结论均对照官方文档(code.claude.com/docs)并在本机 **Claude Code v2.1.177** 实机验证。每条标注置信度:`已核实` / `很可能` / `不确定`。
> ⚠️ Rule 3:实现时只能使用本文已核实的字段名、命令名、路径。凡标注「很可能 / 不确定」的,落地前需再次实测。

## 总览:五个可观测面

Claude Code 对外暴露的会话状态信息分两类:**PULL**(可随时主动查询)与 **PUSH**(按 CLI 的节奏被动收到)。

| # | 面 | 类型 | 给什么 | 本项目用途 |
|---|---|---|---|---|
| 1 | `claude agents --json` | PULL | 全量会话名册 + `idle/busy/waiting` 状态 | **主数据源(真相源)** |
| 2 | Hooks → 文件/HTTP | PUSH | 每事件带 `session_id`;唯一能区分「等授权 vs 等输入」 | 秒级跳变 + 精确等待原因 |
| 3 | Transcript `.jsonl` tail | PULL | 最后用的工具、token/上下文占用 | 可选的细节增强 |
| 4 | statusLine 命令 | PUSH | 每条回复后的 session JSON(cost/context) | 备选推送源(本项目暂不用) |
| 5 | `stream-json` 输出 | PUSH | 结构化事件流 | 仅当**自己启动** headless 会话时(未来扩展) |

> **重要否定结论(已核实)**:不存在任何文档化的本地 socket / TCP 端口 / HTTP API 可供外部查询会话状态。`~/.claude/daemon.*`、`~/.claude/daemon/roster.json`、`~/.claude/jobs/*` 确实存在,但是 Agent View 的**未公开内部实现**,会随版本变动——**不可依赖**。稳定契约只有 `claude agents --json`。

---

## 面 1 · `claude agents --json`(主数据源)

```bash
claude agents --json          # 活跃会话(交互式 + 后台),JSON 数组,无需 TTY,打印即退出
claude agents --json --all    # 额外包含已完成的后台会话(完整 Agent View 列表)
claude agents --json --cwd <path>   # 注意:--cwd 只过滤【后台】会话(按启动路径)
```

**本机实测输出(v2.1.177)**——交互式会话字段:

```json
{ "pid": 90207, "cwd": "/Users/wang/IdeaProjects/stylePrompt",
  "kind": "interactive", "startedAt": 1781322213116,
  "sessionId": "abe01846-ff0d-4402-bd2a-427b30f3155e", "status": "busy" }
```

后台会话额外带 `id` / `name` / `waitingFor` / `state`:

```json
{ "pid": 95259, "id": "601f830f", "cwd": "/Users/wang", "kind": "background",
  "startedAt": 1781368623052, "sessionId": "601f830f-...", "name": "601f830f",
  "status": "waiting", "waitingFor": "permission prompt", "state": "blocked" }
```

| 字段 | 类型 | 说明 | 置信度 |
|---|---|---|---|
| `pid` | number | 进程 PID | 已核实 |
| `cwd` | string | 会话工作目录(原始绝对路径) | 已核实 |
| `kind` | `"interactive"` \| `"background"` | 会话类型 | 已核实 |
| `startedAt` | number | 启动时间(epoch ms) | 已核实 |
| `sessionId` | string (UUID) | 会话 ID | 已核实 |
| `status` | `"idle"` \| `"busy"` \| `"waiting"` | 粗粒度状态 | 已核实 |
| `id` | string | 后台会话短 ID(仅 background) | 已核实 |
| `name` | string | 后台会话名(仅 background) | 已核实 |
| `waitingFor` | string | 等待原因,如 `"permission prompt"`(仅 background) | 已核实 |
| `state` | string | 如 `"blocked"`(仅 background) | 已核实 |

**结论**:这一条命令就给到「全机所有会话 + 状态」,是本项目唯一稳定、可轮询、可完整列举的源。它能列出**所有**会话——包括 cc-window 自己没启动的(用户手动开的、其它工具开的)。

> 注意:`--cwd` 的过滤只作用于后台会话(help 原文:"Show only background sessions started under <path>")。要按目录过滤交互式会话,需在本项目侧自行过滤数组。

---

## 面 2 · Hooks(PUSH 事件流)

### 完整事件清单(已核实存在)

`SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, PermissionRequest, PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, Stop, StopFailure, TeammateIdle, InstructionsLoaded, ConfigChange, CwdChanged, FileChanged, WorktreeCreate, WorktreeRemove, PreCompact, PostCompact, Elicitation, ElicitationResult, SessionEnd`

本项目只用其中 8 个:`SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification, Stop, SubagentStop, SessionEnd`。

### 每个事件 STDIN 收到的 JSON(公共字段,已核实)

每次 hook 触发,命令从 **STDIN** 收到一个 JSON,公共字段:

| 字段 | 说明 |
|---|---|
| `session_id` | 触发事件的会话 ID(**蛇形命名**) |
| `transcript_path` | 该会话 transcript `.jsonl` 的绝对路径 |
| `cwd` | 事件触发时的工作目录 |
| `hook_event_name` | 事件名,如 `"PreToolUse"` |
| `permission_mode` | `default`/`plan`/`acceptEdits`/`auto`/`dontAsk`/`bypassPermissions` |

> ⚠️ 坑:hook payload 里是 `session_id`(蛇形);transcript 文件**内部**同一个 ID 叫 `sessionId`(驼峰)。来源不同,命名不同,别搞混。

### 关键事件的专有字段

| 事件 | 额外字段 | 对状态的意义 |
|---|---|---|
| `SessionStart` | `source`(startup/resume/clear/compact)、`model` | 会话出现 |
| `UserPromptSubmit` | `prompt`(原始用户文本) | 一轮开始 → WORKING |
| `PreToolUse` | `tool_name`、`tool_input` | 工具活动 → WORKING |
| `PostToolUse` | `tool_name`、`tool_input`、`tool_response` | 工具完成 → WORKING |
| `Stop` | `message`(Claude 最终回复) | 一轮回复结束(**注意:每轮都触发,不等于空闲**) |
| `SubagentStop` | `agent_type`、`agent_id` | 子代理结束 |
| `Notification` | `notification_type`、`message` | **唯一能区分等待原因** |
| `SessionEnd` | `end_reason` | 会话结束 → CLOSED |

### Notification —— 区分「等授权 vs 等输入」的唯一来源(已核实)

`notification_type`(也可作 matcher)取值:

- `permission_prompt` — Claude 需要你批准某个工具调用 → **等授权**
- `idle_prompt` — Claude 干完了,在等你的下一条 prompt → **真·空闲/等输入**
- 其它:`auth_success`、`elicitation_dialog`、`elicitation_complete`、`elicitation_response`

> 这是**所有面里唯一**能把「等授权」和「等输入」分开的地方。`agents --json` 的 `status: "waiting"` 不总能说清是哪一种(交互式会话尤其)。

### settings.json hook 结构(已核实)

顶层 `hooks` 对象,按事件名索引;每个事件是一个 matcher 组数组:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [ { "type": "command", "async": true, "command": "..." } ] }
    ]
  }
}
```

- matcher:`""` / `"*"` / 省略 = 匹配全部;字母数字下划线竖线 = 精确/列表(如 `Bash`、`Edit|Write`);其它 = JS 正则。
- hook 类型:`command`(shell)、`http`(POST 到 url)、`mcp_tool`、`prompt`、`agent`。
- command hook 支持 `async`(不阻塞会话)、`asyncRewake`、`shell`、`timeout`、`if`、`once` 等。
- **退出码**:观测类 hook 一律 `exit 0` 并忽略输出(`exit 2` 会被当作 block/反馈)。`SessionStart`、`Notification` 等无法被 block。
- 同一事件的多个 hook 都会触发(文档称并行),命令完全相同的会去重 → **可与用户现有 analytics hooks 安全共存**。

> 读 payload 的方式:文档化做法是读 **STDIN**(`INPUT=$(cat)` 后用 `jq`)。用户现有 hooks 读的是 `$CLAUDE_TOOL_INPUT` / `$CLAUDE_TOOL_RESULT` **环境变量**——这在已装的 CLI 能用,但**不在当前文档**里,属于遗留/版本相关写法。本项目一律用 **STDIN + jq**(置信度:已核实文档;env 变量法标为「很可能/遗留」)。

### HTTP hook(备选,不写文件直接 POST)

```jsonc
{ "type": "http", "url": "http://127.0.0.1:4317/cc-events",
  "headers": { "Authorization": "Bearer $TOKEN" }, "allowedEnvVars": ["TOKEN"] }
```

本项目 MVP 选**写文件**(`events.jsonl` + tail)而非 HTTP,理由:解耦、可重放、不依赖服务端常驻在线。HTTP 留作后续可选。

---

## 面 3 · Transcript `.jsonl`(可选增强)

### 路径与目录名编码(已核实)

```
~/.claude/projects/<cwd 编码>/<sessionId>.jsonl
```

`<cwd 编码>` = 绝对路径,把 **`/` 和 `.` 都替换成 `-`**:

- `/Users/wang/IdeaProjects/cc-window` → `-Users-wang-IdeaProjects-cc-window`
- `/Users/wang/.claude` → `-Users-wang--claude`(点 → 横线,**双横线**)

> ⚠️ 坑:朴素的 `cwd.replaceAll('/','-')` 会漏掉点。两处编码不一致:`~/.claude.json` 的 `projects` 用**原始绝对路径**做 key,而 `~/.claude/projects/` 子目录名用**横线编码**。

### 行的 `type` 取值(本机实测)

`user`、`assistant`、`system`、`attachment`、`file-history-snapshot`、`last-prompt`、`mode`、`permission-mode`、`ai-title`、`queue-operation`。

> `tool_use` / `tool_result` **不是**顶层行——它们是 `assistant.message.content[]` / `user.message.content[]` 里的 content block。别在顶层 grep `type:"tool_use"`。
> `summary` 行类型版本相关,本机 v2.1.177 上**未出现**(改用 `ai-title`),不可硬依赖(置信度:不确定)。

### 如何推断「正在干活 vs 已结束」(已核实)

看最新一条有意义的行:

- `assistant` 行的 `message.stop_reason === "tool_use"` → 刚发起工具调用、**mid-turn 等结果** → WORKING
- `assistant` 行 `stop_reason ∈ {end_turn, stop_sequence, max_tokens}` → 一轮结束
- `user` 行 `message.content` 含 `{type:"tool_result"}` → 工具结果返回、模型将继续 → WORKING
- `system` 行 `subtype === "stop_hook_summary"` → Stop hooks 跑完、一轮结束 → 趋向 IDLE

「最后用的工具」= 最新 `assistant` 行里最后一个 `type:"tool_use"` content block 的 `.name`。
token/上下文:`assistant.message.usage`(`input_tokens`/`output_tokens`/`cache_*`)——**只有 token,没有美元成本**。

> ⚠️ transcript 里**没有** busy/idle 标志位;任何推断都必须配新鲜度门槛(见 [04 文档](04-status-model.md))。同一会话若在两个终端 resume(未 `--fork-session`)会交织进同一文件,顺序会乱。

### 其它本地元数据文件

- `~/.claude.json` → `projects[<原始绝对 cwd>]`:`lastSessionId`、`lastCost`、`lastModelUsage` 等(每目录一条「最近会话」索引,**不是**全量列表)。本项目用它拉「最近用过的目录」。
- `~/.claude/.session-stats.json`:`sessions[<id>] = { tool_counts, last_tool, total_calls, started_at, updated_at }`——但这是**用户/插件的 Stop hook 写的**,非核心保证文件(置信度:很可能)。
- 「有哪些会话」的权威来源 = `~/.claude/projects/<proj>/` 下的 `.jsonl` 文件集合(无 SQLite/db 索引,已核实无 `*.db`)。

---

## 面 4 · statusLine(本项目暂不用,备查)

`settings.json` 的 `statusLine: { type:"command", command, padding, refreshInterval, hideVimModeIndicator }`。命令每条 assistant 回复后从 STDIN 收到完整 session JSON(`session_id`、`transcript_path`、`model.{id,display_name}`、`cost.total_cost_usd`、`context_window.*`、`rate_limits.*` 等)。可 fire-and-forget POST 给面板,但只在 CLI 的触发时机跑、且会被新触发取消、慢脚本会拖累 UI。本项目用面 1+2 已足够,statusLine 留作未来「上下文占用条」数据源。

---

## 面 5 · `stream-json`(仅自启动 headless 会话时,未来扩展)

若改走「工具自己 headless 启动」:`claude -p --session-id <uuid> --output-format stream-json --verbose [--include-partial-messages]`,可直接解析 NDJSON 事件(`system/init`、`assistant`、`rate_limit_event`、`result`)拿到无歧义状态。本项目 MVP 走**交互式 PTY**(用户要"网页开真终端"),故此面暂不用;`--print` 模式下 stream-json 需 `--verbose`。

> 💸 注意:自 **2026-06-15** 起,订阅计划下 Agent SDK / `claude -p` 用量走独立的月度额度池。大量 headless fan-out 有成本影响——这也是 MVP 选交互式 PTY 而非 headless 的次要理由。

---

## 三套状态词汇对照(实现时必须归一)

同一个概念,不同来源用不同词,**必须在状态模型里归一**(见 [04 文档](04-status-model.md)):

| 来源 | 词汇 |
|---|---|
| `claude agents --json` `status` | `idle` / `busy` / `waiting` |
| Agent View TUI 标签 | Working / Needs input / Completed |
| 后台 job `state` / `tempo` | `working` / `blocked` |
| Hooks 事件 | UserPromptSubmit / PreToolUse / Stop / Notification(permission_prompt\|idle_prompt) / SessionEnd |

---

## 关键坑汇总(实现必读)

1. `session_id`(hook,蛇形) vs `sessionId`(transcript,驼峰)。
2. `Stop` 每轮回复都触发,**不是**可靠的「空闲」信号;真空闲看 `Notification.idle_prompt`。
3. 崩溃/被杀的会话会留下「像在 WORKING」的尾巴 → **必须**新鲜度门槛 + 用 `agents --json` 是否还在来回收。
4. 目录名编码把 `/` 和 `.` 都换成 `-`(双横线)。
5. `~/.claude.json` 用原始路径做 key,`projects/` 目录用横线编码。
6. `tool_use`/`tool_result` 是嵌套 content block,不是顶层行。
7. `agents --json --cwd` 只过滤后台会话。
8. `--session-id` 必须是合法 UUID;人类可读名用 `-n`。
9. `--tmux` 必须配 `--worktree`,不能单独用。
10. macOS 无 `timeout`(那是 GNU coreutils 的 `gtimeout`);需要超时就用「后台 PID + sleep + kill」。

## 来源

- 官方文档:`code.claude.com/docs/en/{hooks, hooks-guide, sessions, statusline, headless, cli-reference, agent-view, agent-sdk}`
- 本机实测(v2.1.177):`claude agents --json`、`claude --help`、`claude agents --help`、`~/.claude/projects/-Users-wang-IdeaProjects-cc-window/*.jsonl`、`~/.claude/settings.json`、`~/.claude.json`
