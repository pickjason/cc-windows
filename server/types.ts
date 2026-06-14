// 共享类型 —— 见 docs/04-status-model.md

/** `claude agents --json` 单条(源 A)。 */
export type RosterStatus = "idle" | "busy" | "waiting";
export interface RosterEntry {
  sessionId: string;
  pid: number;
  cwd: string;
  kind: "interactive" | "background";
  startedAt: number; // epoch ms
  status: RosterStatus;
  // 仅后台会话:
  id?: string;
  name?: string;
  waitingFor?: string;
  state?: string;
}

/** events.jsonl 一行(由 log.sh 写,源 B)。 */
export interface EventRecord {
  ts: string; // ISO-8601 UTC
  session_id: string | null;
  event: string | null; // hook_event_name
  cwd: string | null;
  tool: string | null;
  notification_type: string | null;
  source: string | null;
  end_reason: string | null;
  agent_type: string | null;
}

/** 按 session_id 累积的事件态(源 B)。 */
export interface EventState {
  lastEvent: string;
  notificationType?: string;
  lastTool?: string;
  lastEventTs: number; // ms
}

/** 归一后的统一会话状态。 */
export type SessionStatus =
  | "WORKING"
  | "WAITING_PERMISSION"
  | "WAITING_INPUT"
  | "IDLE"
  | "DONE"
  | "CLOSED"
  | "ERROR";

/** 合并产物,广播给前端。 */
export interface SessionView {
  sessionId: string;
  name: string;
  cwd: string;
  projectName: string;
  kind: "interactive" | "background";
  status: SessionStatus;
  lastTool?: string;
  lastActivityTs: number;
  managedByUs: boolean;
  /** 本台启动且 tmux 后端时,本地可用此命令 attach 同一会话。 */
  tmuxTarget?: string;
}
