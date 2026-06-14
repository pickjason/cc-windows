import { useEffect, useState } from "react";
import type { SessionView } from "../server/types";
import { SessionCard } from "./SessionCard";

export function Board({
  sessions,
  connected,
  openIds,
  onOpen,
  onMonitorClick,
  onNew,
}: {
  sessions: SessionView[];
  connected: boolean;
  openIds: string[];
  onOpen: (sessionId: string) => void;
  onMonitorClick: (cwd: string) => void;
  onNew: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const counts = sessions.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});
  const needsMe = (counts.WAITING_PERMISSION ?? 0) + (counts.WAITING_INPUT ?? 0);

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          cc-window
          <span className="sub">Claude Code 会话台</span>
        </div>
        <div className="stats">
          <button className="btn primary" onClick={onNew}>
            ＋ 新建会话
          </button>
          <span className="stat">{sessions.length} 会话</span>
          {needsMe > 0 && <span className="stat need">{needsMe} 待处理</span>}
          <span className={`conn ${connected ? "on" : "off"}`}>
            {connected ? "● 已连接" : "○ 断开,重连中…"}
          </span>
        </div>
      </header>

      {sessions.length === 0 ? (
        <div className="empty">
          {connected ? "暂无运行中的 Claude Code 会话。点「＋ 新建会话」开一个。" : "正在连接服务端…"}
        </div>
      ) : (
        <div className="grid">
          {sessions.map((s) => (
            <SessionCard
              key={s.sessionId}
              s={s}
              now={now}
              isOpen={openIds.includes(s.sessionId)}
              onOpen={() => onOpen(s.sessionId)}
              onMonitorClick={() => onMonitorClick(s.cwd)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
