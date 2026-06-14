import { useEffect, useState } from "react";
import type { WsClient } from "./ws";

interface ModelOption {
  value: string;
  label: string;
}
interface RecentDir {
  path: string;
  lastSessionAt: number;
}

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
    const dir = cwd.trim();
    if (!dir) return;
    client.send({ t: "launch", cwd: dir, model, name: name.trim() || undefined });
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>新建会话</h3>
        {initialCwd && (
          <p className="modal-hint">
            外部会话只能监控、无法直接操作。已为你预填该目录,在此新建一个<b>可操作</b>的会话。
          </p>
        )}

        <label>
          工作目录
          <input
            list="recent-dirs"
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/Users/wang/IdeaProjects/…"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && launch()}
          />
          <datalist id="recent-dirs">
            {recents.map((d) => (
              <option key={d.path} value={d.path} />
            ))}
          </datalist>
        </label>
        {recents.length > 0 && (
          <div className="chips">
            {recents.slice(0, 6).map((d) => (
              <button key={d.path} className="chip" onClick={() => setCwd(d.path)} title={d.path}>
                {d.path.split("/").pop() || d.path}
              </button>
            ))}
          </div>
        )}

        <label>
          模型
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          名称(可选)
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="默认用目录名"
            onKeyDown={(e) => e.key === "Enter" && launch()}
          />
        </label>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={launch} disabled={!cwd.trim()}>
            启动
          </button>
        </div>
      </div>
    </div>
  );
}
