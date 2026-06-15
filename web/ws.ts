import type { SessionView } from "../server/types";

/** 服务端 → 客户端(见 docs/05-protocol.md)。 */
export type ServerMsg =
  | { t: "hello"; version: string }
  | { t: "roster"; sessions: SessionView[] }
  | { t: "status_update"; session: SessionView }
  | { t: "term_output"; sessionId: string; data: string }
  | { t: "term_exit"; sessionId: string; code: number; signal?: number }
  | { t: "launched"; sessionId: string; name: string; cwd: string; model: string };

/** 客户端 → 服务端。 */
export type ClientMsg =
  | { t: "attach"; sessionId: string }
  | { t: "detach"; sessionId: string }
  | { t: "term_input"; sessionId: string; data: string }
  | { t: "term_resize"; sessionId: string; cols: number; rows: number }
  | { t: "switch_model"; sessionId: string; model: string }
  | { t: "kill"; sessionId: string }
  | { t: "launch"; cwd: string; model: string; name?: string };

/** 单一共享 WebSocket 连接,带自动重连与发送队列。看板与所有终端面板共用。 */
export class WsClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private queue: string[] = [];
  private msgListeners = new Set<(m: ServerMsg) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();

  constructor() {
    this.open();
  }

  private url(): string {
    return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  }

  private open(): void {
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      for (const s of this.queue) ws.send(s);
      this.queue = [];
      this.statusListeners.forEach((fn) => fn(true));
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      this.msgListeners.forEach((fn) => fn(m));
    };
    ws.onclose = () => {
      this.statusListeners.forEach((fn) => fn(false));
      if (!this.closed) this.retry = setTimeout(() => this.open(), 1000);
    };
    ws.onerror = () => ws.close();
  }

  send(msg: ClientMsg): void {
    const s = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  onMessage(fn: (m: ServerMsg) => void): () => void {
    this.msgListeners.add(fn);
    return () => this.msgListeners.delete(fn);
  }
  onStatus(fn: (connected: boolean) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  dispose(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.ws?.close();
  }
}
