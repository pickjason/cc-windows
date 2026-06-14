# 06 · Hooks 安装(精确片段)

> 本步骤会**写入** `~/.claude/settings.json` 与新建 `~/.claude/monitor/log.sh`。安装脚本幂等、写入前自动备份 `settings.json`。**实际写入前会把下面的片段再展示一次给你确认。**

## 目的

让每个会话在关键事件触发时,把一行精简 JSON 追加到 `~/.claude/monitor/events.jsonl`。服务端 `tail -F` 它,获得**秒级状态跳变**和**精确等待原因**(`permission_prompt` vs `idle_prompt`),这是纯轮询 `agents --json` 给不到的。

不装 hooks 也能跑(纯轮询降级版),但会失去秒级跳变和"等授权 vs 等输入"的区分。

## 1. logger 脚本 `~/.claude/monitor/log.sh`

从 STDIN 读 hook 事件 JSON,追加一行精简记录。**默认不记录 prompt 原文(隐私)**;退出码恒为 0,绝不阻塞会话。

```bash
#!/usr/bin/env bash
# cc-window 监控 logger:从 STDIN 读 hook 事件,追加一行精简 JSON 到 events.jsonl。
# 默认不记 prompt 原文。永远 exit 0,绝不阻塞 / 影响会话。
DIR="${CC_WINDOW_MONITOR_DIR:-$HOME/.claude/monitor}"
mkdir -p "$DIR"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# jq 从 STDIN 读;缺失字段自动为 null。只取状态判定需要的字段。
jq -c --arg ts "$ts" '{
  ts: $ts,
  session_id,
  event: .hook_event_name,
  cwd,
  tool: .tool_name,
  notification_type,
  source,
  end_reason,
  agent_type
}' >> "$DIR/events.jsonl" 2>/dev/null || true
exit 0
```

`chmod +x ~/.claude/monitor/log.sh`。依赖 `jq`(用户现有 hooks 已用)。

输出样例(`events.jsonl` 每行):
```json
{"ts":"2026-06-14T08:01:22Z","session_id":"f1e2...","event":"PreToolUse","cwd":"/Users/wang/IdeaProjects/foo","tool":"Bash","notification_type":null,"source":null,"end_reason":null,"agent_type":null}
{"ts":"2026-06-14T08:01:40Z","session_id":"f1e2...","event":"Notification","cwd":"...","tool":null,"notification_type":"permission_prompt",...}
```

## 2. 写入 `~/.claude/settings.json` 的 hooks 片段

下面 8 个事件,每个**追加**一个调用 `log.sh` 的 matcher 组(`async:true` 不阻塞)。`PreToolUse`/`PostToolUse` 用 `"*"`,其余用 `""`(均为匹配全部)。

```jsonc
{
  "hooks": {
    "SessionStart":     [ { "matcher": "",  "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ],
    "UserPromptSubmit": [ { "matcher": "",  "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ],
    "PreToolUse":       [ { "matcher": "*", "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ],
    "PostToolUse":      [ { "matcher": "*", "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ],
    "Notification":     [ { "matcher": "",  "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ],
    "Stop":             [ { "matcher": "",  "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ],
    "SubagentStop":     [ { "matcher": "",  "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ],
    "SessionEnd":       [ { "matcher": "",  "hooks": [ { "type": "command", "async": true, "command": "$HOME/.claude/monitor/log.sh" } ] } ]
  }
}
```

## 3. 与现有 hooks 的共存(已核对)

当前 `~/.claude/settings.json` 的 `hooks` **只有** `PostToolUse` 一个键(3 个 matcher 组:`Edit|Write`、`Bash`、`Agent`,调用 `~/.claude/analytics/*` 脚本,用 `$CLAUDE_TOOL_INPUT` 环境变量旧写法)。合并策略:

- **新事件键**(`SessionStart`/`UserPromptSubmit`/`PreToolUse`/`Notification`/`Stop`/`SubagentStop`/`SessionEnd`):直接新增。
- **已存在的 `PostToolUse`**:在其数组**追加**一个 `{"matcher":"*", ...log.sh}` 组,不动现有三组。同一事件的多个 hook 都会触发,故 analytics 与 cc-window 监控并行、互不影响。
- 两套写法可共存:analytics 读 env 变量,cc-window 读 STDIN+jq,互不干扰。

## 4. 安装脚本 `scripts/install-hooks.sh`(行为约定)

幂等、可重入、写前备份:

1. 创建 `~/.claude/monitor/`,写 `log.sh` 并 `chmod +x`。
2. 备份 `~/.claude/settings.json` → `settings.json.bak.<时间戳>`。
3. 用 `jq` 读入 settings.json,对 8 个事件:若不存在则建数组;若该事件下尚无"命令 == `$HOME/.claude/monitor/log.sh`"的组,则追加;已存在则跳过(幂等)。
4. 写回(原子:先写临时文件再 `mv`)。
5. 打印 diff 摘要;提示用户「新开/重启会话后 hooks 生效」。
6. 提供 `--uninstall`:移除这 8 处 log.sh 组(按命令路径匹配),保留其它 hooks。

> ⚠️ 安装脚本由本工具生成,但**首次实际写入前,会在对话里把最终 diff 展示给你确认**(遵循工作手册规则 1)。

## 5. 验证

```bash
# 触发一次事件后查看
tail -n 5 ~/.claude/monitor/events.jsonl
# 应看到带正确 session_id 与 hook_event_name 的行;
# 在某会话里让 Claude 调一个需授权的工具,应出现 notification_type=permission_prompt;
# 会话空闲后应出现 notification_type=idle_prompt。
```

## 隐私与清理

- 默认**不记 prompt 原文**;只记事件类型/工具名/session_id/cwd/时间戳。
- `events.jsonl` 会持续增长;后续可加按大小滚动(MVP 不做,文件很小)。
- 卸载:`scripts/install-hooks.sh --uninstall`。
