import { useEffect, useRef, useState } from "react";
import { TerminalPane } from "./TerminalPane";
import { STATUS, displayName, fmtTokens } from "./ui-data";
import type { WsClient } from "./ws";
import type { SessionView } from "../server/types";

interface ModelOption {
  value: string;
  label: string;
}

// 底部 Dock:拖动调高 + 最大化;标签条(状态点 + 名称 + 关面板×);工具区
//(ctx 条 / 打开终端 / attach 复制 / 切模型 / 结束二次确认)。
// 关面板(×)≠ 结束会话(kill)。视觉严格按设计交接 Dock.jsx。
export function TerminalDock({
  client,
  sessions,
  openIds,
  activeId,
  modes,
  models,
  onActivate,
  onClosePanel,
}: {
  client: WsClient;
  sessions: SessionView[];
  openIds: string[];
  activeId: string | null;
  modes: Record<string, "interactive" | "readonly">;
  models: ModelOption[];
  onActivate: (id: string) => void;
  onClosePanel: (id: string) => void;
}) {
  const [h, setH] = useState(340);
  const [max, setMax] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [copied, setCopied] = useState(false);
  const dragging = useRef(false);

  const av = sessions.find((s) => s.sessionId === activeId);
  const mode = (activeId && modes[activeId]) || "interactive";
  const readonly = mode === "readonly";

  useEffect(() => setConfirmKill(false), [activeId]); // 切 tab 重置结束确认

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const vh = window.innerHeight;
      const nh = Math.min(vh - 70, Math.max(160, vh - e.clientY));
      setH(nh);
      setMax(false);
    };
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  if (openIds.length === 0) return null;
  const effH = max ? "calc(100vh - 56px)" : h;

  const killBtn = () => {
    if (!activeId) return;
    if (confirmKill) {
      client.send({ t: "kill", sessionId: activeId });
      setConfirmKill(false);
    } else {
      setConfirmKill(true);
    }
  };
  const copyAttach = () => {
    if (!av?.tmuxTarget) return;
    navigator.clipboard?.writeText(av.tmuxTarget);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="cc-dock" style={{ height: effH }}>
      <div
        className="cc-resize"
        title="拖动调整高度"
        onMouseDown={() => {
          dragging.current = true;
          document.body.style.cursor = "ns-resize";
          document.body.style.userSelect = "none";
        }}
      />

      {/* tab bar */}
      <div className="cc-tabs">
        {openIds.map((id) => {
          const s = sessions.find((x) => x.sessionId === id);
          if (!s) return null;
          const st = STATUS[s.status];
          return (
            <div
              key={id}
              className={"cc-tab " + (id === activeId ? "active" : "")}
              onClick={() => onActivate(id)}
            >
              <span className="cc-tab-dot" style={{ background: st.color }} />
              <span className="cc-tab-name">{displayName(s)}</span>
              <button
                className="cc-tab-x"
                title="关闭面板(会话继续在后台运行)"
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePanel(id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <span style={{ flex: 1 }} />
        <button className="cc-icon-btn" title={max ? "还原" : "最大化"} onClick={() => setMax((m) => !m)}>
          {max ? "❐" : "▢"}
        </button>
      </div>

      {/* tool zone for active session */}
      {av && (
        <div className="cc-tools">
          {av.ctxTokens != null && (
            <div className="cc-ctx" title="近似上下文占用">
              <div className="cc-ctx-bar">
                <div
                  className="cc-ctx-fill"
                  style={{
                    width: (av.ctxPct || 0) + "%",
                    background: (av.ctxPct ?? 0) > 75 ? "#f59e0b" : "var(--accent)",
                  }}
                />
              </div>
              <span>
                ctx ~{fmtTokens(av.ctxTokens)}
                {av.ctxPct != null ? ` · ${av.ctxPct}%` : ""}
              </span>
            </div>
          )}
          {av.tmuxTarget && (
            <button
              className={"cc-btn cc-btn-sm " + (readonly ? "locked" : "")}
              disabled={readonly}
              title={readonly ? "本地终端驱动中,网页只读" : "在本机 Terminal 打开并接管该会话"}
              onClick={() => !readonly && activeId && client.send({ t: "open_terminal", sessionId: activeId })}
            >
              {readonly ? "🔒 本地终端中" : "打开终端 ↗"}
            </button>
          )}
          {av.tmuxTarget && (
            <button className="cc-attach" onClick={copyAttach} title="点击复制 attach 命令">
              <code>{av.tmuxTarget}</code>
              <span className="cc-copy">{copied ? "已复制 ✓" : "⧉"}</span>
            </button>
          )}
          <span className="cc-cwd" title={av.cwd}>
            {av.cwd}
          </span>
          <span style={{ flex: 1 }} />
          <select
            className="cc-input cc-input-sm"
            value=""
            disabled={readonly}
            title={readonly ? "只读态禁用" : "切换模型"}
            onChange={(e) => {
              if (e.target.value && activeId)
                client.send({ t: "switch_model", sessionId: activeId, model: e.target.value });
              e.currentTarget.value = "";
            }}
          >
            <option value="">切换模型…</option>
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            className={"cc-btn cc-btn-sm " + (confirmKill ? "danger-armed" : "danger")}
            onClick={killBtn}
            title="结束该会话(tmux 后端会真正 kill-session)"
          >
            {confirmKill ? "确认结束?" : "结束会话"}
          </button>
        </div>
      )}

      {/* panes */}
      <div className="cc-panes">
        {openIds.map((id) => (
          <TerminalPane
            key={id}
            client={client}
            sessionId={id}
            active={id === activeId}
            mode={modes[id] || "interactive"}
          />
        ))}
      </div>
    </div>
  );
}
