import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import type { SessionView } from "../server/types";
import { WsClient } from "./ws";
import { Board } from "./Board";
import { NewSession } from "./NewSession";
import { TerminalDock } from "./TerminalDock";
// 统计视图按需加载:echarts(~700KB)只在打开「统计」时才拉,看板首屏不受拖累。
const JournalView = lazy(() =>
  import("./journal/JournalView").then((m) => ({ default: m.JournalView })),
);

interface ModelOption {
  value: string;
  label: string;
}

function App() {
  const clientRef = useRef<WsClient | null>(null);
  if (!clientRef.current) clientRef.current = new WsClient();
  const client = clientRef.current;

  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [connected, setConnected] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [open, setOpen] = useState<string[]>([]); // 打开的终端面板会话 id
  const [active, setActive] = useState<string | null>(null);
  const [modes, setModes] = useState<Record<string, "interactive" | "readonly">>({});
  const [showNew, setShowNew] = useState(false);
  const [newCwd, setNewCwd] = useState(""); // 「新建会话」预填目录
  const [view, setView] = useState<"board" | "journal">("board");

  function openNew(cwd = ""): void {
    setNewCwd(cwd);
    setShowNew(true);
  }
  function openTerminal(id: string): void {
    setOpen((o) => (o.includes(id) ? o : [...o, id]));
    setActive(id);
  }
  function closeTerminal(id: string): void {
    setOpen((o) => {
      const next = o.filter((x) => x !== id);
      setActive((a) => (a === id ? (next[next.length - 1] ?? null) : a));
      return next;
    });
  }
  function onCardClick(s: SessionView): void {
    if (s.managedByUs) openTerminal(s.sessionId); // 本台 → 打开/激活终端面板
    else openNew(s.cwd); // 外部 → 预填目录新建一个可操作会话
  }

  // 年龄实时刷新:本地每 1s 重算(无需后端推送)
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const off = client.onMessage((m) => {
      if (m.t === "roster") {
        setSessions(m.sessions);
      } else if (m.t === "status_update") {
        setSessions((prev) => {
          const i = prev.findIndex((s) => s.sessionId === m.session.sessionId);
          if (i === -1) return [...prev, m.session];
          const n = prev.slice();
          n[i] = m.session;
          return n;
        });
      } else if (m.t === "term_mode") {
        setModes((p) => ({ ...p, [m.sessionId]: m.mode }));
      } else if (m.t === "launched") {
        openTerminal(m.sessionId);
        setShowNew(false);
      } else if (m.t === "term_exit") {
        closeTerminal(m.sessionId); // 会话结束 → 自动关掉其面板
      }
    });
    const offS = client.onStatus(setConnected);
    fetch("/api/models")
      .then((r) => r.json())
      .then(setModels)
      .catch(() => {});
    return () => {
      off();
      offS();
    };
  }, []);

  return (
    <div className="cc-app">
      {/* 看板 + 终端坞:切到统计时隐藏(保留挂载,终端不断开) */}
      <div className="cc-view" style={{ display: view === "journal" ? "none" : "flex" }}>
        <Board
          sessions={sessions}
          nowMs={nowMs}
          connected={connected}
          openIds={open}
          onNew={() => openNew("")}
          onCardClick={onCardClick}
          onShowJournal={() => setView("journal")}
        />
        <TerminalDock
          client={client}
          sessions={sessions}
          openIds={open}
          activeId={active}
          modes={modes}
          models={models}
          onActivate={setActive}
          onClosePanel={closeTerminal}
        />
      </div>
      {view === "journal" && (
        <Suspense fallback={<div className="jr"><div className="jr-body"><div className="jr-loading">加载统计模块…</div></div></div>}>
          <JournalView onBack={() => setView("board")} />
        </Suspense>
      )}
      {showNew && (
        <NewSession client={client} models={models} initialCwd={newCwd} onClose={() => setShowNew(false)} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
