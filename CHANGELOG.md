# 改动日志 / Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/),记录格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.2] - 2026-06-15

### 修复
- **`npx cc-window` / 全局安装无法启动**:`bin/cc-window.mjs` 原先硬编码包内 `node_modules/.bin/tsx`,但 npm/npx 会把依赖提升(hoist)到顶层 `node_modules`,包内路径不存在 → `spawn ENOENT`。改用 Node 模块解析(`createRequire`)定位 tsx,再用 `node` 跑其 cli,兼容 hoist/nested 布局且跨平台。本地开发因工作区恰有该路径而未暴露此问题。
- **网页终端重开后光标错位 / 画面叠画**:移除失败的 `term_history` 注入方案,不再把 tmux `capture-pane` 文本快照硬写进 live xterm。网页本地 scrollback 只保留打开面板后真实收到的 `term_output`;需要查看打开前历史时使用「打开终端」进入本地 tmux。
- WebSocket `hello.version` 改为读取 `package.json` 当前版本,避免后端继续上报旧的 `0.1.0`。

### 变更
- 终端字体渲染微调:字号 13 → 14、字重 500/700、行高 1.22,`.xterm` 开启 `text-rendering:optimizeLegibility`。
- 降低 xterm ANSI 红/绿饱和度,并显式配置 `brightRed` / `brightGreen`,让 Claude diff 的红绿整行背景不再刺眼。

### 测试
- 新增终端主题护栏测试,防止 diff 红绿背景以后又被调回高亮度。

## [0.1.1] - 2026-06-15

### 修复
- **终端 resize 失控回环(光标闪动 / 页面漂移遮住)**:终端 flex 链 `.cc-panes / .cc-pane / .cc-term` 缺 `min-width:0`,`.cc-pane` 被 xterm 内容撑爆 → FitAddon 算出超大列数 → `term_resize` 无限自增(实测约 127 次/秒、列数无限增长),回滚缓冲被灌爆、视口不停自动滚到底。补 `min-width:0` 根治,并在 `TerminalPane.tsx` 加 `term_resize` 去重(仅 cols/rows 实变才发)+ `requestAnimationFrame` 去抖 + 列行夹取。详见 `docs/10`。

### 新增
- 打开 interactive 面板时注入 tmux 历史(新增 `term_history` 协议消息),用 `capture-pane -e -S -5000` 抓最近历史 + 当前屏,网页一打开就能用滚轮回看最近输出。

### 变更
- **鼠标滚轮改为网页本地 scrollback**,不再编码成鼠标序列打到 tmux(避免误触发 tmux copy-mode 出现横线 / `[N/M]`);interactive 终端保留 5000 行本地回滚;新输出到达时若用户在底部则自动跟随,在看历史则不强行拉回。
- 网页重开 interactive 面板前,自动退出 tmux 遗留的 copy-mode(仅 `pane_in_mode=1` 时执行,只读态不打断本地终端的 copy-mode)。

## [0.1.0] - 2026-06-15

首个公开发布 —— 本地网页版 Claude Code 多会话管理台(仅监听 `127.0.0.1`)。

### 新增
- **监控**:轮询 `claude agents --json` + tail `~/.claude/monitor/events.jsonl` 事件流 + transcript 上下文占用估算,归一为彩色状态(干活中 / 等授权 / 等输入 / 空闲)。
- **新建**:网页选目录 + 选模型,用 node-pty 启动交互式 `claude`。
- **操作**:每会话一个 xterm.js 终端面板,可双向输入、切模型、网页内结束会话。
- **tmux 后端**(默认,装了 tmux 时):专用 socket `tmux -L ccwindow`,服务重启会话不丢;网页 ⇄ 本地终端自动交接(外部 attach 时网页转只读镜像,关闭后收回可交互)。
- **开源就绪**:MIT 许可、`npx cc-window` 打包、中英双语 README、环境变量配置(`CC_PORT` / `PORT` / `CC_HOST` / `CC_TMUX_SOCKET`)、监控 hooks 安装器(`install-hooks`,支持 `--dry-run` / `--uninstall`)。

[0.1.2]: https://github.com/pickjason/cc-windows/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/pickjason/cc-windows/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pickjason/cc-windows/releases/tag/v0.1.0
