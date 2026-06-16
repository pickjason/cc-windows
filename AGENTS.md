# AGENTS.md

This file provides guidance to coding agents (Codex, etc.) when working with code in this repository.

> 注意:cc-window 监控/管理的目标产品是 **Claude Code**(它的 `claude` CLI、`~/.claude` 目录、`agents --json` 等都是真实事实,请勿改写成你自己所属的 agent 名)。本文件只是「写给在本仓库干活的 agent」看的说明。

## 项目本质

cc-window 是一个**本地网页版 Claude Code 多会话管理台**:一屏监控全机所有 Claude Code 会话状态、网页里新建会话、操作每个会话的交互式终端。仅监听 `127.0.0.1:4317`。

**奠基事实(动手前务必理解)**:Claude Code **没有**对外的 socket / 端口 / HTTP 查询接口。本项目的全部可观测性来自三件事的叠加,改任何状态/会话逻辑都绕不开这三个源:
1. **轮询** `claude agents --json`(源 A,全量会话真相 + busy/idle/waiting)
2. **tail** `~/.claude/monitor/events.jsonl`(源 B,hooks 写的秒级事件流,给出精确等待原因)
3. **自管 PTY**(用 `node-pty` 启动会话并桥接到浏览器 xterm.js)

详尽且已核实的事实在 `docs/02-claude-code-observability.md`——它是本仓库的基石文档,涉及 Claude Code 行为时先读它,不要凭记忆推断。

除实时管理外,还有一块**历史用量统计**(看板顶栏「📊 统计」入口):解析 `~/.claude/projects/**/*.jsonl` 历史记录,出活跃热力图 / token 趋势 / 日报等。它复用同一批 transcript 文件,但做的是「回看历史用量」,与上面三源「看实时状态」是**不同维度**。承接独立工具 cc-journal,合并设计见 `docs/11-merge-cc-journal.md`。

## 常用命令

```bash
npm install            # postinstall 自动 chmod +x node-pty 的 spawn-helper(见下方坑)
npm run dev            # 开发:vite(5173,HMR)+ 后端(4317),浏览器开 http://127.0.0.1:5173
npm run build && npm start   # 生产:构建后由后端单端口托管,开 http://127.0.0.1:4317
npm run typecheck      # tsc --noEmit —— strict + noUncheckedIndexedAccess,覆盖 server/web 含 *.test.ts
npx tsx web/terminalResize.test.ts  # 跑单个单元测试(无 npm test / 无 runner,逐个 tsx 跑)
npm run install-hooks  # = bash scripts/install-hooks.sh,装监控 hooks 到 ~/.claude/settings.json
```

- **没有 linter、没有测试 runner(无 `npm test`)**,但**有单元测试**:核心纯逻辑被抽到无副作用的小模块(`web/terminalResize.ts`、`server/tmux-handoff.ts` 等),每个配一个同名 `*.test.ts`,用 `node:assert/strict` 断言、末尾 `console.log("... passed")`,逐个 `npx tsx <file>.test.ts` 跑。**改这类逻辑前先看有没有对应 `.test.ts`,改完把它跑绿**。
- **完整校验仪式(见 `docs/10`)**:跑齐全部 8 个 `*.test.ts` + `npm run typecheck` + `npm run build`。`tsconfig` 开了 `strict` + `noUncheckedIndexedAccess`。
- hooks 安装器支持 `--dry-run`(只看 diff)与 `--uninstall`(只移除本工具的 8 个 hook,保留其它);写入前自动备份 settings.json。需要 `jq`。
- UI 改动按项目惯例用浏览器实机截图验证(mcp__claude-in-chrome)。

## 架构与数据流

### 后端(`server/`,tsx 直跑 TS,ESM,import 带 `.js` 后缀)
单进程 express + ws,`index.ts` 是装配点,把这些单例接起来:

- `roster.ts` `RosterPoller` — 源 A。每 1.5s 跑 `claude agents --json`。**关键:过滤掉 daemon 预热 worker**(命令行或父进程含 `--bg-spare`/`--bg-pty-host`),否则空闲 spare 会冒充「等待授权」挂一张永远点不掉的红卡。分类按 pid 缓存,ps 失败时 fail-open(宁可多显示一张也不误杀真实会话)。
- `events.ts` `EventTailer` — 源 B。轮询文件大小 + 增量读(不用 fs.watch),感知截断/轮转后重 seed。按 session_id 维护「最新事件态」。
- `transcript.ts` `ContextTracker` — 读各会话 transcript `.jsonl` 尾部 64KB 里最新 assistant 的 `message.usage`,估算上下文占用。分母固定 `CONTEXT_WINDOW_TOKENS=200_000`,UI 标「约」(1M 窗口会偏低)。
- `status.ts` `StatusEngine` — 把三源归一成 `SessionView[]` 广播给前端。**状态判定的核心原则:WORKING 只认 roster `busy`**;roster idle 一律不算工作中(跑过一轮的→`WAITING_INPUT`,全新的→`IDLE`),仅留 `WORKING_LEAD_MS=4s` 抢先窗口给「刚提交、roster 还没翻 busy」。改状态逻辑前先读 `docs/04-status-model.md`。
- `pty.ts` `PtyManager` — 见下节,最复杂的部分。
- `config.ts` — 所有路径、端口、轮询间隔、模型清单、tmux socket/前缀的单一来源。`encodeCwd` 把 cwd 的 `/` 和 `.` **都**替换成 `-`(故 `/Users/wang/.claude` → `-Users-wang--claude`,双横线)。
- `types.ts` — 前后端共享类型(vite 配了 `fs.allow:[".."]` 让 web 能 import 它)。
- `journal/`(历史用量统计,从 cc-journal 吸收,见 `docs/11`)— 解析栈:`scanner`/`parser`/`cache`(扫 `~/.claude/projects` + 流式解析 + 按 size/mtime 增量缓存到 `~/.claude-journal/`)→ `aggregate`(四桶 token 分离 + `message.id+requestId` 去重 + 跨文件去重 + 子代理归并)→ `service.ts`(内存态 + 15s 节流 + LLM 日报 inflight 去重)。`index.ts` 挂 `GET /api/journal/stats|summary`(拉取式,**不走 WS**)。纯逻辑 `types/util/aggregate/i18n` 与前端共用契约。**改统计口径前先读 `docs/11` §5,别重造去重逻辑**。数据目录用 `PATHS.journalDataDir`。

### PTY 与会话生命周期(`pty.ts`,改这里务必先读 `docs/03` 与 `docs/08`)
两种后端,启动时自动探测:
- **tmux 后端(默认,装了 tmux 时)**:用专用 socket `tmux -L ccwindow` 拉起 detached 会话,会话名 `ccw_<sessionId>`。node-pty 按需 attach 桥接。好处:本地可 `tmux -L ccwindow attach -t ccw_<id>` 接管同一会话;**服务重启会话不丢**——`discover()` 在启动时重新发现已存在的 `ccw_*` 会话并接管。
- **直连后端(无 tmux 降级)**:node-pty 直接 spawn claude,关服务即结束会话。

**网页 ⇄ 本地终端交接**(`docs/08`):`startMonitor()` 每 1s `list-clients` 比对客户端数——外部终端 attach 进来 ⇒ 本端断开转 `readonly`(靠 `capture-pane` 每 500ms 推整屏快照镜像,仅在有网页订阅时抓,省 CPU);外部终端关掉 ⇒ 自动 `ensureAttached` 收回转 `interactive`。`readonly` 态忽略一切键入/resize/切模型。

### 前端(`web/`,Vite + React + xterm.js)
- `main.tsx` 装配 `Board`(看板)+ `NewSession`(新建表单)+ `TerminalDock`(底部终端坞,内含多个 `TerminalPane`)。
- `ws.ts` 单一共享 `WsClient`(自动重连 + 离线发送队列),看板与所有终端面板共用一条连接。`ServerMsg`/`ClientMsg` 联合类型即 WS 协议契约,与 `server/index.ts` 的 switch 对应,改协议两边一起改。完整契约见 `docs/05-protocol.md`。
- 看板只读监控**全机**会话;只有 `managedByUs:true`(本台 PtyManager 启动)的会话能在网页操作——外部会话的输入绑在各自 TTY,无法跨进程注入。
- **统计视图**(`web/journal/`,见 `docs/11`):看板顶栏「📊 统计」切换。`JournalView` 拉 `/api/journal/stats` 渲染五块 ECharts 图(热力图/趋势/时段/项目/模型)+ 当日明细 + 日报(`DayReport` 走 `/api/journal/summary`);`EChart.tsx` 按需注册 echarts 部件;**整个视图 `lazy()` 懒加载**(echarts ~640KB 只在打开统计时拉,不拖累看板首屏)。切到统计时 `main.tsx` 把看板+终端坞 `display:none` 隐藏而非卸载,终端不断线。`web/journal` 只从 `server/journal/types` 取**类型**,格式化等 value 自带(避免 vite 解析服务端 `.js` 后缀的摩擦)。

## 已知坑(都已修,改相关代码勿回退)

- **`cleanEnv()` 必须剔除 `CLAUDECODE`/`AI_AGENT`/`CLAUDE_EFFORT`/所有 `CLAUDE_CODE_*`**。cc-window 常跑在某个 claude 会话内,带这些 env 会让被 spawn 的 claude 误判为「嵌套子会话」而**不在 `agents --json` 注册**(TUI 正常但看板看不到)。
- **node-pty 的 `prebuilds/darwin-*/spawn-helper` 缺执行位**会导致 `posix_spawnp failed`。`postinstall` 脚本自动 `chmod +x` 修复;别删那条 script。
- **`bin/cc-window.mjs`(npx / 全局安装入口)不能硬编码包内 `node_modules/.bin/tsx`**——npm/npx 安装会把 tsx **提升(hoist)到顶层** `node_modules`,包内那个路径不存在 → `spawn ENOENT`(本地开发因工作区恰有 `.bin/tsx` 而侥幸不报)。必须用 `createRequire().resolve("tsx/package.json")` 按 Node 解析向上查找,再 `node` 跑其 `bin` 指向的 cli。详见 `docs/10`。
- **未信任的新目录**首次启动会话时,claude 会在终端弹 trust 对话框,用户按 Enter 信任后会话才注册进 roster、才出现在看板。这是 claude 行为,非 bug。

## 文档约定

`docs/01–11` 是设计权威(中文,docs-first:多步功能先写文档再编码)。涉及会话状态、协议、可观测性、终端交接、用量统计的改动,**先读对应文档再动代码**:`01` 概览 / `02` 可观测性(基石) / `03` 架构 / `04` 状态模型 / `05` 协议 / `06` hooks / `07` 里程碑 / `08` 终端交接 / `09` UI 交互规格 / `10` 终端 resize 回环修复(含测试约定与 bin/tsx 坑) / `11` 合并 cc-journal(历史用量统计:解析栈/口径/前端 React 化)。已发布功能/修复的复盘日志按日期落在 `docs/progress/`。
