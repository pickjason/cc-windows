# 03 · 架构

## 组件总览

```
┌────────────────────────── 浏览器 (Vite + React SPA) ──────────────────────────┐
│  ┌── 状态看板 Board ──┐  ┌── 新建会话 NewSession ──┐  ┌── 终端面板 Terminal ──┐ │
│  │ 全量会话卡片        │  │ 目录选择 + 模型下拉      │  │ xterm.js (每会话一个) │ │
│  │ 彩色状态/最后工具   │  │ 启动按钮                │  │ 双向输入/输出          │ │
│  └─────────┬──────────┘  └──────────┬──────────────┘  └──────────┬───────────┘ │
└────────────┼────────────────────────┼────────────────────────────┼─────────────┘
             │            WebSocket (状态广播 + 终端 I/O) + REST       │
┌────────────▼────────────────────────▼────────────────────────────▼─────────────┐
│                       Node + TypeScript 服务端 (127.0.0.1:4317)                  │
│  ┌── RosterPoller ──┐  ┌── EventTailer ──┐  ┌── StatusModel ──┐  ┌── PtyManager ─┐│
│  │ 每 1–2s 跑       │  │ tail -F         │  │ 三源归一 +      │  │ node-pty 启动 ││
│  │ agents --json    │  │ events.jsonl    │  │ 新鲜度门槛 →    │  │ 桥接 xterm.js ││
│  │ → 名册           │  │ → 按 sid 更新   │  │ 统一状态        │  │ 管生命周期    ││
│  └────────┬─────────┘  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘│
└───────────┼────────────────────┼────────────────────┼──────────────────┼────────┘
            │ exec               │ read               │                  │ spawn
   ┌────────▼─────────┐ ┌────────▼─────────┐           │         ┌────────▼─────────┐
   │ claude agents    │ │ ~/.claude/monitor│           │         │ claude --model X │
   │   --json         │ │   /events.jsonl  │◄──────────┘         │  --session-id..  │
   └──────────────────┘ └────────▲─────────┘   (StatusModel       │  (PTY 交互式)     │
                                 │ append       订阅两源)          └──────────────────┘
                        ┌────────┴─────────┐
                        │ ~/.claude/        │  hooks: 8 个事件 → log.sh → events.jsonl
                        │   settings.json   │
                        └───────────────────┘
```

## 数据流(三条)

### A. 状态流(监控,持续)
1. `RosterPoller` 每 1–2s `exec("claude agents --json")` → 解析为 `Map<sessionId, RosterEntry>`。
2. `EventTailer` `tail -F ~/.claude/monitor/events.jsonl`,每新行按 `session_id` 更新该会话的 `lastEvent` + `lastEventTs`。
3. `StatusModel` 订阅两者,合并 + 套新鲜度门槛 → 统一 `SessionView[]`。
4. 变化时通过 WebSocket 广播 `roster` / `status_update` 给所有浏览器。

### B. 新建会话流(launch)
1. 浏览器 `POST /api/sessions { cwd, model, name? }`。
2. 服务端生成 `sessionId = uuid()`,`PtyManager` 用 `node-pty` spawn:
   `claude --model <model> --session-id <sessionId> -n <name>`(`cwd` = 选定目录,通过 `node-pty` 的 `cwd` 选项设定)。
3. 该 PTY 注册进 `PtyManager`,后续 I/O 走 WebSocket。
4. 新会话很快出现在下一次 `agents --json` 轮询里,与 PTY 通过 `sessionId` 对上。

### C. 终端 I/O 流(操作,实时)
- 浏览器 `xterm.js` 输入 → WS `term_input { sessionId, data }` → `pty.write(data)`。
- PTY `onData` → WS `term_output { sessionId, data }` → `xterm.write(data)`。
- 窗口 resize → WS `term_resize { sessionId, cols, rows }` → `pty.resize(cols, rows)`。
- 运行中切模型 → WS `switch_model { sessionId, model }` → `pty.write("/model <model>\r")`。

> **PTY ↔ roster 对账**:cc-window 启动的会话有已知 `sessionId`,可直接和 `agents --json` 项匹配;用户在别处手动开的会话只出现在 roster 里(没有对应 PTY),看板照常显示状态,但「在网页里操作」仅限本工具启动的会话(无法接管外部 PTY)。

## 技术栈与依赖

| 用途 | 包 | 备注 |
|---|---|---|
| 后端语言 | TypeScript + Node 25 | `tsx` 跑 dev,`tsc` 编译 |
| HTTP / 静态 | `express` | 服务前端打包产物 + REST |
| WebSocket | `ws` | 状态广播 + 终端 I/O |
| 伪终端 | `node-pty` | 启动交互式 `claude`(需原生编译) |
| 前端构建 | `vite` + `react` + `react-dom` | SPA |
| 终端组件 | `@xterm/xterm` + `@xterm/addon-fit` | 浏览器终端 |
| 唯一 ID | Node 内置 `crypto.randomUUID()` | 免依赖 |

> `node-pty` 含原生模块,Node 25 下需确认可编译(里程碑 4 的风险点;若失败回退方案见 [07 文档](07-milestones.md))。

## 会话生命周期

```
launch ──► PtyManager.spawn(claude --session-id <uuid> --model X -n name)
            │  PTY alive,xterm 桥接
            ├─ roster 出现该 sessionId(idle/busy/waiting)
            ├─ events.jsonl 流入 UserPromptSubmit/PreToolUse/Stop/Notification
            │
            ├─ 用户在网页终端操作 / 回答授权
            │
exit ──────► PTY onExit  +  roster 不再含该 sessionId  +  (可能) SessionEnd 事件
            └─ 看板标记 CLOSED 后移除卡片
```

- **ID 与命名**:`--session-id` 用合法 UUID(对账);`-n` 给人类可读名(显示在卡片/标题)。
- **不自动 resume/fork**:MVP 不自动续接;`--resume`/`--fork-session` 留作后续功能。
- **worktree**:MVP **不强制**。如未来要并行隔离,优先用 Claude 自带 `-w/--worktree`(+ `--tmux`,需配 worktree),不手搓 tmux。
- **环境变量清理(已实测,关键)**:spawn 前必须剔除 Claude Code 自身注入的「本次调用/嵌套」环境标记 —— `CLAUDECODE`、`AI_AGENT`、`CLAUDE_EFFORT`、以及一切 `CLAUDE_CODE_*`(含 `CLAUDE_CODE_SESSION_ID`、`CLAUDE_CODE_CHILD_SESSION`)。否则,若 cc-window 服务端本身是在某个 claude 会话内启动的(开发时常见),被 spawn 的 claude 会继承这些标记、误判为「嵌套子会话」而**不在 `claude agents --json` 注册**(会话仍正常运行、TUI 正常,但看板看不到)。从普通终端启动服务端时这些变量本就不存在,剔除无副作用。实现见 `server/pty.ts` 的 `cleanEnv()`。
- **trust 门槛**:在**未信任**的新目录里启动会话,claude 会先弹「Is this a project you trust?」对话框;此时会话尚未注册进 `agents --json`(需用户在终端面板里按 Enter 信任后才注册)。在已信任目录(如你常用的项目)启动则直接进入。

### 启动后端:tmux(默认)/ 直连(降级)

`PtyManager` 有两套后端,启动时按 `tmux -V` 是否可用自动选择:

- **tmux 后端(装了 tmux 时)**:`tmux -L ccwindow new-session -d -s ccw_<sessionId> -c <cwd> 'claude --model … --session-id <uuid> -n <name>'` 拉起 **detached** 会话,再用 `node-pty` spawn `tmux -L ccwindow attach-session` 作桥接客户端。优势:
  - **本地可接管**:`tmux -L ccwindow attach -t ccw_<sessionId>` 在任意终端接管同一会话(网页与本地同屏)。该命令通过 `SessionView.tmuxTarget` 显示在终端面板工具条,点击复制。
  - **服务重启不丢**:tmux server 是独立 daemon,cc-window 退出只断开 attach 客户端,会话继续。重启时 `discover()` 用 `list-sessions` 重新发现 `ccw_*` 会话并接管(`pty` 置 null,首次 attach 时由 `ensureAttached()` 懒重连)。
  - **关闭面板 ≠ 关会话**:网页关 tab 只 detach;`shutdown()`(服务退出)也只 detach;只有显式 `kill()` 才 `kill-session`。
  - 专用 socket `-L ccwindow` 隔离,不污染用户默认 tmux;且 tmux `update-environment` 不复制 `CLAUDECODE`,与 `cleanEnv()` 双重保证不被误判为嵌套。
- **直连后端(无 tmux 时)**:`node-pty` 直接 spawn `claude`,功能等价但**关掉服务即结束会话**、不支持本地接管。
- 实现见 `server/pty.ts`(`launch`/`ensureAttached`/`discover`/`shutdown`/`kill`);socket 与前缀在 `server/config.ts`(`TMUX_SOCKET`/`TMUX_SESSION_PREFIX`)。已实机验证(tmux 3.6b):启动→注册→本地 attach 同屏→杀服务会话存活→重启 discover 接管→懒重连拿到输出。

## 目录结构

```
cc-window/
├─ package.json
├─ tsconfig.json            # 后端
├─ vite.config.ts           # 前端 + dev 代理 WS/REST 到后端
├─ scripts/
│  └─ install-hooks.sh       # 写 log.sh + 幂等补 settings.json(先备份)
├─ server/
│  ├─ index.ts               # express + ws 启动,装配各模块
│  ├─ config.ts              # 路径常量、端口、模型清单、cwd 编码/解码
│  ├─ roster.ts              # RosterPoller:exec agents --json → Map
│  ├─ events.ts              # EventTailer:tail events.jsonl → emit
│  ├─ status.ts              # StatusModel:三源归一 + 新鲜度门槛
│  ├─ pty.ts                 # PtyManager:spawn/bridge/resize/kill
│  └─ recent-dirs.ts         # 从 ~/.claude.json + roster 拉最近目录
└─ web/
   ├─ index.html
   ├─ main.tsx               # 挂载 + WS 客户端
   ├─ ws.ts                  # WebSocket 封装(重连)
   ├─ Board.tsx              # 状态看板
   ├─ SessionCard.tsx        # 单会话卡片(状态色、最后工具、几秒前)
   ├─ NewSession.tsx         # 目录选择 + 模型下拉 + 启动
   └─ TerminalPane.tsx       # xterm.js 面板
```

## 安全与隐私

- **只监听 `127.0.0.1:4317`**,不绑 `0.0.0.0`,不对外暴露。
- WebSocket/REST 校验 `Origin` 为本地;可选启动时生成一次性 token 放进页面(防止本机其它进程乱连)。
- **logger 默认不记 `prompt` 原文**(`events.jsonl` 只存事件类型/工具名/session_id/时间戳)。
- 不读 Claude Code 未公开内部文件(daemon/jobs)。
- 启动 `claude` 时不加 `--dangerously-skip-permissions`;授权由用户在终端面板里手动决定。
