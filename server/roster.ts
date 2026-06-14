import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { ROSTER_POLL_MS } from "./config.js";
import type { RosterEntry } from "./types.js";

/**
 * 源 A:周期性执行 `claude agents --json`,维护 sessionId -> RosterEntry 名册。
 * 见 docs/02-claude-code-observability.md(面 1)。
 *
 * 事件:
 *   "update"  (map: Map<string, RosterEntry>)  每次成功轮询后
 *   "error"   (err: Error)                      轮询失败(保留上一份名册)
 */
export class RosterPoller extends EventEmitter {
  private current = new Map<string, RosterEntry>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  getMap(): Map<string, RosterEntry> {
    return this.current;
  }

  start(): void {
    if (this.timer) return;
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), ROSTER_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private pollOnce(): Promise<void> {
    if (this.polling) return Promise.resolve(); // 上一次还没回来,跳过
    this.polling = true;
    return new Promise((resolve) => {
      execFile(
        "claude",
        ["agents", "--json"],
        { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => {
          this.polling = false;
          if (err) {
            this.emit("error", err);
            return resolve();
          }
          try {
            const arr = JSON.parse(stdout) as RosterEntry[];
            const next = new Map<string, RosterEntry>();
            for (const e of arr) {
              if (e && typeof e.sessionId === "string") next.set(e.sessionId, e);
            }
            this.current = next;
            this.emit("update", next);
          } catch (parseErr) {
            this.emit("error", parseErr as Error);
          }
          resolve();
        },
      );
    });
  }
}
