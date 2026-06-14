#!/usr/bin/env bash
#
# cc-window · Hooks 安装器
#   - 写 ~/.claude/monitor/log.sh(从 STDIN 读 hook 事件,追加精简 JSON 到 events.jsonl)
#   - 幂等地往 ~/.claude/settings.json 追加 8 个监控 hook(与现有 hooks 共存)
#   - 写入前自动备份 settings.json
#
# 用法:
#   bash scripts/install-hooks.sh            # 安装(写入)
#   bash scripts/install-hooks.sh --dry-run  # 只打印将产生的 settings.json diff,不写
#   bash scripts/install-hooks.sh --uninstall# 移除本工具的 8 个 hook(保留其它)
#
set -euo pipefail

MON_DIR="${CC_WINDOW_MONITOR_DIR:-$HOME/.claude/monitor}"
LOG="$MON_DIR/log.sh"
SETTINGS="$HOME/.claude/settings.json"
# 存进 settings.json 的命令(字面 $HOME,由 Claude 在触发时展开,与现有 analytics hooks 风格一致)
CMD='$HOME/.claude/monitor/log.sh'

MODE="install"
case "${1:-}" in
  --dry-run)   MODE="dry-run" ;;
  --uninstall) MODE="uninstall" ;;
  "")          MODE="install" ;;
  *) echo "未知参数: $1" >&2; exit 2 ;;
esac

command -v jq >/dev/null || { echo "需要 jq,请先安装。" >&2; exit 1; }

# ---- 1. 写 log.sh(uninstall 模式不动它)----
write_logger() {
  mkdir -p "$MON_DIR"
  cat > "$LOG" <<'EOF'
#!/usr/bin/env bash
# cc-window 监控 logger:从 STDIN 读 hook 事件,追加一行精简 JSON 到 events.jsonl。
# 默认不记 prompt 原文。永远 exit 0,绝不阻塞 / 影响会话。
DIR="${CC_WINDOW_MONITOR_DIR:-$HOME/.claude/monitor}"
mkdir -p "$DIR"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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
EOF
  chmod +x "$LOG"
}

# ---- 2. 计算新的 settings.json 内容(输出到 stdout)----
# 事件 -> matcher:PreToolUse/PostToolUse 用 "*",其余用 ""(均匹配全部)。
INSTALL_JQ='
def ensure($evt; $matcher; $cmd):
  .hooks[$evt] = ((.hooks[$evt] // [])
    | if any(.[]?; (.hooks // [])[]?.command == $cmd) then .
      else . + [ { matcher: $matcher, hooks: [ { type: "command", async: true, command: $cmd } ] } ]
      end);
.hooks = (.hooks // {})
| ensure("SessionStart"; ""; $cmd)
| ensure("UserPromptSubmit"; ""; $cmd)
| ensure("PreToolUse"; "*"; $cmd)
| ensure("PostToolUse"; "*"; $cmd)
| ensure("Notification"; ""; $cmd)
| ensure("Stop"; ""; $cmd)
| ensure("SubagentStop"; ""; $cmd)
| ensure("SessionEnd"; ""; $cmd)
'

UNINSTALL_JQ='
if (.hooks | type) == "object" then
  .hooks |= (
    with_entries( .value |= ( map( .hooks |= map(select(.command != $cmd)) )
                              | map(select((.hooks | length) > 0)) ) )
    | with_entries(select((.value | length) > 0))
  )
else . end
'

read_settings() {  # 读 settings.json,不存在则视为 {}
  if [ -f "$SETTINGS" ]; then cat "$SETTINGS"; else echo '{}'; fi
}

compute_new() {  # $1 = install|uninstall
  if [ "$1" = "uninstall" ]; then
    read_settings | jq --arg cmd "$CMD" "$UNINSTALL_JQ"
  else
    read_settings | jq --arg cmd "$CMD" "$INSTALL_JQ"
  fi
}

show_diff() {  # 规范化两侧后做 diff,隔离真实改动
  local new="$1"
  echo "=== settings.json 改动(规范化 diff,左=现状 右=将写入)==="
  diff -u <(read_settings | jq -S .) <(printf '%s' "$new" | jq -S .) || true
}

# ---- 主流程 ----
case "$MODE" in
  dry-run)
    echo "[dry-run] 将写 logger: $LOG"
    NEW="$(compute_new install)"
    show_diff "$NEW"
    echo "=== (dry-run 未写入任何文件)==="
    ;;
  install)
    write_logger
    echo "已写 logger: $LOG"
    NEW="$(compute_new install)"
    if [ -f "$SETTINGS" ]; then
      BAK="$SETTINGS.bak.$(date +%Y%m%d-%H%M%S)"
      cp "$SETTINGS" "$BAK"
      echo "已备份: $BAK"
    fi
    TMP="$(mktemp)"
    printf '%s\n' "$NEW" > "$TMP"
    jq -e . "$TMP" >/dev/null          # 写回前校验是合法 JSON
    mv "$TMP" "$SETTINGS"
    echo "已更新: $SETTINGS"
    echo "提示:新开 / 重启会话后 hooks 生效。验证: tail -n 5 \"$MON_DIR/events.jsonl\""
    ;;
  uninstall)
    NEW="$(compute_new uninstall)"
    if [ -f "$SETTINGS" ]; then
      BAK="$SETTINGS.bak.$(date +%Y%m%d-%H%M%S)"
      cp "$SETTINGS" "$BAK"
      echo "已备份: $BAK"
    fi
    TMP="$(mktemp)"
    printf '%s\n' "$NEW" > "$TMP"
    jq -e . "$TMP" >/dev/null
    mv "$TMP" "$SETTINGS"
    echo "已移除 cc-window 的 hooks(其它 hooks 保留): $SETTINGS"
    echo "(logger $LOG 未删除;如需可手动 rm)"
    ;;
esac
