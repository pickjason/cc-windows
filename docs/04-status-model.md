# 04 · 状态模型

把三个来源(语义见 [02 文档](02-claude-code-observability.md))归一成**一个**会话状态枚举,供看板渲染。

## 统一状态枚举

| 状态 | 含义 | 看板颜色(建议) |
|---|---|---|
| `WORKING` | 正在思考/调用工具,一轮进行中 | 蓝色(动画) |
| `WAITING_PERMISSION` | 等你批准某个工具调用 | 红/橙(最高优先,需立即处理) |
| `WAITING_INPUT` | 干完了,等你的下一条 prompt | 黄色 |
| `IDLE` | 空闲(近期无活动) | 灰色 |
| `DONE` | 一轮刚结束(短暂态,很快转 IDLE 或 WAITING_INPUT) | 绿色 |
| `CLOSED` | 会话已不存在 | 移除卡片 |
| `ERROR` | 异常结束 | 红色叉 |

> `WAITING_PERMISSION` 与 `WAITING_INPUT` 的区分**只能**来自 Hooks 的 `Notification.notification_type`(见 02)。这是引入 Hooks 而非纯轮询的核心理由。

## 三源 → 枚举映射

### 源 A:`claude agents --json` 的 `status`(已实机验证:busy=正在处理、idle=停在 prompt 等输入,回完一轮约 1s 内翻回 idle)
| 原值 | 映射 |
|---|---|
| `busy` | `WORKING` —— **唯一权威的"工作中"来源** |
| `waiting` | 后台 `waitingFor` 含 "permission" → `WAITING_PERMISSION`;否则 `WAITING_INPUT` |
| `idle` | 取决于事件:跑过一轮(Stop / 工作事件)→ `WAITING_INPUT`;只 `SessionStart` / 无事件 → `IDLE` |
| 不在数组里 | `CLOSED`(卡片移除) |

### 源 B:`events.jsonl` 最新事件(按 `session_id`)
| 最新事件 | 含义 |
|---|---|
| `UserPromptSubmit` / `PreToolUse` / `PostToolUse` | 一轮进行中;但**只在 roster=busy 或刚提交的抢先窗口内**才算 WORKING(roster=idle 且已过窗口 → 视为已结束 → `WAITING_INPUT`) |
| `Notification` + `permission_prompt` | `WAITING_PERMISSION` |
| `Notification` + `idle_prompt` | `WAITING_INPUT`(注意:回完一轮**不一定**发此通知,主要靠 `Stop` + roster idle 判定) |
| `Stop` / `SubagentStop` | 一轮结束(roster idle 时 → `WAITING_INPUT`) |
| `SessionEnd` | `CLOSED`(`end_reason` 异常 → `ERROR`) |

### 源 C:Transcript(可选,仅取细节)
不参与主状态判定,只取展示字段:`lastTool`(最新 `tool_use` block 的 `.name`)、`contextUsedPct`(后续)。

## 合并规则(优先级,与 `server/status.ts` 一致)

对每个仍在 roster 的 `sessionId`(不在 roster → `CLOSED`,卡片移除):

```
1. Notification permission_prompt,或 roster waiting 且 waitingFor 含 "permission" → WAITING_PERMISSION
2. Notification idle_prompt                                                       → WAITING_INPUT
3. roster.status == busy                                                          → WORKING   (唯一"工作中"权威)
4. roster.status == waiting(非 permission)                                       → WAITING_INPUT
5. roster.status == idle:
   a. 最新是工作事件(UserPromptSubmit/PreToolUse/PostToolUse)且 now - ts < WORKING_LEAD_MS(~4s)
                                                                                  → WORKING   (抢先窗口:刚提交、roster 还没翻 busy)
   b. 最新是 Stop/SubagentStop,或工作事件已过抢先窗口                            → WAITING_INPUT (跑过一轮 → 等输入)
   c. 仅 SessionStart / 无信号                                                    → IDLE      (全新会话)
```

## 为什么 WORKING 只认 roster(取代旧的 120s 新鲜度门槛)

旧设计据"最新工作事件 + 120s 新鲜度"推断 WORKING,会让**已结束、等输入**的会话在最长 120s 内误显示"工作中"(尤其当 `Stop` 未成为最新事件时)。已实机验证 `claude agents --json` 的 `status` 可靠且回完一轮约 1s 翻回 idle,故改为:

- **WORKING 只来自 roster `busy`**;roster `idle` 一律不算工作中(跑过一轮 → 等输入,没跑过 → 空闲)。
- 唯一例外:`WORKING_LEAD_MS`(~4s)抢先窗口——用户刚提交、roster 尚未翻 busy 时,据工作事件提前显示 WORKING 提升响应;超窗仍 idle 即以 roster 为准。
- 崩溃/卡死会话:roster 通常会将其移出(→ `CLOSED`),无需再靠长门槛兜底。

`lastEventTs`(供抢先窗口判断与排序)取 `max(最新事件 ts, roster.startedAt)`。

> 实机轨迹(已验证):刚启动 `IDLE` → 提交后 `WORKING`(roster busy) → 回完 `WAITING_INPUT`(roster idle + Stop)。

## 边界情况

| 情况 | 处理 |
|---|---|
| `Stop` 每轮都触发 | 不把单个 `Stop` 当「空闲」;只有 `Stop` 是最新且随后 roster=idle 或来了 `idle_prompt` 才落定 `WAITING_INPUT`/`IDLE`。 |
| 会话崩溃 | 新鲜度门槛降级;roster 消失后转 `CLOSED`。 |
| 安装 hooks 前就存在的会话 | `events.jsonl` 里没有它,但 roster 有 → 直接用源 A 映射,照常显示。 |
| 同会话双终端 resume(未 fork) | 事件/transcript 会交织;以 roster 的单条 `status` 为准,事件仅作参考。 |
| 外部工具/手动开的会话 | 只在 roster 出现,无 PTY;看板显示状态,但不可在网页操作。 |
| 轮询间隙的瞬时不一致 | 事件提供中间态;每次 roster 刷新做一次权威校正。 |

## 数据结构(服务端内存)

```ts
interface RosterEntry {        // 源 A,每次轮询覆盖
  sessionId: string; pid: number; cwd: string;
  kind: "interactive" | "background"; startedAt: number;
  status: "idle" | "busy" | "waiting";
  id?: string; name?: string; waitingFor?: string; state?: string;
}
interface EventState {         // 源 B,按事件累积
  lastEvent: string;           // hook_event_name
  notificationType?: string;   // permission_prompt | idle_prompt | ...
  lastTool?: string;           // 来自 PreToolUse/PostToolUse 的 tool_name
  lastEventTs: number;         // ms
}
interface SessionView {        // 合并产物,广播给前端
  sessionId: string; name: string; cwd: string; projectName: string;
  kind: "interactive" | "background";
  status: "WORKING" | "WAITING_PERMISSION" | "WAITING_INPUT"
        | "IDLE" | "DONE" | "CLOSED" | "ERROR";
  lastTool?: string;
  lastActivityTs: number;
  managedByUs: boolean;        // 是否本工具启动(有 PTY、可操作)
}
```

## 排序(看板)

默认把"需要我处理"的排最前:
`WAITING_PERMISSION` > `WAITING_INPUT` > `WORKING` > `DONE` > `IDLE`,同组按 `lastActivityTs` 倒序。
