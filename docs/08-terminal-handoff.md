# 08 · 终端交接(网页 ⇄ 本地终端,可交互/只读自动切换)

## 背景与问题

tmux 后端下,一个会话(`ccw_<sessionId>`)是个 detached tmux 会话,谁 attach 谁就是一个**客户端**:
- cc-window 的 node-pty `tmux attach-session` 是一个客户端(网页 xterm 通过它双向桥接);
- 用户本地 `tmux -L ccwindow attach -t …` 又是一个客户端。

当两个客户端**同时** attach 且尺寸不同,tmux 默认 `window-size latest`(本机实测 3.6b)会把窗口尺寸缩放成**最后操作的那个客户端**;另一个客户端收到按新尺寸重排的输出却不知情、不会重新 fit,于是画面错位/花屏——这就是「网页 + 终端并用不同步」。

## 目标

**任一时刻只有一个可交互客户端**,从根上消除尺寸互抢:
- 网页默认可交互(现状);
- 一旦本地终端 attach 了该会话,网页自动转**只读镜像**;
- 本地终端关闭后,网页自动**恢复可交互**;
- 提供「在本地终端打开」按钮:点一下由服务端拉起本地 Terminal.app 并 attach(不再让用户手动复制命令)。

## 三态状态机(每会话)

```
                  外部客户端出现 (list-clients 数 > cc-window 自己的)
                  ──或── 点「在本地终端打开」按钮(立即生效)
        ┌────────────────────────────────────────────────────────┐
        │                                                          ▼
 ┌──────────────┐                                          ┌──────────────┐
 │  可交互       │                                          │   只读        │
 │ INTERACTIVE  │                                          │  READONLY     │
 │ node-pty     │                                          │ 已断开 attach │
 │ attach 着,  │                                          │ 轮询 capture- │
 │ 网页双向驱动 │                                          │ pane 镜像画面 │
 └──────────────┘                                          └──────────────┘
        ▲                                                          │
        └────────────────────────────────────────────────────────┘
                  外部客户端归零(已确认出现过后)→ 重新 attach、恢复双向
```

- **INTERACTIVE(默认)**:`PtyManager` 持有该会话的 attach PTY(仅在有网页面板订阅时存在),网页 xterm 双向桥接。`term_input` / `term_resize` 正常生效。
- **READONLY**:`PtyManager` **主动断开**自己的 attach(`pty.kill()`,tmux 会话存活),改为周期性 `capture-pane` 把当前画面快照推给网页。此时 tmux 仅剩本地终端一个客户端 → 无尺寸协商 → 稳定。网页禁用键入与 resize,顶部显示「🔒 本地终端使用中 · 只读(关闭终端后自动恢复)」。

## 判定:有没有「别人」在 attach

不去逐一识别"哪个客户端是我的"(tmux 难稳定区分),而是**算自己应该有几个**再比对:

```
ours  = (该会话当前持有 attach PTY) ? 1 : 0     // READONLY 态恒为 0(我们已断开)
n     = tmux -L ccwindow list-clients -t <会话> 的行数
外部存在 ⟺ n > ours
```

`PtyManager` 每 ~1s 轮询一次 `list-clients`:

| 当前态 | 条件 | 动作 |
|---|---|---|
| INTERACTIVE | `n > ours`(冒出外部客户端) | 断开自己 attach → 转 READONLY,广播 `term_mode=readonly` |
| READONLY | `n == 0`(且此前已确认出现过外部) | 重新 attach → 转 INTERACTIVE,广播 `term_mode=interactive` |

> 用「算出来的 ours」比对,使**点按钮**和**用户手动 `tmux attach`** 两条路殊途同归——都靠这一个轮询收敛,无需特例。

## 一键打开本地终端

服务端动作(macOS,本机已确认 `osascript` + Terminal.app 可用、无 iTerm):

```
osascript \
  -e 'tell application "Terminal" to do script "tmux -L ccwindow attach -t ccw_<sessionId>"' \
  -e 'tell application "Terminal" to activate'
```

点按钮的时序:
1. 服务端**立即**断开该会话自己的 attach + 置 READONLY(避免与即将 attach 的终端短暂双客户端)+ 记 `pendingSince`;
2. 跑 osascript 拉起 Terminal.app 并 attach;
3. 轮询随后看到 `n≥1` → 清 `pendingSince`,稳定停在 READONLY;
4. **兜底**:若 `pendingSince` 起 ~15s 内始终 `n==0`(终端没起来/秒关),自动重连恢复 INTERACTIVE,防止卡在只读。

> 仅 macOS。非 darwin 平台:按钮降级为「复制 attach 命令」(现有 `attach-cmd` 行为)。

## 只读镜像(capture-pane)

READONLY 态且有网页订阅时,`PtyManager` 每 ~500ms:

```
tmux -L ccwindow capture-pane -p -e -t <会话>      # -p 输出到 stdout,-e 保留颜色转义
```

把快照通过 `term_snapshot` 推给网页;网页渲染 = `\x1b[2J\x1b[H`(清屏回原点)+ 快照内容。只读、有 ~0.5s 级延迟、不可交互——「看本地在干啥」足够。

## 协议增量(对照 [05 文档](05-protocol.md))

客户端 → 服务端:

| `t` | 载荷 | 动作 |
|---|---|---|
| `open_terminal` | `{ sessionId }` | 服务端断开自己 attach + osascript 拉起本地 Terminal 并 attach;随后轮询切只读 |

服务端 → 客户端:

| `t` | 载荷 | 时机 |
|---|---|---|
| `term_mode` | `{ sessionId, mode: "interactive" \| "readonly" }` | 该会话态变化时;网页据此切换是否禁输入/显示横幅 |
| `term_snapshot` | `{ sessionId, data }` | READONLY 态周期推送的整屏快照(网页清屏后写入) |

`term_input` / `term_resize` 在 READONLY 态被服务端忽略(此时也无 attach PTY 可写)。

## 服务端实现要点(`server/pty.ts` / `server/index.ts`)

- `Managed` 增 `mode: "interactive" | "readonly"`、`pendingSince?: number`。
- `PtyManager` 起一个 ~1s 的客户端监视轮询(对所有 tmux 后端会话跑 `list-clients`),按上表迁移;迁移时 `emit("mode", sessionId, mode)`。
- READONLY 态另起 ~500ms 的 `capture-pane` 推送(`emit("snapshot", sessionId, data)`);仅当该会话有网页订阅者时才推,省 CPU。
- `openLocalTerminal(sessionId)`:断开 attach + 置 READONLY + `pendingSince` + osascript。
- `index.ts`:接 `open_terminal` 调用上面;把 `mode`/`snapshot` 事件转成 `term_mode`/`term_snapshot` 下发;READONLY 态 `term_input`/`term_resize` 直接丢弃。
- 复用既有的「detach 只断客户端、tmux 会话保活」「ensureAttached 按需重连」语义(见 [03 文档](03-architecture.md))。

## 前端实现要点(`web/TerminalPane.tsx` / `web/TerminalDock.tsx`)

- `TerminalPane` 收 `term_mode` 维护 `readonly` 标志:
  - READONLY:`onData` 不再 `term_input`、`ResizeObserver` 不再 `term_resize`;顶部覆盖一条只读横幅;`term.options.disableStdin = true`。
  - 收 `term_snapshot` → `term.write("\x1b[2J\x1b[H" + data)`。
  - 回 INTERACTIVE:恢复输入、重新 fit + 发一次 `term_resize`、清横幅。
- `TerminalDock` 工具区(`attach-cmd` 旁)加「在本地终端打开」按钮 → `client.send({ t: "open_terminal", sessionId })`。
- 横幅 + 按钮样式入 `web/styles.css`。

## 边界情况

| 情况 | 处理 |
|---|---|
| 点按钮但终端没起来/秒关 | `pendingSince` ~15s 兜底自动回 INTERACTIVE |
| 用户不点按钮、直接手动 `tmux attach` | 轮询发现 `n>ours` 同样自动转 READONLY |
| 多个本地终端同时 attach | `n≥1` 即只读;全部关闭(`n==0`)才恢复 |
| READONLY 时关掉网页面板 | 停 capture-pane 推送;tmux 会话与本地终端不受影响;mode 状态保留 |
| 非 macOS | 「打开终端」降级为复制 attach 命令,不做自动 osascript |
| 切模型 `/model`(`switch_model`)| 仅 INTERACTIVE 有意义(需写入 PTY);READONLY 态置灰或忽略 |

## 涉及文件

`server/pty.ts`、`server/index.ts`、`web/ws.ts`(协议类型)、`web/TerminalPane.tsx`、`web/TerminalDock.tsx`、`web/styles.css`,并回填 [05 协议文档](05-protocol.md)。
