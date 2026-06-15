import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { WsClient } from "./ws";

// 终端面板:真实 xterm.js 渲染 claude TUI(设计稿的假终端不适用)。
// 套用设计外壳 .cc-pane / .cc-ro-banner / .cc-term,主题用设计配色。
// interactive ⇄ readonly 由父级 mode 控制(见 docs/08、docs/09 §8–9)。
const XTERM_THEME = {
  background: "#07090c",
  foreground: "#c4cdd8",
  cursor: "#34d399",
  cursorAccent: "#07090c",
  selectionBackground: "#252e3b",
  black: "#0a0d12",
  brightBlack: "#48535f",
  red: "#ef4444",
  green: "#34d399",
  yellow: "#f59e0b",
  blue: "#3b82f6",
  magenta: "#a78bfa",
  cyan: "#22d3ee",
  white: "#c4cdd8",
  brightWhite: "#e6edf3",
};

export function TerminalPane({
  client,
  sessionId,
  active,
  mode,
}: {
  client: WsClient;
  sessionId: string;
  active: boolean;
  mode: "interactive" | "readonly";
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const modeRef = useRef(mode);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
      cursorBlink: true,
      theme: XTERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(elRef.current!);
    termRef.current = term;
    fitRef.current = fit;

    const resize = () => {
      if (modeRef.current === "readonly") return;
      const el = elRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      client.send({ t: "term_resize", sessionId, cols: term.cols, rows: term.rows });
    };

    client.send({ t: "attach", sessionId });
    if (active) resize();

    const onData = term.onData((d) => {
      if (modeRef.current === "readonly") return; // 只读忽略键入
      client.send({ t: "term_input", sessionId, data: d });
    });
    const offMsg = client.onMessage((m) => {
      if (m.t === "term_output" && m.sessionId === sessionId) {
        if (modeRef.current !== "readonly") term.write(m.data);
      } else if (m.t === "term_snapshot" && m.sessionId === sessionId) {
        term.write("\x1b[?25l\x1b[2J\x1b[H" + m.data.replace(/\n/g, "\r\n"));
      } else if (m.t === "term_exit" && m.sessionId === sessionId) {
        term.write(`\r\n\x1b[33m[会话已退出 code=${m.code}]\x1b[0m\r\n`);
      }
    });
    const ro = new ResizeObserver(() => resize());
    if (elRef.current) ro.observe(elRef.current);

    return () => {
      onData.dispose();
      offMsg();
      ro.disconnect();
      client.send({ t: "detach", sessionId });
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // mode 由父级控制:切到 readonly 禁输入;切回 interactive 重新 fit + resize + 聚焦
  useEffect(() => {
    modeRef.current = mode;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term) return;
    term.options.disableStdin = mode === "readonly";
    if (mode === "interactive") {
      term.write("\x1b[?25h");
      try {
        fit?.fit();
        client.send({ t: "term_resize", sessionId, cols: term.cols, rows: term.rows });
        if (activeRef.current) term.focus();
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 由隐藏变激活:重新 fit + 聚焦(只读态仅聚焦)
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = elRef.current;
    if (!term || !fit || !el || el.clientWidth === 0) return;
    if (mode === "readonly") {
      term.focus();
      return;
    }
    try {
      fit.fit();
      client.send({ t: "term_resize", sessionId, cols: term.cols, rows: term.rows });
      term.focus();
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <div className="cc-pane" style={{ display: active ? "flex" : "none" }}>
      {mode === "readonly" && (
        <div className="cc-ro-banner">🔒 本地终端驱动中 · 只读(整屏镜像 capture-pane)</div>
      )}
      <div className="cc-term" ref={elRef} />
    </div>
  );
}
