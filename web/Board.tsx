import type { ReactNode } from "react";
import type { SessionView } from "../server/types";
import { SessionCard } from "./SessionCard";
import { NEEDS_ME, sortSessions } from "./ui-data";

// 看板:顶栏(品牌 / 新建 / 统计 / 待处理 / 连接指示)+ 网格(compact tight)。
// 排版固定为 grid + compact(设计默认,不做 Tweaks 面板)。见 docs/09 §4。
export function Board({
  sessions,
  nowMs,
  connected,
  openIds,
  onNew,
  onCardClick,
}: {
  sessions: SessionView[];
  nowMs: number;
  connected: boolean;
  openIds: string[];
  onNew: () => void;
  onCardClick: (s: SessionView) => void;
}) {
  const sorted = sortSessions(sessions);
  const needsMe = sessions.filter((s) => NEEDS_ME.includes(s.status)).length;

  let body: ReactNode;
  if (!connected) {
    body = <div className="cc-empty">正在连接服务端…</div>;
  } else if (sorted.length === 0) {
    body = <div className="cc-empty">暂无运行中的 Claude Code 会话。点「＋ 新建会话」开一个。</div>;
  } else {
    body = (
      <div className="cc-grid cc-grid-tight">
        {sorted.map((s) => (
          <SessionCard
            key={s.sessionId}
            s={s}
            nowMs={nowMs}
            isOpen={openIds.includes(s.sessionId)}
            onClick={onCardClick}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="cc-board">
      <header className="cc-header">
        <div className="cc-brand">
          <span className="cc-brand-name">cc-window</span>
          <span className="cc-brand-sub">Claude Code 会话台</span>
        </div>
        <button className="cc-btn cc-btn-primary" onClick={onNew}>
          ＋ 新建会话
        </button>
        <span className="cc-stat">{sessions.length} 会话</span>
        {needsMe > 0 && <span className="cc-stat cc-stat-needs">{needsMe} 待处理</span>}
        <span style={{ flex: 1 }} />
        <span className={"cc-conn " + (connected ? "on" : "off")}>
          {connected ? "● 已连接" : "○ 断开,重连中…"}
        </span>
      </header>
      <div className="cc-board-body">{body}</div>
    </div>
  );
}
