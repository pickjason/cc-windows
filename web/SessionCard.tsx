import type { SessionView, SessionStatus } from "../server/types";

interface StatusMeta {
  label: string;
  color: string;
}
export const STATUS_META: Record<SessionStatus, StatusMeta> = {
  WAITING_PERMISSION: { label: "等授权", color: "#ef4444" },
  WAITING_INPUT: { label: "等输入", color: "#f59e0b" },
  WORKING: { label: "干活中", color: "#3b82f6" },
  DONE: { label: "刚完成", color: "#22c55e" },
  IDLE: { label: "空闲", color: "#6b7280" },
  ERROR: { label: "错误", color: "#dc2626" },
  CLOSED: { label: "关闭", color: "#374151" },
};

function humanizeAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function SessionCard({
  s,
  now,
  isOpen,
  onOpen,
  onMonitorClick,
}: {
  s: SessionView;
  now: number;
  isOpen?: boolean;
  /** 本台会话:打开终端 */
  onOpen?: () => void;
  /** 外部会话:打开「新建会话」并预填该目录 */
  onMonitorClick?: () => void;
}) {
  const meta = STATUS_META[s.status];
  const age = humanizeAge(now - s.lastActivityTs);
  const pulsing = s.status === "WORKING";
  const handleClick = s.managedByUs ? onOpen : onMonitorClick;
  return (
    <div
      className={`card${handleClick ? " clickable" : ""}${isOpen ? " open" : ""}`}
      style={{ borderLeftColor: meta.color }}
      onClick={handleClick}
      title={
        s.managedByUs
          ? "点击打开终端"
          : "外部会话:仅监控(无法操作)。点击可在同目录新建一个可操作会话"
      }
    >
      <div className="card-top">
        <span className={`dot${pulsing ? " pulse" : ""}`} style={{ background: meta.color }} />
        <span className="status" style={{ color: meta.color }}>
          {meta.label}
        </span>
        <span className={`kind kind-${s.kind}`}>
          {s.kind === "background" ? "bg" : "ix"}
        </span>
        {s.managedByUs ? (
          <span className="managed">本台</span>
        ) : (
          <span className="monitor-only">仅监控</span>
        )}
      </div>
      <div className="project" title={s.cwd}>
        {s.projectName}
      </div>
      <div className="card-bottom">
        {s.lastTool && <span className="tool">⚙ {s.lastTool}</span>}
        {s.ctxTokens != null && (
          <span className="ctx-mini" title={`上下文约 ${s.ctxTokens} tokens`}>
            ctx ~{fmtTokens(s.ctxTokens)}
          </span>
        )}
        <span className="age">{age}</span>
        <span className="sid">{s.sessionId.slice(0, 8)}</span>
      </div>
    </div>
  );
}
