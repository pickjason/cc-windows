import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { WsClient } from "./ws";
import { stripMouseWheelInput } from "./terminalInput";
import { normalizeTerminalSize, terminalSizeChanged, type TerminalSize } from "./terminalResize";
import {
  INTERACTIVE_SCROLLBACK_LINES,
  READONLY_SCROLLBACK_LINES,
  isAtScrollBottom,
  wheelDeltaToScrollLines,
} from "./terminalScroll";

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
  red: "#a94b51",
  green: "#3e7f61",
  brightRed: "#bd6168",
  brightGreen: "#579a75",
  yellow: "#f59e0b",
  blue: "#3b82f6",
  magenta: "#a78bfa",
  cyan: "#22d3ee",
  white: "#c4cdd8",
  brightWhite: "#e6edf3",
};
const RESET_SGR = "\x1b[0m";

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
  const lastResizeRef = useRef<TerminalSize | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  activeRef.current = active;

  const resizeNow = () => {
    if (modeRef.current === "readonly") return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = elRef.current;
    if (!term || !fit || !el || el.clientWidth === 0 || el.clientHeight === 0) return;
    try {
      fit.fit();
    } catch {
      return;
    }

    const next = normalizeTerminalSize({ cols: term.cols, rows: term.rows });
    if (next.cols !== term.cols || next.rows !== term.rows) {
      try {
        term.resize(next.cols, next.rows);
      } catch {
        return;
      }
    }

    if (!terminalSizeChanged(lastResizeRef.current, next)) return;
    lastResizeRef.current = next;
    client.send({ t: "term_resize", sessionId, cols: next.cols, rows: next.rows });
  };

  const scheduleResize = () => {
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      resizeNow();
    });
  };

  const scrollMetrics = () => {
    const viewport = elRef.current?.querySelector<HTMLElement>(".xterm-viewport");
    if (!viewport) return null;
    return {
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
    };
  };

  const rowHeight = () => {
    const row = elRef.current?.querySelector<HTMLElement>(".xterm-rows > div");
    const height = row?.getBoundingClientRect().height;
    return height && height > 0 ? height : 18;
  };

  const isWheelInsideActiveTerminal = (event: WheelEvent) => {
    const el = elRef.current;
    if (!el || !activeRef.current || modeRef.current === "readonly") return false;
    if (event.composedPath().includes(el)) return true;
    const rect = el.getBoundingClientRect();
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  };

  useEffect(() => {
    const term = new Terminal({
      fontSize: 14,
      fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
      fontWeight: 500,
      fontWeightBold: 700,
      lineHeight: 1.22,
      cursorBlink: true,
      scrollback: INTERACTIVE_SCROLLBACK_LINES,
      theme: XTERM_THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(elRef.current!);
    termRef.current = term;
    fitRef.current = fit;

    const onWheel = (event: WheelEvent) => {
      if (!isWheelInsideActiveTerminal(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const lines = wheelDeltaToScrollLines(event.deltaY, rowHeight());
      if (lines !== 0) term.scrollLines(lines);
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });

    client.send({ t: "attach", sessionId });
    if (active) scheduleResize();

    const onData = term.onData((d) => {
      if (modeRef.current === "readonly") return; // 只读忽略键入
      const data = stripMouseWheelInput(d);
      if (data) client.send({ t: "term_input", sessionId, data });
    });
    const offMsg = client.onMessage((m) => {
      if (m.t === "term_output" && m.sessionId === sessionId) {
        if (modeRef.current !== "readonly") {
          const metrics = scrollMetrics();
          const shouldFollow = !metrics || isAtScrollBottom(metrics);
          term.write(m.data, () => {
            if (shouldFollow) term.scrollToBottom();
          });
        }
      } else if (m.t === "term_snapshot" && m.sessionId === sessionId) {
        term.options.scrollback = READONLY_SCROLLBACK_LINES;
        term.write(RESET_SGR + "\x1b[?25l\x1b[3J\x1b[2J\x1b[H" + m.data.replace(/\n/g, "\r\n") + RESET_SGR, () => {
          term.scrollToBottom();
        });
      } else if (m.t === "term_exit" && m.sessionId === sessionId) {
        term.write(`\r\n\x1b[33m[会话已退出 code=${m.code}]\x1b[0m\r\n`);
      }
    });
    const ro = new ResizeObserver(() => scheduleResize());
    if (elRef.current) ro.observe(elRef.current);

    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      onData.dispose();
      offMsg();
      ro.disconnect();
      window.removeEventListener("wheel", onWheel, { capture: true });
      client.send({ t: "detach", sessionId });
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // mode 由父级控制:切到 readonly 禁输入;切回 interactive 重新 fit + resize + 聚焦
  useEffect(() => {
    modeRef.current = mode;
    const term = termRef.current;
    if (!term) return;
    term.options.disableStdin = mode === "readonly";
    term.options.scrollback = mode === "readonly" ? READONLY_SCROLLBACK_LINES : INTERACTIVE_SCROLLBACK_LINES;
    if (mode === "interactive") {
      term.write(RESET_SGR + "\x1b[?25h");
      lastResizeRef.current = null;
      scheduleResize();
      if (activeRef.current) term.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // 由隐藏变激活:重新 fit + 聚焦(只读态仅聚焦)
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    if (!term) return;
    if (mode === "readonly") {
      term.focus();
      return;
    }
    scheduleResize();
    term.focus();
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
