import { useEffect, useState } from "react";
import { TerminalPane } from "./TerminalPane";
import type { WsClient } from "./ws";
import type { SessionView } from "../server/types";

interface ModelOption {
  value: string;
  label: string;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function TerminalDock({
  client,
  open,
  active,
  sessions,
  models,
  onActivate,
  onClose,
}: {
  client: WsClient;
  open: string[];
  active: string | null;
  sessions: SessionView[];
  models: ModelOption[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  // 内联确认(不用 window.confirm,避免阻塞 / 更可控)
  const [confirmKill, setConfirmKill] = useState<string | null>(null);
  useEffect(() => setConfirmKill(null), [active]); // 切 tab 时重置确认

  if (open.length === 0) return null;
  const view = (id: string) => sessions.find((s) => s.sessionId === id);
  const nameOf = (id: string) => view(id)?.name ?? id.slice(0, 8);
  const av = active ? view(active) : undefined;

  function killActive(): void {
    if (!active) return;
    if (confirmKill === active) {
      client.send({ t: "kill", sessionId: active });
      setConfirmKill(null);
      // term_exit 回来后 main 会关掉面板;这里不抢先关,避免误关
    } else {
      setConfirmKill(active);
    }
  }

  return (
    <div className="dock">
      <div className="dock-tabs">
        {open.map((id) => (
          <div
            key={id}
            className={`tab ${id === active ? "on" : ""}`}
            onClick={() => onActivate(id)}
          >
            <span className="tab-name">{nameOf(id)}</span>
            <button
              className="tab-x"
              title="关闭面板(会话继续在后台运行)"
              onClick={(e) => {
                e.stopPropagation();
                onClose(id);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <div className="dock-spacer" />
        {av && (
          <div className="dock-tools">
            {av.ctxTokens != null && (
              <span className="ctx" title={`上下文约 ${av.ctxTokens} tokens(分母为常见窗口,仅供参考)`}>
                <span className="ctx-bar">
                  <span className="ctx-fill" style={{ width: `${av.ctxPct ?? 0}%` }} />
                </span>
                ctx ~{fmtTokens(av.ctxTokens)}
                {av.ctxPct != null ? ` · ${av.ctxPct}%` : ""}
              </span>
            )}
            {av.tmuxTarget && (
              <code
                className="attach-cmd"
                title="在本地终端运行可接管同一会话(点击复制)"
                onClick={() => navigator.clipboard?.writeText(av.tmuxTarget!)}
              >
                {av.tmuxTarget}
              </code>
            )}
            <span className="dock-cwd" title={av.cwd}>
              {av.cwd}
            </span>
            <select
              className="model-switch"
              value=""
              onChange={(e) => {
                if (e.target.value && active)
                  client.send({ t: "switch_model", sessionId: active, model: e.target.value });
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
              className={`btn kill ${confirmKill === active ? "confirm" : ""}`}
              onClick={killActive}
              title="结束该会话(tmux 后端会真正 kill-session)"
            >
              {confirmKill === active ? "确认结束?" : "结束会话"}
            </button>
          </div>
        )}
      </div>
      <div className="dock-body">
        {open.map((id) => (
          <TerminalPane key={id} client={client} sessionId={id} active={id === active} />
        ))}
      </div>
    </div>
  );
}
