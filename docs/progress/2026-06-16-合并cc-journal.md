---
日期: 2026-06-16
状态: 0.2.0 git 已推(`e428217` + tag `v0.2.0`,已 push origin);npm publish 交用户自行执行;随后 0.2.1 补「网页终端拖选/复制」修复(非本次工作)
关联: docs/11-merge-cc-journal / CHANGELOG.md / commits `ad27a7f`(功能)+ `e428217`(发版元数据) / tag `v0.2.0`
---

# 合并 cc-journal —— 历史用量统计并入看板(0.2.0)

## 背景与决策

[cc-journal](https://github.com/pickjason/cc-journal) 是同作者的另一个本地工具(独立 npm 包):解析 `~/.claude/projects/**/*.jsonl` 历史,给出活跃热力图、token 趋势、日报。与 cc-window 互补——**cc-window 看实时状态,cc-journal 看历史用量**。

用户问「是否直接合并进当前项目」。评估后给的判断:**不是无脑合并**,而是先摆清两者差异(实时 vs 历史、React+xterm+node-pty vs 静态页+ECharts、有无原生依赖、独立 npm 包),再让用户拍板。用户最终选定:

- **完全吸收**(代码搬进本仓库),不是独立包 + 互链;
- 前端**重写成 React 视图**(融入现有 React + Vite),不沿用 cc-journal 原生 JS 静态页;
- **不**移植 CLI 子命令,只做网页仪表盘(日报功能保留,走 API);
- 数据沿用 `~/.claude-journal/` → 老 cc-journal 用户解析历史无缝继承。

docs-first:先写 `docs/11`(设计权威),再补 `docs/01`(目标/范围/术语)、`docs/07`(里程碑 J1–J3),才动代码。

## 关键认识:cc-journal 模块按「有无副作用」一刀切

- **纯逻辑**(`types/util/aggregate/i18n`)— 无 node 依赖,前后端可共用契约;
- **仅服务端**(`scanner/parser/cache/summary`)— 碰 `node:fs` / `node:child_process`。

这条线决定了哪些能给前端复用。实际落地时前端**只取 types**(type-only import),格式化等 value 在 web 侧自带——绕开 vite 解析服务端 `.js` 后缀的潜在摩擦。

## J1 · 后端移植(`server/journal/`)

把 cc-journal 8 个核心文件搬进 `server/journal/`,新增 `service.ts`(从原 `server.ts` 抽出内存态 + 15s 节流 + LLM 日报 inflight 去重)。`config.ts` 加 `PATHS.journalDataDir`;`index.ts` 挂 `GET /api/journal/stats|summary`(拉取式,不走 WS)。**零新增运行时依赖**(丢 `commander`/CLI)。

唯一摩擦点:cc-window 开了 `noUncheckedIndexedAccess`、cc-journal 没开 —— `d.hours[h]++`、`s.msgs[0]`、`segs[len-1]` 等下标访问就地补守卫/`!`(预期内,量小)。

验证(隔离端口 4318,curl 实测):stats 返回全结构(真实历史 105 会话 / 29 活跃天 / 18 项目 / 5 模型 / 范围 2026-05-08→06-16);规则日报正确;`llm=1` **真调 `claude -p`** 生成浓缩日报正常(担心的 env 污染对 headless `-p` 无影响);二次请求命中落盘缓存;非法日期 400。`~/.claude-journal/summaries/` 里 6-11、6-12 旧日报还在 → 数据继承确认。

## J2 · 前端 React 化(`web/journal/`)

| 文件 | 职责 |
|---|---|
| `util.ts` | fmt / totalTokens / mdToHtml / timeRange / metricValue(web 自带,不跨 import 服务端 value) |
| `i18n.ts` | zh/en UI 文案(默认 zh) |
| `charts.ts` | 5 个纯函数 option 构造器,换 cc-window 暗色调色板(`--accent #34d399`) |
| `EChart.tsx` | echarts 薄封装:**tree-shaken 按需注册** + ResizeObserver + 点击 + dispose |
| `DayReport.tsx` | 规则/LLM 日报,切日防过期 |
| `JournalView.tsx` | 主视图,hook 顺序安全(useMemo 全在 early-return 之前) |

`main.tsx` 加「看板 \| 统计」切换;**整个统计视图 `lazy()` 懒加载**,切走时看板+终端坞 `display:none` 隐藏而非卸载(终端不断线)。

bundle 拆分(`npm run build`):看板 **457 KB**(127 KB gz)/ 统计+echarts **637 KB**(215 KB gz,按需拉)。

浏览器实测(隔离端口 4319,4 张截图):五块图 + chips + 当日明细 + 日报渲染正确,切日联动,← 看板往返**会话保活且持续刷新**。

## J3 · 文档收口

`CLAUDE.md` / `AGENTS.md` 各增 4 处(项目本质加统计维度、后端加 `journal/`、前端加统计视图、文档约定 01→11),两文件保持 body 同步。

## 自动验证

```bash
# 全部 *.test.ts(含并发会话新增的 pty-resize)+ typecheck + build 均绿
npx tsx server/*.test.ts ; npx tsx web/*.test.ts
npm run typecheck
npm run build
npm pack --dry-run    # 0.2.0 386 kB,dist/web(含懒加载 JournalView chunk)+ server/journal/ 都在内
```

## 发布状态

| 版本 | 内容 | git | npm |
|---|---|---|---|
| 0.2.0 | 历史用量统计(合并 cc-journal) | `ad27a7f`(功能)+ `e428217`(发版)+ tag `v0.2.0`,**已推 origin** | 交用户自行 `npm publish` |
| 0.2.1 | 网页终端拖选/复制修复(tmux 默认 `mouse off`)| —— | 非本次工作,用户/并发会话补 |

README 中英双语:新增「Analyze / 看用量」功能项 + 「Usage analytics / 历史用量统计」小节 + 截图(`docs/assets/journal.png`)+ docs 表加 11。

## 教训 / 事故

- **并发会话同时改本仓库**:整个过程中另一个 Claude 会话在改 `server/pty.ts` 并新建 `pty-resize.*`。提交时**显式列文件**(`git add <paths>`,不用 `git add -A`),把它的半成品挡在外面;它后来独立提交为 `52f70d7`。多会话工具改自己的仓库要特别小心提交边界。
- **截图自动抓取踩坑**:想给 README 配一张统计页真机图,但本机双屏 + 多 Chrome 窗口,统计标签不在任一屏最前窗口;且 MCP `computer` 截图工具存盘的文件 shell 读不到。`screencapture -R` 负坐标失败、按 display 抓又抓到别的窗口——典型 browser 自动化兔子洞,及时止损。最终按用户指示**直接取 cc-journal 仓库现成的 `docs/screenshot.png`**(caveat:那是独立版 branding「Claude Code Journal」,与合并后顶栏略有差异,内容/布局一致)。
- **`noUncheckedIndexedAccess` 是跨项目移植的固定摩擦**:从没开该选项的仓库搬代码进来,下标访问必然报一批,移植时一次性补齐即可。

## 归档

- `docs/11-merge-cc-journal.md`(合并设计权威,含统计口径 §5)
- `docs/progress/2026-06-16-合并cc-journal.md`(本文)
- `server/journal/*`(8 核心 + `service.ts`)/ `server/config.ts` / `server/index.ts`
- `web/journal/*`(`JournalView` / `EChart` / `charts` / `DayReport` / `util` / `i18n`)/ `web/main.tsx` / `web/Board.tsx` / `web/styles.css`
- `docs/01-overview.md` / `docs/07-milestones.md` / `CLAUDE.md` / `AGENTS.md`
- `README.md` / `README.zh-CN.md` / `docs/assets/journal.png` / `CHANGELOG.md` / `package.json`
