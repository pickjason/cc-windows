# 05 · 通信协议(REST + WebSocket)

服务端 `127.0.0.1:4317`。静态前端走 `GET /`;数据走 REST + 一个 WebSocket(`/ws`)。

## 鉴权(本地最小化)

- 仅监听回环;校验请求 `Origin` ∈ {`http://127.0.0.1:4317`, `http://localhost:4317`}。
- 启动时生成一次性 `token`,注入首页 HTML(`window.__CC_TOKEN__`);WS 连接与 REST 写操作需带该 token(头 `X-CC-Token` 或 WS 首帧)。防止本机其它进程乱连。读操作可放宽。

## REST 端点

### `GET /api/sessions`
返回当前 `SessionView[]`(结构见 [04 文档](04-status-model.md))。WS 会持续推送,REST 仅作首屏/兜底。

### `GET /api/models`
返回可选模型清单(见 [config](03-architecture.md) 与下文「模型清单」)。
```json
[ { "value": "opus",   "label": "Opus 4.8" },
  { "value": "sonnet", "label": "Sonnet 4.6" },
  { "value": "haiku",  "label": "Haiku 4.5" },
  { "value": "fable",  "label": "Fable 5" } ]
```

### `GET /api/recent-dirs`
从 `~/.claude.json` 的 `projects`(原始绝对路径 key)+ 当前 roster 的 `cwd` 合并去重,按最近优先,返回供「目录选择」快捷项。
```json
[ { "path": "/Users/you/IdeaProjects/stylePrompt", "lastSessionAt": 1781322213116 } ]
```

### `POST /api/sessions`  —— 新建会话
```json
// 请求
{ "cwd": "/Users/you/IdeaProjects/foo", "model": "opus", "name": "foo-feature" }
// 响应
{ "sessionId": "f1e2...", "name": "foo-feature", "cwd": "...", "model": "opus" }
```
服务端:校验 `cwd` 存在且是目录 → 生成 UUID → `PtyManager.spawn` → 返回。随后该会话的 I/O 走 WS。

### `DELETE /api/sessions/:sessionId`(可选)
对本工具启动的会话:优雅结束其 PTY(先发退出、超时再 kill)。不影响外部会话。

## WebSocket(`/ws`)

单连接,双向,JSON 文本帧。每帧 `{ "t": "<type>", ... }`。

### 服务端 → 客户端

| `t` | 载荷 | 时机 |
|---|---|---|
| `hello` | `{ token_ok: true, version }` | 连接建立 |
| `roster` | `{ sessions: SessionView[] }` | 首次 + 每次 roster 刷新(全量快照) |
| `status_update` | `{ session: SessionView }` | 单会话状态变化(事件驱动,秒级) |
| `term_output` | `{ sessionId, data }` | PTY 有输出(`data` 为原始终端字节串) |
| `term_exit` | `{ sessionId, code, signal }` | PTY 退出 |
| `term_mode` | `{ sessionId, mode: "interactive"\|"readonly" }` | 网页终端态变化(见 [08 文档](08-terminal-handoff.md)) |
| `term_snapshot` | `{ sessionId, data }` | 只读态周期推送的整屏快照(网页清屏后写入) |
| `launched` | `{ sessionId, name, cwd, model }` | 新会话已启动(对应某个 POST) |
| `error` | `{ message, sessionId? }` | 出错(如本地终端打开失败) |

### 客户端 → 服务端

| `t` | 载荷 | 动作 |
|---|---|---|
| `auth` | `{ token }` | 首帧鉴权(若用 token) |
| `attach` | `{ sessionId }` | 订阅某会话的 `term_output`(打开终端面板时) |
| `detach` | `{ sessionId }` | 取消订阅(关闭面板) |
| `term_input` | `{ sessionId, data }` | 写入 PTY(用户键入) |
| `term_resize` | `{ sessionId, cols, rows }` | `pty.resize` |
| `switch_model` | `{ sessionId, model }` | 向 PTY 写 `/model <model>\r`(仅 interactive 态生效) |
| `open_terminal` | `{ sessionId }` | 在本机 Terminal 打开并 attach;本端转只读(见 [08 文档](08-terminal-handoff.md)) |
| `launch` | `{ cwd, model, name? }` | 等价于 `POST /api/sessions`(WS 内便捷入口) |

> `term_input` / `term_resize` / `switch_model` 在 `readonly` 态被服务端忽略(此时本地终端在驱动)。

### 帧示例
```json
{ "t": "term_input",  "sessionId": "f1e2...", "data": "ls -la\r" }
{ "t": "term_output", "sessionId": "f1e2...", "data": "[32m..." }
{ "t": "status_update", "session": { "sessionId":"f1e2...", "status":"WAITING_PERMISSION", "lastTool":"Bash", ... } }
```

## 终端字节流约定

- `term_output` / `term_input` 的 `data` 是**原始终端字节**(含 ANSI 转义),前端直接喂 `xterm.write` / 后端直接 `pty.write`,服务端不解析、不改写。
- 大输出可能高频;前端按 `xterm` 默认缓冲即可。后端对单会话输出做轻量合并(如 16ms 节流)以降帧数(可选优化)。

## 模型清单(config)

`--model` 接受别名或完整模型名(见 [02 文档](02-claude-code-observability.md))。MVP 用别名(始终映射到最新):

| value(传 `--model`) | label(UI) | 置信度 |
|---|---|---|
| `opus` | Opus 4.8 | 已核实(help 示例) |
| `sonnet` | Sonnet 4.6 | 已核实(help 示例) |
| `fable` | Fable 5 | 已核实(help 示例) |
| `haiku` | Haiku 4.5 | 很可能(常见别名,落地前实测) |

> 也允许用户在输入框传完整模型名(如 `claude-opus-4-8`)。清单做成 config 常量,便于增改。
