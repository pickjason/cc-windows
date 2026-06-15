# 10 · 缺陷修复 · 终端 resize 失控回环(光标闪动 / 页面漂移遮住)

> 排查日期 2026-06-15。本文记录根因、实测证据与修复方案。涉及终端尺寸/`fit` 的改动先读本文与 `docs/03`、`docs/08`。

## 症状

网页打开任一终端面板后:
- 输入框光标不停闪动;
- 终端内容「漂移」——输入框 `>` 被挤出可视区,只剩 claude TUI 尾栏(`[Opus 4.8] | …`、`bypass permissions on …`),画面像被覆盖。

## 复现与实测证据

在浏览器里(`127.0.0.1:4317`)打开一个本台会话的终端面板,抓 `term_resize` WS 帧与 DOM 尺寸:

| 指标 | 故障态 | 注入 `min-width:0` 后 |
|---|---|---|
| 3 秒内 `term_resize` 帧数 | **382**(约 127 次/秒) | **0** |
| fit 算出的 `cols` | 10525 → 10526 → … **无限自增**(rows 恒 15) | 稳定 **192**(≈ 1512 / 7.8) |
| `.cc-pane` / `.cc-term` clientWidth | **105725px** | **1512px** |
| `.xterm-viewport` scrollHeight | 持续暴涨(3506 → 14641 → 17242…) | 不再增长 |

字体已正常加载(JetBrains Mono 字符宽 7.8px,非字体测量问题)。

## 根因

`web/styles.css` 里终端的 flex 链 `.cc-panes / .cc-pane / .cc-term` 都只设了 `min-height:0`,**漏了 `min-width:0`**。

flex 子项的默认 `min-width` 是 `auto`,即**不会收缩到小于其内容的固有宽度**。于是形成一个失控的横向反馈回环:

```
xterm 渲染内容
  → .cc-pane(min-width:auto)被内容撑宽,突破视口约束
  → FitAddon 按被撑宽的容器(105725px)算出荒谬列数(~13000)
  → 发 term_resize 给后端 tmux
  → tmux 按新列数吐更宽的重绘内容
  → .cc-pane 更宽 → 列数更大 → 无限自增 ↺
```

后果叠加成可见症状:
- 每秒上百次 `fit` + 重绘 ⇒ 光标/画面**闪动**;
- `.xterm-viewport` 回滚缓冲被重绘灌爆、视口不停自动滚到底 ⇒ 内容**漂移**,输入框被推出视区;
- 每秒上百帧 `term_resize` 持续猛敲后端 tmux(性能损耗)。

关键确认:`.cc-panes` 被正确约束在 1512px,但它的 flex 子项 `.cc-pane` 被撑到 105725px——**断点就在 `.cc-pane` 缺 `min-width:0`**。`.cc-term` 的 `overflow:hidden` 只裁剪不约束布局,救不了。

## 修复方案

### 1. 根因修复 — `web/styles.css`

给终端 flex 链补 `min-width:0`,让容器收缩回视口宽度,FitAddon 从一开始就量到正确宽度:
- `.cc-panes`、`.cc-pane`、`.cc-term` 各加 `min-width:0`。

> 不加这一项,回环必然存在;加了之后新开/刷新的会话不再失控。

### 2. 防护加固 — `web/TerminalPane.tsx`

即使出现任何瞬时抖动也不再轰炸后端、并能快速收敛:
- `resize()` 只在 `cols/rows` 相比上次实际发送值发生变化时才 `client.send({ t:"term_resize" })`(幂等,稳定后零发送);
- ResizeObserver 回调用 `requestAnimationFrame` 去抖,合并连续触发;
- 加列/行的合理范围兜底夹取,防御任何异常测量。

## 验证

- `npm run typecheck` 通过;
- 浏览器实机:打开终端面板,3 秒内 `term_resize` 帧应为个位数并迅速归零,`.cc-pane` 宽度等于视口宽,光标稳定、输入框 `>` 常驻可视区;
- 已存在但被旧失控期写花的会话(后端 tmux pane 残留超大列数)需触发一次正常 resize 或重开面板自愈;刷新页面后新链路即干净。

---

## 2026-06-15 追加排查 · 滚轮条纹 / copy-mode 残留

resize 回环修复后,继续出现两个相关但不同的现象:

1. 网页终端里滚轮滑动后,画面出现大量横线,右上角出现 `[N/M]`。
2. 关闭网页终端面板(tab 上的 `×`)再重新打开,仍然回到同样的横线画面。

### 现象确认

浏览器截图中,右上角黄色 `[51/169]` 是 tmux copy-mode 的位置提示,不是网页 CSS 或 xterm 渲染条纹。tmux 侧同步确认:

```bash
tmux -L ccwindow display-message -p -t ccw_e03566ed-cb97-4556-9b80-9ab1baed046c '#{pane_in_mode} #{pane_width}x#{pane_height}'
# 1 160x30
```

`pane_in_mode=1` 说明该 pane 正在 copy-mode。关闭网页面板只会发送 `detach`,取消浏览器订阅;它不会退出 tmux 会话内部的 copy-mode。因此重新打开面板时,仍会看到 tmux 当前停留的 copy-mode 画面。

### 根因补充

这次不是 resize 失控,而是滚轮输入链路有两层:

```
鼠标滚轮
  → 浏览器 wheel 事件
  → xterm.js 本地滚动/鼠标协议
  → term.onData 产生鼠标转义序列
  → WS term_input
  → tmux 收到滚轮鼠标事件
  → tmux 进入 copy-mode,显示 [N/M] 和历史屏幕
```

单纯拦截 DOM `wheel` 不够,因为 xterm 仍可能把鼠标滚轮编码成终端输入序列。需要同时:
- 浏览器端把滚轮用于 xterm 本地 scrollback;
- 前端过滤 xterm 生成的鼠标滚轮输入序列;
- 网页重新打开 interactive 面板前,自动收敛退出 tmux 遗留 copy-mode。

### 追加修复

#### 3. 网页本地滚动,不再把滚轮送进 tmux

涉及文件:
- `web/terminalScroll.ts`
- `web/terminalInput.ts`
- `web/TerminalPane.tsx`

实现:
- interactive 终端保留 `INTERACTIVE_SCROLLBACK_LINES=5000`;
- wheel 事件在 `window` capture 阶段拦截,只在当前 active 终端区域内生效;
- wheel 转为 `term.scrollLines(...)`,滚网页端 xterm 本地历史;
- `stripMouseWheelInput()` 过滤 SGR mouse (`\x1b[<64;...M` 等)和 X10 mouse wheel 序列,避免任何漏网滚轮再通过 `term_input` 打到 tmux;
- 新输出到达时,若用户在底部则自动跟随到底;若用户已滚上去看历史,不强行拉回。

#### 4. 回滚失败方案 — 不向 live xterm 注入 tmux 历史

涉及文件:
- `server/pty.ts`
- `server/index.ts`
- `web/ws.ts`
- `web/TerminalPane.tsx`
- `docs/05-protocol.md`

曾尝试新增服务端消息:

```ts
{ t: "term_history"; sessionId: string; data: string }
```

打开 interactive 面板时,后端用:

```bash
tmux -L ccwindow capture-pane -p -e -S -5000 -t <tmuxName>
```

抓最近历史 + 当前屏,前端写入 xterm 本地 scrollback。实测该方案会破坏 live xterm 的终端状态:

- xterm scrollback 被灌入大量 capture-pane 输出,例如 `scrollHeight=21613`;
- Claude TUI 状态栏和分隔线多次重复;
- 后续真实 PTY 输出继续在这个“伪当前屏”上绘制,导致光标定位错误、内容叠画。

根因:tmux `capture-pane` 只是屏幕文本快照,不是完整终端状态机。它不包含真实光标位置、alternate screen 状态、滚动区域、应用内部重绘时序。把它当作 live PTY 字节流喂给 xterm,会让 xterm 的模拟器状态与 tmux/Claude 的真实状态分叉。

最终处理:

- 移除 `term_history` 协议;
- 不再调用 `capture-pane -S -5000` 初始化 interactive scrollback;
- 网页 scrollback 只保留网页打开后真实收到的 `term_output`;
- 需要查看网页打开前历史时,用「打开终端」在本地 Terminal 里使用 tmux copy-mode。

#### 5. 重开面板前自动退出遗留 copy-mode

涉及文件:
- `server/tmux-copy-mode.ts`
- `server/tmux-copy-mode.test.ts`
- `server/pty.ts`
- `server/index.ts`

WebSocket 收到 `attach` 且目标会话是 interactive 时,在 `ensureAttached()` 之前先执行:

```bash
tmux -L ccwindow display-message -p -t <tmuxName> '#{pane_in_mode}'
tmux -L ccwindow send-keys -t <tmuxName> -X cancel
```

仅当 `pane_in_mode=1` 时才 cancel。只读态不执行,避免打断用户在本地 Terminal 中主动使用 copy-mode。

### 最终验证记录

自动验证:

```bash
npx tsx server/tmux-copy-mode.test.ts
npx tsx web/terminalInput.test.ts
npx tsx web/terminalScroll.test.ts
npx tsx web/terminalResize.test.ts
npx tsx web/terminalTheme.test.ts
npm run typecheck
npm run build
```

结果均通过。

浏览器实测:
- 打开 `lz_ai` 面板前,tmux 侧曾是 `pane_in_mode=1`;
- 修复后点击卡片打开同一会话,网页中不再出现右上角 `[N/M]` copy-mode 标记;
- tmux 侧变为 `pane_in_mode=0`;
- 滚轮后 tmux 仍保持 `pane_in_mode=0`;
- 发现 `term_history` 注入会导致光标定位错误后已回滚,刷新/重开面板后由真实 PTY attach 输出重建 xterm 当前屏。

结论:
- resize 失控回环由 flex 链 `min-width:0` + resize 去重/RAF/夹取解决;
- 鼠标滚轮改为网页本地 scrollback(仅网页打开后的真实输出),不再触发 tmux copy-mode;
- 已经残留在 copy-mode 的 tmux pane,网页重开 interactive 面板时自动退出,避免“叉掉再打开还是横条”。
- 不要把 `capture-pane` 历史注入 live xterm;这会破坏光标/屏幕状态同步。
