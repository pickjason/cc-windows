# 01 · 概览(目标 / 范围 / 术语)

## 背景与痛点

用户在终端使用 Claude Code 处理多个项目时,需要为每个项目单独开一个终端窗口。带来三个问题:

1. **无全局视图**——不知道哪个会话正在干活、哪个在等自己授权、哪个已经空闲。
2. **切换成本高**——在多个终端窗口间来回找。
3. **新建繁琐**——每开一个会话都要切目录、敲命令。

`cc-window` 把「开会话 / 看状态 / 操作会话」收敛到一个本地网页。

## 目标(Goals)

- **G1 监控全量会话**:在一个页面实时显示全机所有 Claude Code 会话(交互式 + 后台)及其状态。
- **G2 网页内新建会话**:选择工作目录 + 模型,一键启动一个**可交互**的会话。
- **G3 网页内操作会话**:每个会话一个终端面板,可双向输入/输出(回答授权提示、敲命令等)。
- **G4 运行中切换模型**:对已运行的会话切换模型。
- **G5 状态精确**:能区分「正在干活 / 等授权 / 等输入 / 空闲 / 完成 / 关闭」,且不被崩溃会话误导。
- **G6 历史用量统计与日报**:解析 `~/.claude/projects/**/*.jsonl` 历史记录,在「统计」视图呈现活跃热力图 / token 趋势 / 时段分布 / 项目·模型排行 / 当日明细,并按天生成工作日报(可选 `claude` CLI 浓缩)。承接独立工具 cc-journal,详见 [11 文档](11-merge-cc-journal.md)。

## 范围(In Scope)

- 本地单机、单用户。
- 通过 `node-pty` 启动并桥接交互式 `claude` 会话。
- 通过 `claude agents --json` 轮询 + Hooks 事件流构建状态。
- 一个本地网页 UI(状态看板 + 终端面板 + 新建表单 + **历史用量统计视图**)。
- 解析本机已存在的 transcript(`~/.claude/projects/**/*.jsonl`)做**历史用量统计**;解析缓存落 `~/.claude-journal/`(承接独立工具 cc-journal,见 [11 文档](11-merge-cc-journal.md))。

## 非目标(Non-Goals)

- ❌ **不做整机文件浏览器**:目录选择用「路径输入框 + 最近用过的目录」,不暴露任意文件系统浏览(降低安全面与复杂度)。
- ❌ **不做云端 / 多用户 / 远程访问**:仅监听 `127.0.0.1`。如需远程,用 Claude Code 自带的 Remote Control,不在本项目范围。
- ❌ **不重做 Agent View 的全部能力**:本项目聚焦「网页化 + 新建/操作/监控」,不复刻 supervisor 守护进程、不读其未公开内部文件。
- ❌ **不做 headless 批量编排**:启动的是交互式会话,不是 `claude -p` 批跑(那条路见 [02 文档](02-claude-code-observability.md) 的 stream-json 面,留作未来扩展)。
- ❌ **不自动批准权限**:等授权的会话只做高亮提示,由用户自己在终端面板里决定。

## 术语表

| 术语 | 含义 |
|---|---|
| **会话 (session)** | 一次 Claude Code 对话,有唯一 `sessionId`(UUID),持久化为一个 `.jsonl` transcript 文件。 |
| **交互式 / 后台 (interactive / background)** | `claude agents --json` 的 `kind` 字段。交互式 = 普通终端会话;后台 = `--bg` 启动、由 supervisor 托管的会话。 |
| **transcript** | 会话记录文件,路径 `~/.claude/projects/<目录编码>/<sessionId>.jsonl`,每行一个 JSON。 |
| **hook** | Claude Code 在特定事件(SessionStart / PreToolUse / Stop / Notification ...)触发的命令,STDIN 收到事件 JSON。本项目用它把事件写进 `events.jsonl`。 |
| **PTY** | 伪终端。`node-pty` 用它启动真正的交互式 `claude` 进程,使浏览器 `xterm.js` 能像真终端一样操作。 |
| **roster(名册)** | `claude agents --json` 返回的全量会话列表,本项目的状态真相源。 |
| **worktree** | `claude --worktree` 创建的隔离 git 工作树(`<repo>/.claude/worktrees/<name>`)。本项目默认不强制使用,见 [03 文档](03-architecture.md)。 |
| **统计 / journal** | 历史用量分析视图:从 transcript 解析 token 用量、活跃热力图、日报等。与实时看板互补——看板看「现在的状态」,统计看「历史的用量」。源自合并进来的 cc-journal,见 [11 文档](11-merge-cc-journal.md)。 |

## 设计原则

1. **以 `agents --json` 为真相源,Hooks 为精度补充**。名册决定「有哪些会话、死了没」,Hooks 决定「秒级跳变、为什么在等」。两者冲突时名册优先于陈旧事件。
2. **绝不捏造状态**。Claude Code 没有「busy」标志位可直接读;凡是推断出来的状态都必须带**新鲜度门槛**,防止崩溃会话永远显示「正在干活」。
3. **本地、最小暴露面**。只听 `127.0.0.1`;logger 默认不记录 prompt 原文。
4. **与现有 hooks 共存**。用户已有 `~/.claude/analytics/*` hooks;本项目新增的 hook 以追加方式合并,安装脚本幂等且先备份。
5. **不依赖未公开内部**。只用文档化的 `claude agents --json` 契约,不读 `~/.claude/daemon/roster.json`、`~/.claude/jobs/*` 等会随版本变动的内部文件。
