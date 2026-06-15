import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import type { WsClient } from "./ws";

interface ModelOption {
  value: string;
  label: string;
}
interface RecentDir {
  path: string;
  lastSessionAt: number;
}

// 新建会话模态。入参契约:cwd / model / name / skipPermissions(见 docs/09 §6)。
// 视觉严格按设计交接 NewSession.jsx。
export function NewSession({
  client,
  models,
  initialCwd = "",
  onClose,
}: {
  client: WsClient;
  models: ModelOption[];
  initialCwd?: string;
  onClose: () => void;
}) {
  const [recents, setRecents] = useState<RecentDir[]>([]);
  const [cwd, setCwd] = useState(initialCwd);
  const [model, setModel] = useState(models[0]?.value ?? "opus");
  const [name, setName] = useState("");
  const [skip, setSkip] = useState(false);
  const external = !!initialCwd;
  const canLaunch = cwd.trim().length > 0;

  useEffect(() => {
    fetch("/api/recent-dirs")
      .then((r) => r.json())
      .then(setRecents)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (models[0]) setModel((m) => m || models[0]!.value);
  }, [models]);

  function launch(): void {
    if (!canLaunch) return;
    client.send({ t: "launch", cwd: cwd.trim(), model, name: name.trim() || undefined, skipPermissions: skip });
    onClose();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") launch();
  };

  return (
    <div className="cc-modal-bg" onClick={onClose}>
      <div className="cc-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cc-modal-head">
          <span>＋ 新建会话</span>
          <button className="cc-x" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        {external && (
          <div className="cc-note">
            外部会话只能监控、无法在网页操作。已为你预填该目录,在此新建一个<b> 本台 </b>可操作会话。
          </div>
        )}

        <label className="cc-field">
          <span className="cc-label">
            工作目录 <em>必填</em>
          </span>
          <input
            className="cc-input"
            list="cc-dirs"
            value={cwd}
            autoFocus
            placeholder="/path/to/project"
            onChange={(e) => setCwd(e.target.value)}
            onKeyDown={onKey}
          />
          <datalist id="cc-dirs">
            {recents.map((d) => (
              <option key={d.path} value={d.path} />
            ))}
          </datalist>
          {recents.length > 0 && (
            <div className="cc-chips">
              {recents.slice(0, 6).map((d) => (
                <button key={d.path} className="cc-chip" onClick={() => setCwd(d.path)} title={d.path}>
                  {d.path.split("/").filter(Boolean).pop() || d.path}
                </button>
              ))}
            </div>
          )}
        </label>

        <div className="cc-row2">
          <label className="cc-field">
            <span className="cc-label">模型</span>
            <select className="cc-input" value={model} onChange={(e) => setModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="cc-field">
            <span className="cc-label">
              名称 <em>可选</em>
            </span>
            <input
              className="cc-input"
              value={name}
              placeholder="空则用目录名"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={onKey}
            />
          </label>
        </div>

        <label className={"cc-skip " + (skip ? "armed" : "")}>
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          <span>
            <b>跳过授权</b> <code>--dangerously-skip-permissions</code>
            <i>免确认改文件 / 跑命令,高风险,仅在可信目录使用。</i>
          </span>
        </label>

        <div className="cc-modal-foot">
          <button className="cc-btn" onClick={onClose}>
            取消
          </button>
          <button className="cc-btn cc-btn-primary" disabled={!canLaunch} onClick={launch}>
            启动 ▸
          </button>
        </div>
      </div>
    </div>
  );
}
