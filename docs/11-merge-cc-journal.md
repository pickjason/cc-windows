# 11 · 合并 cc-journal —— 历史用量统计并入看板

> 本文是「把 cc-journal 吸收进 cc-window」这件事的设计权威。动手前读它,涉及统计口径/解析逻辑的改动先回这里对齐,不要凭记忆推断 cc-journal 的行为(它的去重口径很容易做错)。

## 1. 背景与目标

[cc-journal](https://github.com/pickjason/cc-journal)(`~/IdeaProjects/journal`,npm 包名 `cc-journal`)是同作者的另一个本地工具:解析 `~/.claude/projects/**/*.jsonl` 历史记录,给出 GitHub 风格活跃热力图、token 趋势、时段分布、项目/模型排行、当日明细与日报(可选 `claude` CLI 浓缩)。100% 本地、零网络。

两者定位互补:**cc-window = 实时操控正在跑的会话;cc-journal = 回看已结束会话的用量**。决定把后者**完全合并进 cc-window**,达到「一个包、一个端口(4317)、一次安装」,看板新增一个「统计」视图。

**已确定的范围决策**(2026-06-16):
- 整合方式 = **吸收式合并**(代码搬进本仓库),不是独立包 + 互链。
- 前端 = **重写成 React 视图**(融入现有 React + Vite 前端),不沿用 cc-journal 的原生 JS 静态页。
- **不**移植 CLI 子命令(`stats`/`summary`),只做网页仪表盘。日报功能保留(走 API)。
- 数据目录沿用 `~/.claude-journal/` → **老 cc-journal 用户的解析历史无缝继承**。

## 2. 关键事实:cc-journal 的模块可按「有无副作用」一刀切

移植前先认清边界——这决定了哪些代码能被前端直接复用、哪些只能留在服务端:

| 模块 | 依赖 | 归属 | 说明 |
|---|---|---|---|
| `types.ts` | 纯类型 | **共享(web+server)** | `Usage`/`ParsedFile`/`AggregateResult` 等契约 |
| `util.ts` | 纯函数 | **共享(web+server)** | `fmtTokens`/`localDay`/`localHour`/`totalTokens` 等,前端画图也要用 |
| `aggregate.ts` | 纯函数 | **共享(web+server)** | 把 `ParsedFile[]` 归并成 `AggregateResult`;无 node 依赖 |
| `i18n.ts` | 纯数据 | **共享(web+server)** | zh/en 文案 |
| `scanner.ts` | `node:fs` | server | 递归扫 `~/.claude/projects` |
| `parser.ts` | `node:fs` | server | 单文件流式解析 + 去重 |
| `cache.ts` | `node:fs` | server | 按 size+mtime 增量刷新,落 `cache.json` |
| `summary.ts` | `node:child_process` | server | 规则日报 + 调 `claude -p` 的 LLM 日报 |

cc-window 的 `vite.config.ts` 已配 `fs.allow:[".."]`,web 可直接 `import` 服务端的纯模块(`types.ts` 现已这么共享)。所以 `aggregate/util/types/i18n` 移植后**前后端共用同一份**,不重复实现。

## 3. 后端集成设计

### 3.1 文件落位
全部搬进 `server/journal/`(ESM,import 带 `.js` 后缀,与本仓库一致):

```
server/journal/
  types.ts  util.ts  aggregate.ts  i18n.ts      # 纯逻辑,web 也 import
  scanner.ts  parser.ts  cache.ts  summary.ts    # 仅服务端(碰 node)
  service.ts                                      # 新增:内存态 + 节流(从原 server.ts 抽出)
```

- 丢弃 `cli.ts`(CLI 不移植)与 `server.ts`(其 HTTP 壳由 cc-window 的 express 取代)。
- 丢弃 `commander` 依赖(只服务 CLI)——**合并不新增任何 npm 运行时依赖**。

### 3.2 配置接线(`server/config.ts`)
新增一个路径常量,复用已有的 `PATHS.claudeDir`:

```ts
// PATHS 内追加
journalDataDir: path.join(HOME, ".claude-journal"),   // 解析缓存 + 生成的日报
```

cc-journal 原本把 `claudeDir`/`dataDir` 当参数层层传递;合并后统一从 `config.ts` 取。

### 3.3 内存态与节流(`server/journal/service.ts`)
照搬原 `server.ts` 的 `getAgg` + `handleSummary` 逻辑,抽成模块级单例:

- `getStats(force=false): Promise<AggregateResult>` —— 缓存 15s(`REFRESH_INTERVAL_MS`),并发刷新合并到同一个 in-flight Promise。
- `getSummary(params): Promise<{status, body}>` —— 规则日报即时;LLM 日报按 `date:model:lang` 做 in-flight 去重 + 按天落盘缓存(`journalDataDir/summaries/<date>-llm.<lang>.md`),避免重复烧用量。
- **首次解析惰性触发**:第一次访问 `/api/journal/stats` 时全量解析(几秒),之后增量秒级。**不**在 cc-window 启动时同步解析,以免拖慢看板启动;可选在 `main()` 里 `void getStats()` 后台预热(文档建议预热,失败静默)。

### 3.4 API 路由(`server/index.ts`)
挂到现有 express app,统一 `/api/journal/*` 命名空间(避免与看板的 `/api/sessions` 等冲突):

```ts
app.get("/api/journal/stats",   async (req, res) => res.json(await getStats(req.query.refresh === "1")));
app.get("/api/journal/summary", async (req, res) => { const { status, body } = await getSummary(req.query); res.status(status).json(body); });
```

WebSocket 协议(`docs/05`)**不动**——统计是请求/响应式拉取,不需要推送。

## 4. 前端 React 化设计(`web/`)

### 4.1 依赖与导航
- `package.json` 新增运行时依赖 `echarts`(原 cc-journal 用 vendor 打包的 1MB 文件;React 化后改用 npm 包,经 Vite 打包。**bundle 体积 +~1MB**,后续可切 `echarts/core` 按需引入瘦身——见 §8)。
- `web/main.tsx` 顶部加视图切换:**「看板 | 统计」**。选中「统计」渲染 `<JournalView>` 取代 `<Board>`;终端坞(`TerminalDock`)是否保留待 M2 实机定。

### 4.2 视图结构(对照 cc-journal `web/index.html` + `app.js` 的 583 行逐图移植)
`web/journal/JournalView.tsx` 持有一次拉取的 `AggregateResult`,下分组件:

1. **活跃热力图** —— ECharts `calendar` + `heatmap`;指标可切(总 tokens / 输出 tokens / 会话数 / 指令数);年份可切;点某天 → 加载当日明细。
2. **每日 token 趋势** —— 堆叠柱(input / output / cacheCreation / cacheRead;**cache 默认隐藏**,量级约大 100 倍,图例可开)。
3. **时段分布** —— 0–23 小时柱状。
4. **项目排行 / 模型分布** —— 按输出 tokens 排序的横向柱。
5. **当日明细** —— 选中日的会话列表(时间段/项目/首条指令/用量)+ 日报区:默认规则日报,按钮触发 `/api/journal/summary?...&llm=1` 生成 LLM 浓缩版。

数值格式化、归天/归时复用共享的 `util.ts`(`fmtTokens`/`localDay`…),不在前端重写。

### 4.3 i18n
cc-journal 自带 zh/en;cc-window 当前看板是纯中文。**第一版默认 zh**,但保留 `i18n.ts` 文案结构,统计视图内可挂 zh/en 切换(低优先,M3 视情况开)。

### 4.4 dev 代理
`/api/journal/*` 在 `/api` 之下,`vite.config.ts` 现有的 `/api` 代理已覆盖,无需改 proxy。

## 5. 统计口径(原样继承,严禁重造)

cc-journal 的这些口径是它的核心价值,移植时**逐字保留**,不要"优化":

- **四桶 token 分开**(input / output / cacheCreation / cacheRead),混算会虚高约 100×;
- 按 `message.id + requestId` 行内去重(一次响应多行各带完整 usage);
- 跨文件全局去重(fork/resume 复制历史行),按 `firstTs` 排序使用量归属原始会话;
- 子代理(`agent-*.jsonl` / `subagents/`)用量计入总量,**不**算独立会话;
- 只统计人工输入指令(过滤命令回显/hook 输出/工具结果,见 `parser.ts` 的 `SKIP_PREFIXES`);
- 按**本地时区**归天/归小时;
- 排除本工具自身日报会话(`[journal-summary]` 标记)。
- `~/.claude-journal/cache.json` 以缓存为基础合并:Claude Code 默认 30 天清理旧会话(`cleanupPeriodDays`),源文件消失后保留已解析历史 → 热力图自首次运行起只增不减。

> 与看板的关系:看板的三大实时源(`docs/02`)是「现在的状态」;journal 复用的是同一批 transcript 文件,但做的是「历史用量分析」,是**另一维度**,彼此不耦合。`transcript.ts` 的 `ContextTracker` 只读尾部 64KB 估上下文,是 journal 全量解析的浅版本,二者各管各的,暂不合并解析逻辑。

## 6. 打包与校验

- `package.json`:`dependencies` 加 `echarts`;`files` 无需新增条目(`server/` 已含 `server/journal/`,`dist/web` 已含 React 构建产物)。
- `tsconfig` 的 `include:["server","web"]` 已覆盖新文件;注意 **`noUncheckedIndexedAccess`**:cc-window 开了、cc-journal 没开,移植代码里 `s.msgs[0].ts`、`agg.days[d]`、`d.hours[h]` 等下标访问会报错,需补守卫或 `!`(预期是小批量、机械性修复)。
- 校验仪式(`docs/10`):全部 `*.test.ts` + `npm run typecheck` + `npm run build`;UI 用浏览器实机截图验证。M2 视情况给 `aggregate`/`fmtTokens` 之类纯函数补 `*.test.ts`。

## 7. 里程碑

- **M1 后端移植**:`server/journal/` 落 8 个核心文件 + `service.ts`;`config.ts` 加 `journalDataDir`;`index.ts` 挂 `/api/journal/stats|summary`;过 typecheck;`curl` 验证 stats(含 totals/days/projects/models/sessions)与 summary(规则版 + `llm=1` 版)。
- **M2 前端 React 化**:加 `echarts` 依赖;`JournalView` + 五块图/明细;`main.tsx` 加「看板 | 统计」切换;浏览器实机截图验证每块图与当日明细/日报。
- **M3 收尾**:LLM 日报联调与错误态(claude 不在 PATH 的降级提示);i18n(默认 zh);文档收口(`CLAUDE.md`/`AGENTS.md` 增 journal 段落、本文定稿、`docs/01` 概览补一句);`package.json` deps 核对。

## 8. 风险与取舍

- **bundle +1MB**:ECharts 全量引入。第一版求快,M2 后可换 `echarts/core` + 按需 `use([...])` 瘦身(热力图 `CalendarComponent` + `HeatmapChart`、柱状 `BarChart` 等)。
- **首次解析延迟**:历史多时首拉几秒,前端给 loading 态;后台预热缓解。
- **`noUncheckedIndexedAccess` 摩擦**:见 §6,移植时一次性补齐。
- **独立包 `cc-journal` 的归宿**:合并后它作为独立 npm 包是冻结还是继续双发布,是产品决定,本文不决断;代码与 LICENSE 同为 MIT、同作者,搬运无障碍。
- **不做的事**:不动 WS 协议、不动看板三源、不合并 transcript 解析、不移植 CLI。
</content>
</invoke>
