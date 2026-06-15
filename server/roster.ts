import { EventEmitter } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROSTER_POLL_MS } from "./config.js";
import type { RosterEntry } from "./types.js";

const pexec = promisify(execFile);

/**
 * Claude Code 后台 daemon 维护一个「预热 worker 池」(`--bg-spare` 空闲 worker /
 * `--bg-pty-host` 宿主,跑在 /tmp/cc-daemon-<id>/spare 下)。这些**不是用户可交互的会话**:
 *  - 空闲 spare 卡住时会以 `status=waiting / waitingFor="permission prompt"` 冒充「等待授权」,
 *    在看板挂出一张永远点不掉的红卡;
 *  - 被池接管的 headless agent(`--resume <id> --agent …`,父进程为 `--bg-pty-host`)也没有
 *    可在网页授权/输入的 TTY。
 * 故统一从名册剔除。识别需同时看**自身命令行**(空 spare 自带 `--bg-spare`)与**父进程命令行**
 * (被接管的 agent 自身只有 `--resume`,标记在 `--bg-pty-host` 父进程上)。
 */
const INTERNAL_WORKER_RE = /--bg-spare\b|--bg-pty-host\b/;

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
  /** pid -> 是否为内部 daemon worker。按 pid 缓存,稳态下不再重复 ps。 */
  private internalByPid = new Map<number, boolean>();

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

  private async pollOnce(): Promise<void> {
    if (this.polling) return; // 上一次还没回来,跳过
    this.polling = true;
    try {
      const { stdout } = await pexec("claude", ["agents", "--json"], {
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const arr = JSON.parse(stdout) as RosterEntry[];
      const entries = arr.filter(
        (e): e is RosterEntry => !!e && typeof e.sessionId === "string",
      );
      await this.classify(entries.map((e) => e.pid));
      const next = new Map<string, RosterEntry>();
      for (const e of entries) {
        if (this.internalByPid.get(e.pid) === true) continue; // 跳过内部 daemon worker
        next.set(e.sessionId, e);
      }
      this.pruneCache(entries.map((e) => e.pid));
      this.current = next;
      this.emit("update", next);
    } catch (err) {
      this.emit("error", err as Error);
    } finally {
      this.polling = false;
    }
  }

  /**
   * 为尚未分类的 pid 跑一次进程快照,判断其(或父进程)是否为内部 daemon worker。
   * ps 失败时 fail-open:这些 pid 本轮不分类(当作真实会话展示),下轮重试 ——
   * 宁可短暂多显示一张卡,也绝不因 ps 抖动误杀真实会话。
   */
  private async classify(pids: number[]): Promise<void> {
    const unknown = pids.filter((p) => typeof p === "number" && !this.internalByPid.has(p));
    if (unknown.length === 0) return;
    let snap: Map<number, { ppid: number; cmd: string }>;
    try {
      snap = await procSnapshot();
    } catch {
      return; // fail-open
    }
    for (const pid of unknown) {
      const self = snap.get(pid);
      if (!self) {
        this.internalByPid.set(pid, false); // 进程已不在(快照晚于名册);当作真实会话,下轮 roster 自然清掉
        continue;
      }
      const parent = snap.get(self.ppid);
      const internal =
        INTERNAL_WORKER_RE.test(self.cmd) || (!!parent && INTERNAL_WORKER_RE.test(parent.cmd));
      this.internalByPid.set(pid, internal);
    }
  }

  /** 清掉已不在名册的 pid 分类缓存(进程退出后 pid 可能被复用)。 */
  private pruneCache(livePids: number[]): void {
    const live = new Set(livePids);
    for (const pid of this.internalByPid.keys()) {
      if (!live.has(pid)) this.internalByPid.delete(pid);
    }
  }
}

/** 进程快照:pid -> {ppid, 完整命令行}。识别 daemon worker 需要看父进程,故取全表。 */
async function procSnapshot(): Promise<Map<number, { ppid: number; cmd: string }>> {
  const { stdout } = await pexec("ps", ["-ax", "-o", "pid=,ppid=,command="], {
    timeout: 5_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const map = new Map<number, { ppid: number; cmd: string }>();
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    map.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] ?? "" });
  }
  return map;
}
