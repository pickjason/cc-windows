import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { WsClient } from "./ws";

/**
 * 单个会话的 xterm.js 终端面板,通过共享 WsClient 双向桥接 PTY。
 * 见 docs/05-protocol.md(attach / term_input / term_output / term_resize)
 * 与 docs/08-terminal-handoff.md(interactive ⇄ readonly):
 *  - interactive:双向驱动(现状);
 *  - readonly:本地终端在驱动,网页禁输入/禁 resize,靠 term_snapshot 整屏镜像,顶角显示只读标识。
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
  const modeRef = useRef<"interactive" | "readonly">("interactive");
  const activeRef = useRef(active);
  activeRef.current = active;
  const [readonly, setReadonly] = useState(false);

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
      if (modeRef.current === "readonly") return; // 只读态不改尺寸(避免重排镜像快照)
      const el = elRef.current;
      if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      client.send({ t: "term_resize", sessionId, cols: term.cols, rows: term.rows });
    };

    const applyMode = (mode: "interactive" | "readonly") => {
      if (modeRef.current === mode) return;
      modeRef.current = mode;
      setReadonly(mode === "readonly");
      term.options.disableStdin = mode === "readonly";
      if (mode === "interactive") {
        term.write("\x1b[?25h"); // 恢复光标(只读时被快照隐藏)
        try {
          // 服务端已重新 attach;fit + resize 触发 tmux 全量重绘,刷掉残留的只读快照
          fit.fit();
          client.send({ t: "term_resize", sessionId, cols: term.cols, rows: term.rows });
          if (activeRef.current) term.focus();
        } catch {
          /* ignore */
        }
      }
    };

    client.send({ t: "attach", sessionId });
    if (active) resize();

    const onData = term.onData((d) => {
      if (modeRef.current === "readonly") return; // 只读忽略键入
      client.send({ t: "term_input", sessionId, data: d });
    });
    const offMsg = client.onMessage((m) => {
      if (m.t === "term_output" && m.sessionId === sessionId) {
        if (modeRef.current !== "readonly") term.write(m.data); // 只读时丢弃残留输出,只认快照
      } else if (m.t === "term_snapshot" && m.sessionId === sessionId) {
        // 只读整屏快照:隐藏光标 + 清屏回原点 + 写入(capture-pane 的 \n 转 \r\n)
        term.write("\x1b[?25l\x1b[2J\x1b[H" + m.data.replace(/\n/g, "\r\n"));
      } else if (m.t === "term_mode" && m.sessionId === sessionId) {
        applyMode(m.mode);
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
  }, [sessionId]);

  // 由隐藏变为激活时重新 fit + 聚焦(只读态不 resize,仅聚焦)
  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    const el = elRef.current;
    if (!term || !fit || !el || el.clientWidth === 0) return;
    if (modeRef.current === "readonly") {
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
  }, [active]);

  return (
    <div className="term-pane" style={{ display: active ? "block" : "none" }}>
      {readonly && <div className="term-readonly-banner">🔒 本地终端驱动中 · 只读</div>}
      <div className="term" ref={elRef} />
    </div>
  );
}
