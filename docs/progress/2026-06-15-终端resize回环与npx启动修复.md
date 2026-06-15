---
日期: 2026-06-15
状态: 0.1.1 已发布;0.1.2 本地发布候选已整合(npx 启动 + 终端稳定性收尾),待推送/发布
关联: docs/10-bugfix-terminal-resize-loop / CHANGELOG.md / tag v0.1.1(已推) / tag v0.1.2(本地,待移动到最终提交)
---

# 终端 resize 失控回环修复 + npx 启动修复 + 0.1.1/0.1.2 发布候选

## 背景

用户反馈:网页终端「输入框光标会闪动、页面会漂移遮住」。在浏览器(`127.0.0.1:4317`)实机排查 + node-pty/xterm/tmux 三层定位,牵出两个独立缺陷:一个运行时(resize 回环),一个打包(npx 起不来)。

## 缺陷一 · 终端 resize 失控回环(光标闪动 / 页面漂移)

### 发现的根因

终端 flex 链 `.cc-panes / .cc-pane / .cc-term` 只设了 `min-height:0`,**漏了 `min-width:0`**。flex 子项默认 `min-width:auto`(不收缩到小于内容固有宽度),于是:

```
xterm 渲染内容 → .cc-pane 被撑宽(突破视口) → FitAddon 按超宽容器算出荒谬列数
  → 发 term_resize 给 tmux → tmux 吐更宽内容 → .cc-pane 更宽 → 列数更大 ↺(无限自增)
```

每秒上百次重绘 + 回滚缓冲被灌爆 + 视口不停自动滚到底 = 光标闪动 + 页面漂移遮住。

证据(浏览器实测,注入 `min-width:0` 前后对比):

| 指标 | 故障态 | 修复后 |
|---|---|---|
| 3 秒内 `term_resize` 帧数 | 382(~127 次/秒) | 0 |
| FitAddon 算出的 cols | 10525→10526→… 无限自增 | 稳定 192 |
| `.cc-pane` clientWidth | 105725px | 1512px |
| `.xterm-viewport` scrollHeight | 持续暴涨(3506→14641→…) | 不再增长 |

### 修法

| 文件 | 变更 |
|---|---|
| `web/styles.css` | `.cc-panes/.cc-pane/.cc-term` 补 `min-width:0`(+ `max-width:100%`、`overflow:hidden` 加固)— 治本 |
| `web/TerminalPane.tsx` | `term_resize` 去重(仅 cols/rows 实变才发)+ `requestAnimationFrame` 去抖 + 列行夹取 — 防瞬态、护后端 |

### 顺带处理(并入 0.1.1)

滚轮误触发 tmux copy-mode(出现横线 + 右上 `[N/M]`):滚轮改为网页本地 scrollback(`stripMouseWheelInput()` 过滤鼠标序列);重开 interactive 面板前自动 `send-keys -X cancel` 退出遗留 copy-mode(仅 `pane_in_mode=1` 时)。详见 docs/10。

曾尝试在打开面板时通过 `term_history` 注入 tmux `capture-pane -S -5000` 历史,后来实测会破坏 live xterm 的光标/屏幕状态(重复状态栏、叠画、光标错位),已在 0.1.2 回滚。网页 scrollback 只保留网页打开后真实收到的 PTY 输出;打开前历史交给本地 tmux copy-mode。

## 缺陷二 · `npx cc-window` / 全局安装无法启动

### 发现的根因

`bin/cc-window.mjs` 硬编码包内 `node_modules/.bin/tsx`。但 npm/npx 安装会把依赖**提升(hoist)到顶层** `node_modules`,包内那个路径不存在 → `spawn ENOENT`。本地开发因工作区恰有 `node_modules/.bin/tsx` 而侥幸可跑,所以 **0.1.0 / 0.1.1 都带这个坑,只在真实用户的 npx/全局安装路径暴露**。

实测日志:
```
[cc-window] 无法执行 …/_npx/…/node_modules/cc-window/node_modules/.bin/tsx: spawn … ENOENT
```
确认 tsx 实际被提升到 `…/_npx/…/node_modules/.bin/tsx -> ../tsx/dist/cli.mjs`。

### 修法

| 文件 | 变更 |
|---|---|
| `bin/cc-window.mjs` | 改用 `createRequire(import.meta.url).resolve("tsx/package.json")` 按 Node 模块解析定位 tsx(向上查找,兼容 hoist/nested),读其 `bin` 字段,用 `node` 跑 `dist/cli.mjs`(跨平台,不依赖 `.bin/.cmd` 布局) |

### 验证

在 npx 缓存的真实 hoist 布局里模拟修复后的 bin,`CC_PORT=4318 CC_TMUX_SOCKET=ccwindow-verify` 隔离启动:tsx 解析到 `…/node_modules/tsx/dist/cli.mjs`、服务正常起、HTTP 200、`/api/models` 正常返回模型列表。源码 bin 本地启动同样 HTTP 200。

## 自动验证

```bash
npx tsx server/tmux-copy-mode.test.ts   # passed
npx tsx web/terminalInput.test.ts       # passed
npx tsx web/terminalScroll.test.ts      # passed
npx tsx web/terminalResize.test.ts      # passed
npx tsx web/terminalTheme.test.ts       # passed
npm run typecheck                       # passed
npm run build                           # dist/web 产出 OK
```

## 发布状态

| 版本 | 内容 | git | npm |
|---|---|---|---|
| 0.1.1 | resize 回环 + 滚轮/copy-mode(曾含 term_history 方案) | `67d27e9` + tag `v0.1.1`(已推 origin) | 已发布(2026-06-15 16:00) |
| 0.1.2 | bin/tsx 解析修复(npx 启动) + 回滚 term_history + 字体/配色稳定性收尾 | 待提交并移动本地 tag `v0.1.2` | **未发布**(待推/待 npm publish) |

用户确认「目前比较稳定」后,字体渲染微调(`TerminalPane.tsx` 字号 13→14/字重/行高、`styles.css` 字体平滑)、diff 红绿降饱和、`term_history` 回滚与 `CHANGELOG.md` 统一并入 0.1.2。

## 教训 / 事故

- **打包发布前必须在 hoist 布局实测启动**(`npx <pkg>@<ver>` 或临时全局安装),不能只在工作区跑——本地 `node_modules/.bin` 会掩盖依赖解析的打包 bug。
- 清理验证进程时用了 `pkill -f "server/index.ts"`,**误杀了用户正在运行的 4317 实例**(它同样是 `tsx server/index.ts`)。tmux 的 `ccw_*` 会话因 detached 持久未丢,已用 `npm start` 按原端口/socket 重启恢复。教训:杀进程别用会匹配到用户实例的宽泛 pattern,优先按端口 `lsof -t -iTCP:<port>` 精准定位。

## 归档

- `docs/10-bugfix-terminal-resize-loop.md`(resize/滚轮/copy-mode 排查权威记录)
- `docs/progress/2026-06-15-终端resize回环与npx启动修复.md`(本文)
- `bin/cc-window.mjs` / `web/styles.css` / `web/TerminalPane.tsx`
- `server/pty.ts` / `server/index.ts` / `server/tmux-copy-mode.ts` / `web/terminal{Input,Scroll,Resize}.ts` 及各 `.test.ts` / `web/terminalTheme.test.ts`
- `CHANGELOG.md`
