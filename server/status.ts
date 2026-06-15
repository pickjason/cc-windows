import path from "node:path";
import { WORKING_LEAD_MS } from "./config.js";
import type { RosterPoller } from "./roster.js";
import type { EventTailer } from "./events.js";
import type { ManagedMeta } from "./pty.js";
import type {
  RosterEntry,
  EventState,
  SessionStatus,
  SessionView,
} from "./types.js";

/** 看板排序:需要我处理的排最前。 */
const RANK: Record<SessionStatus, number> = {
  WAITING_PERMISSION: 0,
  WAITING_INPUT: 1,
  WORKING: 2,
  DONE: 3,
  IDLE: 4,
  ERROR: 5,
  CLOSED: 6,
};

export interface StatusEngineOpts {
  /** 由本工具(PtyManager)管理、可在网页操作的会话元信息(含 tmux attach 命令)。 */
  managed?: () => ManagedMeta[];
  /** 上下文占用查询(来自 ContextTracker)。 */
  context?: (sessionId: string) => { ctxTokens: number; ctxPct: number } | undefined;
}

/**
 * 把源 A(roster)+ 源 B(events)归一成统一的 SessionView[]。
 * 状态机与新鲜度门槛见 docs/04-status-model.md。
 */
export class StatusEngine {
  constructor(
    private roster: RosterPoller,
    private tailer: EventTailer,
    private opts: StatusEngineOpts = {},
  ) {}

  /** 当前快照(以 roster 为权威会话集合;不在 roster 的视为 CLOSED → 不展示)。 */
  computeViews(now: number): SessionView[] {
    const managedById = new Map((this.opts.managed?.() ?? []).map((m) => [m.sessionId, m]));
    const states = this.tailer.getStates();
    const views: SessionView[] = [];
    for (const r of this.roster.getMap().values()) {
      const e = states.get(r.sessionId);
      const status = deriveStatus(r, e, now);
      const projectName = path.basename(r.cwd) || r.cwd;
      const mm = managedById.get(r.sessionId);
      const ctx = this.opts.context?.(r.sessionId);
      views.push({
        sessionId: r.sessionId,
        name: r.name ?? projectName ?? r.sessionId.slice(0, 8),
        cwd: r.cwd,
        projectName,
        kind: r.kind,
        status,
        lastTool: e?.lastTool,
        lastActivityTs: Math.max(e?.lastEventTs ?? 0, r.startedAt ?? 0),
        managedByUs: !!mm,
        tmuxTarget: mm?.tmuxTarget,
        ctxTokens: ctx?.ctxTokens,
        ctxPct: ctx?.ctxPct,
      });
    }
    views.sort(
      (a, b) => RANK[a.status] - RANK[b.status] || b.lastActivityTs - a.lastActivityTs,
    );
    return views;
  }
}

/**
 * 单会话状态推断(见 docs/04-status-model.md 合并规则)。
 *
 * 核心原则(已实机验证):`claude agents --json` 的 status 很可靠 —— busy=正在处理、idle=停在
 * prompt 等输入,且回完一轮 ~1s 内就翻回 idle。故 **WORKING 只认 roster busy**;roster idle
 * 时绝不显示工作中(跑过一轮的→等输入,没跑过的→空闲),仅留极短抢先窗口给"刚提交、roster 还没翻"。
 */
export function deriveStatus(
  r: RosterEntry,
  e: EventState | undefined,
  now: number,
): SessionStatus {
  const ev = e?.lastEvent;
  const nt = e?.notificationType;
  const ts = Math.max(e?.lastEventTs ?? 0, r.startedAt ?? 0);
  const waitingForPerm =
    r.status === "waiting" && (r.waitingFor ?? "").toLowerCase().includes("permission");
  const eventWorking =
    ev === "UserPromptSubmit" || ev === "PreToolUse" || ev === "PostToolUse";

  // 1. 等授权(最高优先):Notification.permission_prompt,或后台 waitingFor 含 permission
  if ((ev === "Notification" && nt === "permission_prompt") || waitingForPerm)
    return "WAITING_PERMISSION";
  // 2. 显式空闲通知
  if (ev === "Notification" && nt === "idle_prompt") return "WAITING_INPUT";

  // 3. roster 是"是否正在处理"的权威
  if (r.status === "busy") return "WORKING";
  if (r.status === "waiting") return "WAITING_INPUT"; // 非 permission 的 waiting

  // 4. roster idle —— 没在处理:
  //    a) 抢先窗口:刚提交 prompt,roster 还没翻 busy(≤ROSTER_POLL_MS 延迟)
  if (eventWorking && now - ts < WORKING_LEAD_MS) return "WORKING";
  //    b) 跑过一轮(Stop/SubagentStop,或已过抢先窗口的工作事件)→ 等用户输入
  if (ev === "Stop" || ev === "SubagentStop" || eventWorking) return "WAITING_INPUT";
  //    c) 只 SessionStart / 无信号 → 全新会话,空闲
  return "IDLE";
}
