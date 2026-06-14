import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { PATHS } from "./config.js";
import type { EventRecord, EventState } from "./types.js";

const EVENTS_POLL_MS = 400;

/**
 * 源 B:增量读取 ~/.claude/monitor/events.jsonl(hooks 写入),
 * 按 session_id 维护「最新事件态」EventState。
 * 见 docs/02-claude-code-observability.md(面 2)与 docs/04-status-model.md。
 *
 * 采用「轮询文件大小 + 增量读」而非 fs.watch(跨平台最稳;见 02 文档坑表 #10 思路)。
 *
 * 事件:
 *   "event"  (state: EventState, rec: EventRecord)  收到一条新事件(seed 阶段不触发)
 *   "seeded" ()                                      启动时把历史读完、建好初始态
 */
export class EventTailer extends EventEmitter {
  private states = new Map<string, EventState>();
  private offset = 0;
  private leftover = "";
  private timer: NodeJS.Timeout | null = null;
  private reading = false;
  private readonly file = PATHS.eventsFile;

  getStates(): Map<string, EventState> {
    return this.states;
  }

  async start(): Promise<void> {
    await this.tick(false); // 先把历史读完建初始态(静默)
    this.emit("seeded");
    this.timer = setInterval(() => void this.tick(true), EVENTS_POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(emit: boolean): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      let size: number;
      try {
        size = (await fs.stat(this.file)).size;
      } catch {
        return; // 文件还不存在(尚无任何事件),下次再看
      }
      if (size < this.offset) {
        // 文件被截断/轮转 → 从头来
        this.offset = 0;
        this.leftover = "";
      }
      if (size === this.offset) return;

      const fh = await fs.open(this.file, "r");
      try {
        const len = size - this.offset;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, this.offset);
        this.offset = size;
        this.leftover += buf.toString("utf8");
      } finally {
        await fh.close();
      }

      const parts = this.leftover.split("\n");
      this.leftover = parts.pop() ?? ""; // 末尾可能是半行,留到下次
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let rec: EventRecord;
        try {
          rec = JSON.parse(trimmed) as EventRecord;
        } catch {
          continue;
        }
        const state = this.applyRecord(rec);
        if (state && emit) this.emit("event", state, rec);
      }
    } finally {
      this.reading = false;
    }
  }

  private applyRecord(rec: EventRecord): EventState | null {
    if (!rec.session_id || !rec.event) return null;
    const ts = Date.parse(rec.ts) || Date.now();
    const prev = this.states.get(rec.session_id);
    const next: EventState = {
      lastEvent: rec.event,
      lastEventTs: ts,
      notificationType:
        rec.event === "Notification"
          ? rec.notification_type ?? undefined
          : prev?.notificationType,
      lastTool: rec.tool ?? prev?.lastTool, // 工具名粘滞:无新工具时沿用上一个
    };
    this.states.set(rec.session_id, next);
    return next;
  }
}
