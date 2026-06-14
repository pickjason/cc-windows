# cc-window

> 本地网页版 Claude Code **多会话管理台**:在浏览器里新建会话(选目录、选模型)、直接操作每个会话的交互式终端,同时一屏实时监控全机所有 Claude Code 会话的工作状态。

不再为每个项目手动开一个终端窗口——所有会话集中到一个网页里看、开、切。

---

## 它解决什么

当前用 Claude Code 时,处理多个项目就要开多个终端窗口,既看不到全局状态,也难以快速切换。`cc-window` 把这件事收敛到一个本地网页:

- **看**:一屏列出全机所有会话(交互式 + 后台),彩色状态一眼区分「正在干活 / 等你授权 / 等你输入 / 空闲 / 完成」。
- **开**:在网页里新建会话——选工作目录、选模型,一键启动一个真正可交互的终端。
- **操作**:每个会话一个 `xterm.js` 终端面板,可直接打字、回答授权提示。
- **切**:点会话卡片即聚焦其终端;运行中可切换模型。

## 核心原理(一句话)

以 `claude agents --json` 每 1–2s 轮询为**全量会话真相源**,叠加 Hooks 写入的事件流(`~/.claude/monitor/events.jsonl`)拿到**秒级状态跳变**与**精确等待原因**(等授权 vs 等输入),会话本身通过 `node-pty` 启动并桥接到浏览器 `xterm.js`。

> 关键事实:Claude Code **没有**对外的 socket / 端口 / HTTP 查询接口。正路就是「轮询 `agents --json` + tail hooks 日志 + 自己管 PTY」。详见 [docs/02-claude-code-observability.md](docs/02-claude-code-observability.md)。

## 技术栈

| 层 | 选型 |
|---|---|
| 后端 | Node + TypeScript、Express、`ws`、`node-pty` |
| 前端 | Vite + React + TypeScript、`xterm.js`(+ fit addon) |
| 数据源 | `claude agents --json`(轮询) + Hooks → `events.jsonl`(tail) |
| 运行 | 仅监听 `127.0.0.1`,默认端口 `4317` |

环境基线:Node `25.2.1` / npm `11.6.2` / Claude Code `2.1.177`(本机已验证)。

## 文档索引

| 文档 | 内容 |
|---|---|
| [01-overview](docs/01-overview.md) | 背景、目标、范围、非目标、术语表、设计原则 |
| [02-claude-code-observability](docs/02-claude-code-observability.md) | **基石**:Claude Code 可观测面的全部已核实事实(含置信度与来源) |
| [03-architecture](docs/03-architecture.md) | 组件、数据流、技术栈、会话生命周期、目录结构、安全 |
| [04-status-model](docs/04-status-model.md) | 三源状态规范化、统一状态机、新鲜度门槛、边界情况 |
| [05-protocol](docs/05-protocol.md) | REST 端点 + WebSocket 消息契约 |
| [06-hooks-setup](docs/06-hooks-setup.md) | `log.sh` + `settings.json` hooks 片段、隐私、安装脚本 |
| [07-milestones](docs/07-milestones.md) | 6 个里程碑路线图与验收标准 |

## 状态

✅ **MVP 完成(M1–M5)**:监控全量会话 + 网页新建会话(选目录/模型)+ 交互式终端 + 运行中切模型,全部跑通并实机验证。剩余 M6 为可选打磨,见 [07-milestones](docs/07-milestones.md)。

## 快速开始

```bash
# 1. 安装依赖(postinstall 会自动修复 node-pty 的 spawn-helper 执行位)
npm install

# 2. 安装监控 hooks(写入 ~/.claude/settings.json,自动备份;可 --dry-run 预览、--uninstall 回滚)
bash scripts/install-hooks.sh        # 预览改动: bash scripts/install-hooks.sh --dry-run

# 3a. 开发模式(前端 HMR):vite 5173 + 后端 4317
npm run dev                          # 浏览器打开 http://127.0.0.1:5173

# 3b. 生产模式:构建后由后端单端口托管
npm run build && npm start           # 浏览器打开 http://127.0.0.1:4317
```

说明:
- **建议装 tmux**(`brew install tmux`):cc-window 会用 `tmux -L ccwindow` 后端启动会话 → 既能网页操作,又能本地 `tmux -L ccwindow attach -t ccw_<id>` 接管同一会话,且**服务重启会话不丢**(自动重新接管)。终端面板工具条会显示该 attach 命令(点击复制)。未装 tmux 则自动降级为直连(关服务即结束会话)。
- 卡片标 **本台** 的是 cc-window 启动的会话,点击即在底部 dock 打开其终端;**外部会话**(你在别处手开的)仅监控、不可在网页操作(其输入绑定在各自终端的 TTY,无法跨进程注入)。
- 在**未信任的新目录**首次启动会话时,claude 会先在终端里弹「是否信任此文件夹」,按 Enter 确认后会话才会出现在看板(已注册进 `claude agents --json`)。
- 服务仅监听 `127.0.0.1`;监控 logger 默认**不记录 prompt 原文**。
