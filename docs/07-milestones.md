# 07 · 里程碑路线图

每个里程碑都有**可见产出**与**验收标准**,按依赖顺序推进。MVP = M1–M5;M6 为打磨。

## 依赖图

```
M1 脚手架+Hooks ──► M2 后端状态引擎 ──► M3 只读看板(首个可见成果)
                                  │
                                  └──► M4 PTY 管理 ──► M5 终端面板+新建表单 ──► M6 打磨
```

---

## M1 · 脚手架 + Hooks 安装(基础)
**目标**:项目骨架就绪;事件能流进 `events.jsonl`。
**产出**:
- `package.json` / `tsconfig.json` / `vite.config.ts`,依赖装好(`express`、`ws`、`node-pty`、`react`、`@xterm/xterm`、`@xterm/addon-fit`、`tsx`、`typescript`、`vite`)。
- `scripts/install-hooks.sh`(见 [06 文档](06-hooks-setup.md)),写 `log.sh` + 幂等补 `settings.json`(先备份)。
- `server/config.ts`:端口、路径常量、cwd 横线编码/解码、模型清单。
- `git init`(若用户同意)。

**验收**:跑 `install-hooks.sh` 后,在任一会话触发事件,`~/.claude/monitor/events.jsonl` 出现正确 `session_id` + `hook_event_name` 行;触发授权出现 `permission_prompt`,空闲出现 `idle_prompt`。
**风险**:写 `settings.json` 属敏感操作——**实际写入前展示 diff 给用户确认**(规则 1)。

---

## M2 · 后端状态引擎(无 UI)
**目标**:三源归一,内存里有正确的 `SessionView[]`。
**产出**:
- `server/roster.ts`:每 1–2s `exec("claude agents --json")` → `Map<sessionId, RosterEntry>`;解析失败容错。
- `server/events.ts`:`tail -F events.jsonl`(或 `fs.watch` + 增量读)→ 按 `session_id` 累积 `EventState`。
- `server/status.ts`:合并 + 新鲜度门槛 → `SessionView[]`(逻辑见 [04 文档](04-status-model.md))。
- 临时:每秒把 `SessionView[]` 打到 console。

**验收**:手动开/关几个 `claude` 会话、触发授权,console 输出的状态与实际一致;杀掉一个会话后它在 ~120s 内(或 roster 消失即刻)转 `IDLE`/`CLOSED`,不会永远 WORKING。
**风险**:三套词汇归一的边界(见 04 边界表)需逐一测。

---

## M3 · 只读状态看板(首个可见成果)
**目标**:浏览器里看到全量会话的实时状态卡片。
**产出**:
- `server/index.ts`:express 起 `127.0.0.1:4317`,挂 `/ws`(`ws`),广播 `roster` / `status_update`(协议见 [05 文档](05-protocol.md))。
- `web/`:`main.tsx` + `ws.ts`(带重连)+ `Board.tsx` + `SessionCard.tsx`。
- 卡片显示:项目名(cwd basename)、kind 徽章、彩色状态、最后工具、"X 秒前";按 [04 文档](04-status-model.md) 排序(需处理的排前)。

**验收**:打开网页即看到所有会话;状态随真实活动秒级变化;关掉会话卡片消失。**此时已经解决"看不到全局状态"的核心痛点。**

---

## M4 · PTY 管理(后端能启动并桥接会话)
**目标**:服务端能在指定 cwd + model 下启动交互式 `claude`,I/O 可桥接。
**产出**:
- `server/pty.ts`:`PtyManager.spawn({cwd, model, name})` → `node-pty` 启动 `claude --model <m> --session-id <uuid> -n <name>`(cwd 经 node-pty `cwd` 选项);`onData`→WS、`write`/`resize`/`kill`。
- `server/recent-dirs.ts`:`GET /api/recent-dirs`(`~/.claude.json` projects + roster cwd)。
- `POST /api/sessions`、`GET /api/models`、WS 的 `launch`/`attach`/`term_input`/`term_resize`/`switch_model`。

**验收**:用 `curl`/WS 客户端发 launch,新会话在 roster 出现并能收到其 `term_output`;`term_input` 能驱动它。
**风险(关键)**:`node-pty` 含原生模块,**Node 25 下能否编译需先验证**。
**回退**:若 `node-pty` 不可用 → (a) 改用 `claude --worktree --tmux` 让 CLI 自管终端、本工具只读状态;或 (b) 退到「只监控」MVP(M1–M3 已完整可用)。

---

## M5 · 终端面板 + 新建会话表单(完整 MVP)
**目标**:网页里能新建会话、在 xterm.js 里操作它。
**产出**:
- `web/TerminalPane.tsx`:`@xterm/xterm` + `addon-fit`;`attach` 订阅、键入→`term_input`、resize→`term_resize`。
- `web/NewSession.tsx`:目录选择(输入框 + 最近目录快捷项)+ 模型下拉 + 启动。
- 看板卡片点击 → 打开/聚焦该会话终端面板;运行中模型切换(发 `/model`)。

**验收**:在网页选目录+模型 → 启动 → 终端可交互 → 看板状态联动 → 能回答授权提示。**G1–G4 全部达成。**

---

## M6 · 打磨(可选增强)
已做(本轮选定,均实机验证):
- ✅ **网页内结束会话**:dock 内联确认按钮「结束会话→确认结束?」+ WS `kill` / `DELETE /api/sessions/:id`,tmux 后端真正 `kill-session`;`term_exit` 自动关面板。
- ✅ **上下文占用**:`server/transcript.ts` 读各会话 transcript 尾部最新 `message.usage`,卡片/工具条显示 `ctx ~Nk · P%`(分母取常见窗口,标"约")。
- ✅ **健壮性**:`events.jsonl` 按行数滚动(超 `EVENTS_MAX_LINES` 留最后 `EVENTS_KEEP_LINES`,EventTailer 感知截断重 seed);PTY 输出 `TERM_FLUSH_MS`(16ms)节流合并。
- ✅ `install-hooks.sh --uninstall`(M1 即随安装器一并实现)。

未做(可选,未选):
- 一次性 token 鉴权(当前仅 127.0.0.1 + Origin 校验)。
- 多面板平铺布局、错误态/重连 toast 打磨。

---

## MVP 边界回顾

| 能力 | MVP? |
|---|---|
| 监控全量会话状态 | ✅ M3 |
| 网页新建会话(选目录/模型) | ✅ M5 |
| 网页操作交互式终端 | ✅ M5 |
| 运行中切模型 | ✅ M5 |
| worktree 隔离 / headless stream-json / 远程访问 | ❌ 非目标(见 [01 文档](01-overview.md)) |
