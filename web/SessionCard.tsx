import type { CSSProperties } from "react";
import type { SessionView } from "../server/types";
import { STATUS, fmtAge, fmtTokens } from "./ui-data";

// 单张会话卡片。点击行为按 managedByUs 分支(见 docs/09 §5)。
// 视觉严格按设计交接 SessionCard.jsx:密度 compact、状态点荧光 glow 常开。
export function SessionCard({
  s,
  nowMs,
  isOpen,
  onClick,
}: {
  s: SessionView;
  nowMs: number;
  isOpen: boolean;
  onClick: (s: SessionView) => void;
}) {
  const st = STATUS[s.status];
  const managed = s.managedByUs;

  const dot: CSSProperties = {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: st.color,
    flex: "0 0 auto",
    boxShadow: `0 0 7px ${st.color}, 0 0 2px ${st.color}`,
    animation: st.pulse ? "ccPulse 1.15s ease-in-out infinite" : "none",
  };

  return (
    <div
      className="cc-card"
      title={
        managed
          ? "点击打开终端 · " + s.cwd
          : "外部会话:仅监控。点击可在同目录新建一个可操作会话 · " + s.cwd
      }
      onClick={() => onClick(s)}
      style={{
        borderLeft: `2px solid ${st.color}`,
        padding: "9px 11px",
        cursor: "pointer",
        outline: isOpen ? "1px solid var(--accent)" : "1px solid transparent",
        outlineOffset: -1,
        boxShadow: isOpen ? "0 0 0 1px var(--accent), 0 0 14px -4px var(--accent)" : "none",
      }}
    >
      {/* top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
        <span style={dot} />
        <span style={{ color: st.color, fontWeight: 600, fontSize: 11.5, letterSpacing: ".02em" }}>
          {st.label}
        </span>
        <span className="cc-badge" style={{ color: s.kind === "interactive" ? "var(--fg-2)" : "var(--fg-3)" }}>
          {s.kind === "interactive" ? "ix" : "bg"}
        </span>
        {s.bypassPermissions && (
          <span
            className="cc-badge cc-badge-warn"
            title="以 --dangerously-skip-permissions 运行(免确认改文件/跑命令)"
          >
            ⚠ 跳过授权
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          className="cc-badge"
          style={{
            color: managed ? "#34d399" : "var(--fg-3)",
            borderColor: managed ? "rgba(52,211,153,.35)" : "var(--line)",
          }}
        >
          {managed ? "本台" : "仅监控"}
        </span>
      </div>

      {/* title = projectName */}
      <div
        title={s.cwd}
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--fg-0)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          marginBottom: 3,
        }}
      >
        {s.projectName}
      </div>
      {s.name && s.name !== s.projectName && (
        <div
          style={{
            fontSize: 11,
            color: "var(--fg-2)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginBottom: 4,
          }}
        >
          {s.name}
        </div>
      )}

      {/* last human prompt — 终端风 ❯ 提示符,区分同目录多会话 */}
      {s.lastPrompt && (
        <div
          title={s.lastPrompt}
          style={{
            fontSize: 11,
            color: "var(--fg-2)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginBottom: 2,
          }}
        >
          <span style={{ color: "var(--accent)" }}>❯</span> {s.lastPrompt}
        </div>
      )}

      {/* bottom row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 5,
          fontSize: 10.5,
          color: "var(--fg-3)",
        }}
      >
        {s.lastTool && (
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>
            ⚙ {s.lastTool}
          </span>
        )}
        {s.ctxTokens != null && <span style={{ whiteSpace: "nowrap" }}>ctx ~{fmtTokens(s.ctxTokens)}</span>}
        <span style={{ flex: 1 }} />
        <span title="最近活动" style={{ color: "var(--fg-2)" }}>{fmtAge(s.lastActivityTs, nowMs)}</span>
        <span style={{ color: "var(--fg-4)", letterSpacing: ".02em" }}>{s.sessionId.slice(0, 8)}</span>
      </div>
    </div>
  );
}
