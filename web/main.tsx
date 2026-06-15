import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import type { SessionView } from "../server/types";
import { WsClient } from "./ws";
import { Board } from "./Board";
import { NewSession } from "./NewSession";
import { TerminalDock } from "./TerminalDock";

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
  const [open, setOpen] = useState<string[]>([]); // 打开的终端面板会话 id
  const [active, setActive] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newCwd, setNewCwd] = useState(""); // 「新建会话」预填目录

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
    <>
      <Board
        sessions={sessions}
        connected={connected}
        openIds={open}
        onOpen={openTerminal}
        onMonitorClick={openNew}
        onNew={() => openNew("")}
      />
      {showNew && (
        <NewSession
          client={client}
          models={models}
          initialCwd={newCwd}
          onClose={() => setShowNew(false)}
        />
      )}
      <TerminalDock
        client={client}
        open={open}
        active={active}
        sessions={sessions}
        models={models}
        onActivate={setActive}
        onClose={closeTerminal}
      />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
