# 09 · UI 交互逻辑全规格(重设计依据)

本文是 cc-window 当前前端的**完整交互行为契约**,刻意与具体视觉(配色/排版/组件库)解耦,供重设计 UI 时作为「不能丢的行为」清单。视觉随便改;但下列**数据字段、状态、动作、消息、规则**是后端契约,改 UI 时要么保留、要么连带改后端。

> 配套:状态判定见 [04](04-status-model.md);通信协议见 [05](05-protocol.md);终端交接见 [08](08-terminal-handoff.md)。

---

## 1. 顶层信息架构

单页,三个区域并存:

| 区域 | 组件 | 职责 | 何时显示 |
|---|---|---|---|
| **看板 Board** | `Board` + `SessionCard` | 全量会话卡片网格 + 顶栏统计 | 始终 |
| **新建会话弹窗 NewSession** | `NewSession`(模态) | 选目录/模型/名称/跳过授权 → 启动 | 点「新建会话」或点外部会话卡时 |
| **终端 Dock** | `TerminalDock` + `TerminalPane` | 底部停靠的多标签终端;每个打开的会话一个面板 | 至少打开一个面板时 |

数据全部来自**一条共享 WebSocket**(`web/ws.ts` 的 `WsClient`,自动重连 + 发送队列)。`/api/*` REST 仅用于首屏/兜底(models、recent-dirs)。

---

## 2. 核心数据模型(UI 渲染的唯一真相)

每个会话渲染自一个 `SessionView`(服务端 `server/types.ts` 合并产物,经 WS 全量下发):

| 字段 | 类型 | 含义 / UI 用途 |
|---|---|---|
| `sessionId` | string | 唯一键;卡片右下展示前 8 位 |
| `name` | string | 会话名(无则回退目录名 / sid 前 8) |
| `cwd` | string | 工作目录绝对路径(卡片 title、Dock 工具区展示) |
| `projectName` | string | `cwd` 的 basename;卡片主标题 |
| `kind` | `"interactive"` \| `"background"` | 交互式 / 后台;卡片 `ix` / `bg` 徽章 |
| `status` | `SessionStatus` | 见 §3;决定颜色/标签/排序/脉动 |
| `lastTool?` | string | 最近工具名;卡片「⚙ 工具」 |
| `lastActivityTs` | number(ms) | 最近活动时间;卡片「年龄」与排序次键 |
| `managedByUs` | boolean | 本工具启动(有 PTY、可操作)= 「本台」;否则「仅监控」 |
| `tmuxTarget?` | string | 本台 + tmux 后端时的 `tmux -L ccwindow attach -t …` 命令 |
| `ctxTokens?` | number | 近似上下文 token 数;卡片「ctx ~Nk」 |
| `ctxPct?` | number | 近似上下文占比;Dock 工具区「· N%」 |
| `bypassPermissions?` | boolean | 以 `--dangerously-skip-permissions` 运行;卡片「⚠ 跳过授权」徽章 |

> 关键派生关系(UI 不可自己瞎算,由后端给定):
> - `managedByUs`:仅本台会话可在网页**操作**(打开终端、切模型、结束);外部会话**只能看**。
> - `tmuxTarget`:仅本台 + tmux 后端才有。
> - `bypassPermissions`:由后端用 `ps` 探测命令行得出。

---

## 3. 会话状态机(`SessionStatus`)

| 状态 | 标签 | 颜色 | 脉动 | 排序权重 | 是否当前实际产出 |
|---|---|---|---|---|---|
| `WAITING_PERMISSION` | 等授权 | `#ef4444` 红 | 否 | 0(最前) | ✅ |
| `WAITING_INPUT` | 等输入 | `#f59e0b` 橙 | 否 | 1 | ✅ |
| `WORKING` | 干活中 | `#3b82f6` 蓝 | **是** | 2 | ✅ |
| `DONE` | 刚完成 | `#22c55e` 绿 | 否 | 3 | ⏸ 预留(当前不产出) |
| `IDLE` | 空闲 | `#6b7280` 灰 | 否 | 4 | ✅ |
| `ERROR` | 错误 | `#dc2626` 红 | 否 | 5 | ⏸ 预留 |
| `CLOSED` | 关闭 | `#374151` | 否 | 6 | ⏸ = 移出名册即移除卡片 |

- **排序**:先按状态权重升序(需要我处理的排最前),同权重按 `lastActivityTs` 倒序。「待处理」语义 = `WAITING_PERMISSION` + `WAITING_INPUT`。
- **判定来源**:`busy`→WORKING(唯一权威);`waiting`+permission→WAITING_PERMISSION;其余靠事件流。详见 [04](04-status-model.md)。重设计时**状态枚举与语义必须原样保留**,只可改它们的视觉呈现。
- 实务上当前只会看到 4 个活状态(WORKING / WAITING_PERMISSION / WAITING_INPUT / IDLE);DONE/ERROR/CLOSED 是模型预留位(CLOSED 表现为卡片消失)。

---

## 4. 看板 Board(`web/Board.tsx`)

**顶栏(header)元素与行为**

| 元素 | 内容 | 动作 |
|---|---|---|
| 品牌 | `cc-window` + 副标「Claude Code 会话台」 | 无 |
| 「＋ 新建会话」按钮 | — | 打开 NewSession(空目录) |
| 会话数 | `{N} 会话` | 无 |
| 待处理 | `{needsMe} 待处理`(仅 >0 时显示,橙色) | 无;needsMe = 等授权 + 等输入 数 |
| 连接指示 | `● 已连接`(绿)/ `○ 断开,重连中…`(红) | 反映 WS 连接状态 |

**主体**
- 空态:已连接→「暂无运行中的 Claude Code 会话。点「＋ 新建会话」开一个。」;未连接→「正在连接服务端…」。
- 否则:`SessionView[]` 渲染为卡片网格(顺序由后端排好,§3)。
- **年龄实时刷新**:本地每 1s 重算 `now`,驱动卡片「年龄」跳动(后端不必为此推送)。

---

## 5. 会话卡片 SessionCard(`web/SessionCard.tsx`)

**展示字段(从上到下)**
- 顶行:状态圆点(WORKING 时脉动) · 状态标签 · `kind` 徽章(`ix`/`bg`) · 【若 `bypassPermissions`】「⚠ 跳过授权」红徽章 · 右对齐的「本台」(绿)/「仅监控」(灰)徽章。
- 主标题:`projectName`(title 悬浮显示完整 `cwd`)。
- 底行:【若有】「⚙ {lastTool}」 · 【若有】「ctx ~{tokens}」 · 右对齐「{年龄}」 · sessionId 前 8 位。
- 左边框颜色 = 状态色;若该会话的终端面板已打开,卡片有「open」高亮轮廓。

**点击行为(二选一,取决于 `managedByUs`)**

| 会话类型 | 点击卡片 | title 提示 |
|---|---|---|
| 本台(`managedByUs=true`) | **打开该会话的终端面板**(Dock 中新增/激活 tab) | “点击打开终端” |
| 外部(`managedByUs=false`) | **打开 NewSession 并预填该 `cwd`**(引导你在同目录新建一个可操作会话) | “外部会话:仅监控…点击可在同目录新建一个可操作会话” |

> 年龄格式:`<60s`→`Ns`;`<60m`→`Nm`;`<48h`→`Nh`;否则`Nd`。token 格式:≥1000→`Nk`(≥10000 取整)。

---

## 6. 新建会话 NewSession(`web/NewSession.tsx`)

模态弹窗,点背景关闭。字段与校验:

| 字段 | 控件 | 说明 / 校验 |
|---|---|---|
| (顶部提示) | — | 若从外部会话卡进入(有预填目录),显示「外部会话只能监控…已为你预填该目录」 |
| 工作目录 | 文本输入 + datalist + 快捷 chips | 必填(空则「启动」禁用);chips 来自 `GET /api/recent-dirs`(最多 6 个);回车=启动 |
| 模型 | 下拉 | 来自 `GET /api/models`(Opus/Sonnet/Haiku/Fable);默认第一个 |
| 名称(可选) | 文本输入 | 空则后端用目录名;回车=启动 |
| 跳过授权 | 复选框(默认**关**) | 勾选 → 启动带 `--dangerously-skip-permissions`;带风险提示文案 |
| 操作 | 「取消」/「启动」 | 启动在无 cwd 时禁用 |

**启动流**:点「启动」→ WS 发 `launch { cwd, model, name?, skipPermissions }` → 关弹窗 → 服务端回 `launched { sessionId,… }` → 前端**自动打开该会话终端面板**并关闭弹窗。

> 重设计可改布局/字段顺序/chips 形态,但这些**入参字段(cwd/model/name/skipPermissions)与校验**要保留;recent-dirs / models 两个 REST 也要继续用。

---

## 7. 终端 Dock(`web/TerminalDock.tsx`)

底部停靠区,**仅当至少打开一个面板时出现**。结构:标签条 + 工具区 + 面板体。

**标签条(每个打开的面板一个 tab)**
- 显示会话名;点击 tab = 激活该面板。
- tab 上的「×」= **关闭面板**(`closeTerminal`)——注意:**只关网页面板,会话仍在后台跑**(title:“关闭面板(会话继续在后台运行)”)。

**工具区(针对当前激活会话 `av`)**

| 元素 | 条件 | 动作 / 说明 |
|---|---|---|
| ctx 占用 | 有 `ctxTokens` | 进度条 + 「ctx ~{tokens} · {pct}%」 |
| **「打开终端」按钮** | 有 `tmuxTarget` | 发 `open_terminal`;只读态时变「🔒 本地终端中」并高亮(见 §9) |
| attach 命令 | 有 `tmuxTarget` | `tmux -L ccwindow attach -t …`,**点击复制** |
| cwd | — | 灰色路径 |
| 切换模型 | — | 下拉「切换模型…」→ 发 `switch_model`;**只读态禁用** |
| **「结束会话」按钮** | — | **内联两段确认**:首点→「确认结束?」,再点→发 `kill`(tmux 后端真正 `kill-session`)。切 tab 重置确认 |

> 「关闭面板(×)」vs「结束会话」是两件事,重设计**务必保留这个区分**:前者不动会话,后者销毁会话。

**面板体**:每个打开的 id 一个 `TerminalPane`,仅激活的那个可见(其余 `display:none` 但保持挂载、继续接收输出)。

---

## 8. 终端面板 TerminalPane(`web/TerminalPane.tsx`)

基于 xterm.js,挂载即发 `attach`,卸载发 `detach`。两种模式:

**可交互(interactive,默认)**
- 键入 → `term_input`;容器尺寸变化(ResizeObserver/fit)→ `term_resize`;收 `term_output` → 写入终端。
- 若目标 tmux pane 遗留在 copy-mode,网页打开 interactive 面板前会先退出 copy-mode,避免重开面板仍显示 `[N/M]` 历史界面。

**只读(readonly,本地终端在驱动时)**
- **忽略键入**(不发 `term_input`,`disableStdin`);**不发 resize**;**忽略 `term_output`**。
- 收 `term_snapshot {data,cols,rows}` → 先按 tmux pane 的真实尺寸 resize xterm,再清屏回原点整屏重绘(capture-pane 镜像)。
- 顶角显示只读横幅「🔒 本地终端驱动中 · 只读」。
- 转回 interactive 时:恢复光标 + 重新 fit + 发一次 `term_resize` + 聚焦。

**其它**
- 收 `term_exit` → 在终端写「[会话已退出 code=N]」。
- 面板由隐藏变激活:重新 fit + 聚焦(只读态仅聚焦、不 resize)。

**滚动行为(tmux 后端)**
- tmux 后端默认 `mouse off`:网页 xterm 必须保留普通鼠标拖选与浏览器复制能力;不要为了 tmux 鼠标操作牺牲复制。
- 网页终端保留本地 xterm scrollback,并拦截 `wheel` 事件:滚轮只滚网页端本地历史,不发给 tmux、不进入 copy-mode。
- 网页 scrollback 只包含该面板打开后真实收到的 `term_output`;不把 tmux `capture-pane` 历史注入 live xterm,避免破坏光标/屏幕状态同步。
- 这样鼠标可以正常回看,同时避免滚轮误触后看到 tmux copy-mode 分隔线 / 状态标记(`[N/M]`)导致画面像“条纹”。
- 关闭网页面板不会改变 tmux 会话;若此前已通过其它入口进入 copy-mode,下次网页 interactive 打开时会自动收敛退出。
- readonly 镜像使用本地 tmux pane 的真实 `cols/rows` 渲染;若本地 Terminal 比网页更宽,网页只读容器允许横向滚动,避免强行折行导致选择器重影/残字。
- 新输出到达时,若当前视图本来在底部则自动跟随到底;若用户已经滚上去看历史,不强制拉回底部。
- **键盘 ↑/↓** 仍直达 claude,切换**输入历史**。
- 需要查看网页打开前的 tmux 历史或使用 tmux copy-mode 时,点「打开终端」在本地 Terminal 里接管该会话。

---

## 9. 终端交接状态机(interactive ⇄ readonly)

目的:终端 + 网页同时 attach 同一 tmux 会话会尺寸互抢、画面错位。规则:**任一时刻只有一个可交互客户端**。

```
 可交互 ──[外部客户端出现 / 点「打开终端」]──▶ 只读
   ▲                                            │
   └──────────[外部客户端归零]──────────────────┘
```

- **可交互**:cc-window 的 PTY attach 着,网页双向驱动。
- **只读**:cc-window 断开自己的 attach,改 `capture-pane` 整屏镜像;网页禁输入/禁 resize/禁切模型,显示只读横幅,「打开终端」按钮变「🔒 本地终端中」。
- 切换由服务端 ~1s 轮询 `list-clients` 自动驱动(点按钮与手动 `tmux attach` 殊途同归)。UI 只需**响应 `term_mode` 消息**切换呈现。详见 [08](08-terminal-handoff.md)。

---

## 10. 全量用户动作 → 消息 → 效果

| 用户动作 | 发出(C→S) | 效果 |
|---|---|---|
| 点「新建会话」/ 点外部会话卡 | —(开弹窗) | 打开 NewSession(后者预填 cwd) |
| 弹窗点「启动」 | `launch {cwd,model,name?,skipPermissions}` | 启动会话 → 回 `launched` → 自动开面板 |
| 点本台会话卡 | `attach {sessionId}` | 打开/激活其终端面板 |
| 关面板(tab ×) | `detach {sessionId}` | 仅关网页面板,会话继续 |
| 终端键入 | `term_input {sessionId,data}` | 写入 PTY(仅 interactive) |
| 面板尺寸变化 | `term_resize {sessionId,cols,rows}` | resize PTY(仅 interactive) |
| 切换模型下拉 | `switch_model {sessionId,model}` | 向 PTY 写 `/model …`(仅 interactive) |
| 点「打开终端」 | `open_terminal {sessionId}` | 本机 Terminal.app attach;本端转只读 |
| 点「结束会话」(二次确认) | `kill {sessionId}` | 真正结束会话(tmux kill-session) |

## 11. 全量实时消息(S→C)→ UI 反应

| 消息 | UI 反应 |
|---|---|
| `hello {version}` | 连接建立(无特别 UI) |
| `roster {sessions}` | **全量替换**会话列表(当前主推送方式) |
| `status_update {session}` | 单会话增量更新(协议已定义/前端已处理;服务端当前以 `roster` 全量推送为主) |
| `term_output {sessionId,data}` | 写入对应面板(只读态忽略) |
| `term_snapshot {sessionId,data,cols,rows}` | 只读态整屏镜像重绘;`cols/rows` 用于匹配本地 tmux pane 尺寸 |
| `term_mode {sessionId,mode}` | 切换该会话面板的 interactive/readonly 呈现 + Dock 工具态 |
| `term_exit {sessionId,code}` | 面板内提示已退出;`main` 自动关闭该面板 |
| `launched {sessionId,…}` | 自动打开该会话面板、关闭新建弹窗 |
| `error {message,sessionId?}` | 出错(如本地终端打开失败);当前未做显著 UI,可在重设计中补 toast |

---

## 12. 行为规则与边界(重设计必须沿用)

- **会话集合真相**:卡片集合 = 后端名册;**移出名册即移除卡片**(无显式 CLOSED 卡)。
- **本台 vs 仅监控**:只有 `managedByUs` 的会话可操作(开终端/切模型/结束);外部会话点击只引导新建。
- **跳过授权徽章**:`bypassPermissions` 的会话要醒目警示(高风险:免确认改文件/跑命令)。
- **关面板 ≠ 结束会话**:必须区分这两个动作。
- **结束会话需二次确认**(防误触)。
- **未信任目录**:首次在新目录启动会话,claude 会在终端弹「是否信任此文件夹」,用户需在终端按 Enter 确认后会话才进名册/上看板——这步无法在网页代办,重设计需有相应提示位。
- **断线**:WS 断开时显示「重连中」,`WsClient` 自动重连并回放发送队列;UI 不需手动重连。
- **会话退出自动收面板**:`term_exit` 到达即自动关该面板。
- **多面板**:可同时打开多个面板(多 tab),仅激活的可见但全部保持挂载与订阅。

## 13. 重设计自由度

| 可自由改 | 需保留(契约) |
|---|---|
| 配色、排版、组件库、动效、布局(网格/列表/分屏皆可) | `SessionView` 字段集与语义(§2) |
| 卡片信息密度、徽章样式、图标 | 7 状态枚举 + 语义 + 排序意图(§3) |
| Dock 位置/形态(底部/侧栏/独立窗) | 关面板/结束会话/打开终端/切模型/新建 这套动作(§10) |
| 新建表单的呈现 | 入参字段 cwd/model/name/skipPermissions(§6) |
| 只读横幅/提示的样式 | interactive⇄readonly 的响应逻辑(§8–9) |
| 是否补 toast / 空态插画 / 键盘快捷键 | WS 消息契约(§11)与 REST 端点 |

> 一句话:**数据契约与动作集不动,表现层随便重构。** 若要新增交互(如批量操作、分组、搜索、面板平铺),优先复用既有消息;需要新语义时同步改 `web/ws.ts` 协议类型 + 服务端 `server/index.ts` 分发 + [05 文档](05-protocol.md)。
