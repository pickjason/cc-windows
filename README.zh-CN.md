# cc-window

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white&style=flat-square)
![React](https://img.shields.io/badge/React-18-149ECA?logo=react&logoColor=white&style=flat-square)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white&style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white&style=flat-square)
![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)
![local-only](https://img.shields.io/badge/local--only-127.0.0.1%3A4317-2563EB?style=flat-square)

> 本地网页版 **Claude Code** 多会话管理台:一屏监控全机所有会话、网页里新建会话、操作每个会话的交互式终端。仅监听 `127.0.0.1`。

English: **[README.md](README.md)**.

![cc-window 看板](docs/assets/screenshot.png)

---

## 它解决什么

多项目同时用 Claude Code,就要开一堆终端窗口——看不到全局、切换也麻烦。cc-window 把这件事收敛到一个本地网页:

- **看** — 一屏列出全机所有会话(交互式 + 后台),彩色状态:等授权 / 等输入 / 干活中 / 空闲。
- **开** — 网页里新建会话:选目录 + 选模型,一键拉起一个真正可交互的终端。
- **操作** — 每个会话一个 `xterm.js` 面板:打字、回答授权提示、切模型、结束会话。
- **交接** — 点「打开终端」在本机真实终端接管该会话;网页面板自动转**只读**(本地终端在驱动),关掉本地终端后自动转回可交互。任一时刻只有一个可交互客户端,不会尺寸互抢。

## 核心原理(一句话)

Claude Code **没有**对外的 socket / 端口 / HTTP 查询接口。cc-window 以每 ~1.5s 轮询 `claude agents --json` 为权威会话名册,叠加 hooks 写入的事件流(`~/.claude/monitor/events.jsonl`)拿到秒级状态跳变与精确等待原因,会话本身用 `node-pty` 启动并桥接到浏览器(默认走专用 `tmux` 后端)。完整设计见 [`docs/`](docs/)。

## 环境要求

- **[Claude Code CLI](https://github.com/anthropics/claude-code)** 已安装并登录(`claude` 在 `PATH` 上)。
- **Node.js ≥ 20**。
- **tmux**(推荐):支持本地终端交接、服务重启会话不丢;没有则降级为直连 `node-pty` 后端(关服务即结束会话)。
- 一键「打开终端」用 `osascript` + Terminal.app,**仅 macOS**;其它平台降级为复制 `tmux attach` 命令。其余功能跨平台。

> ⚠️ `node-pty` 是原生模块,npm 自带常见平台预编译包;否则会在安装时编译(需 C/C++ 工具链)。

## 快速开始

### npx(免克隆)

```bash
npx cc-window                 # 启动看板 → http://127.0.0.1:4317
npx cc-window install-hooks   # (可选)安装监控 hooks;--dry-run 预览 / --uninstall 回滚
```

### 从源码

```bash
git clone https://github.com/pickjason/cc-windows.git
cd cc-windows
npm run setup                 # npm install + 构建
npm start                     # → http://127.0.0.1:4317

# 可选:用 hooks 拿更精细的秒级状态(写入 ~/.claude/settings.json,自动备份;
# 可 --dry-run 预览、--uninstall 回滚)
npm run install-hooks
```

开发模式(前端 HMR):`npm run dev`(Vite 5173 + 服务端 4317)。

## 配置(环境变量,均可选)

| 变量 | 默认 | 含义 |
|---|---|---|
| `CC_PORT` / `PORT` | `4317` | HTTP/WS 端口 |
| `CC_HOST` | `127.0.0.1` | 监听地址 |
| `CC_TMUX_SOCKET` | `ccwindow` | 专用 tmux socket 名(`tmux -L <名>`) |

## 安全

- 默认仅监听 `127.0.0.1`,不对外暴露。**无内置鉴权 token**:能访问该端口的进程都能控制你的会话。
- **切勿**把 `CC_HOST` 设成非回环地址,除非你清楚这会把会话控制暴露到网络。
- 监控 logger 默认**不记录 prompt 原文**,见 [`docs/06-hooks-setup.md`](docs/06-hooks-setup.md)。
- 以**跳过授权**(`--dangerously-skip-permissions`)启动的会话不再弹权限确认,卡片用红色 `⚠ 跳过授权` 徽章标注。仅在可信目录使用。

## 说明

- 标 **本台** 的卡片是 cc-window 启动的,可在网页操作;**仅监控** 的(你在别处开的会话)只能看,点击会在同目录预填「新建会话」。
- 在**未信任目录**首次启动会话,claude 会在终端弹「是否信任此文件夹」,按 Enter 确认后会话才注册、上看板。
- **关面板(×)≠ 结束会话**:关标签只断网页面板,会话继续后台跑;「结束会话」才真正 kill。

## 文档

| 文档 | 内容 |
|---|---|
| [01-overview](docs/01-overview.md) | 背景、目标、范围、术语 |
| [02-claude-code-observability](docs/02-claude-code-observability.md) | Claude Code 可观测面的已核实事实(基石) |
| [03-architecture](docs/03-architecture.md) | 组件、数据流、会话生命周期 |
| [04-status-model](docs/04-status-model.md) | 三源状态归一 + 状态机 |
| [05-protocol](docs/05-protocol.md) | REST + WebSocket 消息契约 |
| [06-hooks-setup](docs/06-hooks-setup.md) | hooks logger、隐私、安装脚本 |
| [08-terminal-handoff](docs/08-terminal-handoff.md) | 网页 ⇄ 本地终端 可交互/只读切换 |
| [09-ui-interaction-spec](docs/09-ui-interaction-spec.md) | UI 交互/行为全规格 |

## 贡献

欢迎 issue / PR。提 PR 前:`npm run typecheck && npm run build`。

## 许可

[MIT](LICENSE)
