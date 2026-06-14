import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { WsClient } from "./ws";

/**
 * 单个会话的 xterm.js 终端面板,通过共享 WsClient 双向桥接 PTY。
 * 见 docs/05-protocol.md(attach / term_input / term_output / term_resize)。
 */
export function TerminalPane({
  client,
  sessionId,
  active,
}: {
  client: WsClient;
  sessionId: string;
  active: boolean;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      cursorBlink: true,
      theme: { background: "#0b0d12", foreground: "#e6e8ec" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(elRef.current!);
    termRef.current = term;
    fitRef.current = fit;

    const resize = () => {
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

    const onData = term.onData((d) => client.send({ t: "term_input", sessionId, data: d }));
    const offMsg = client.onMessage((m) => {
      if (m.t === "term_output" && m.sessionId === sessionId) term.write(m.data);
      else if (m.t === "term_exit" && m.sessionId === sessionId)
        term.write(`\r\n\x1b[33m[会话已退出 code=${m.code}]\x1b[0m\r\n`);
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
  }, [sessionId]);

  // 由隐藏变为激活时重新 fit + 聚焦
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = elRef.current;
    if (!term || !fit || !el || el.clientWidth === 0) return;
    try {
      fit.fit();
      client.send({ t: "term_resize", sessionId, cols: term.cols, rows: term.rows });
      term.focus();
    } catch {
      /* ignore */
    }
  }, [active]);

  return <div className="term" style={{ display: active ? "block" : "none" }} ref={elRef} />;
}
