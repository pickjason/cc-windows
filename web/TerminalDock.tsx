import { TerminalPane } from "./TerminalPane";
import type { WsClient } from "./ws";
import type { SessionView } from "../server/types";

interface ModelOption {
  value: string;
  label: string;
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
  if (open.length === 0) return null;
  const view = (id: string) => sessions.find((s) => s.sessionId === id);
  const nameOf = (id: string) => view(id)?.name ?? id.slice(0, 8);

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
        {active && (
          <div className="dock-tools">
            {view(active)?.tmuxTarget && (
              <code
                className="attach-cmd"
                title="在本地终端运行可接管同一会话(点击复制)"
                onClick={() => navigator.clipboard?.writeText(view(active)!.tmuxTarget!)}
              >
                {view(active)!.tmuxTarget}
              </code>
            )}
            <span className="dock-cwd" title={view(active)?.cwd}>
              {view(active)?.cwd}
            </span>
            <select
              className="model-switch"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  client.send({ t: "switch_model", sessionId: active, model: e.target.value });
                }
              }}
            >
              <option value="">切换模型…</option>
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
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
