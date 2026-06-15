import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import { TMUX_SOCKET, TMUX_SESSION_PREFIX, TERM_FLUSH_MS } from "./config.js";
import { cancelCopyModeArgs, isPaneInCopyMode } from "./tmux-copy-mode.js";

export interface SpawnOpts {
  cwd: string;
  model: string;
  name: string;
  cols?: number;
  rows?: number;
  /** 启动时加 --dangerously-skip-permissions:跳过所有权限确认(YOLO,慎用)。 */
  skipPermissions?: boolean;
}

export interface ManagedMeta {
  sessionId: string;
  tmuxTarget?: string;
}

/** 网页终端态:见 docs/08-terminal-handoff.md。 */
export type TermMode = "interactive" | "readonly";

interface Managed {
  sessionId: string;
  name: string;
  cwd: string;
  model: string;
  backend: "tmux" | "direct";
  tmuxName?: string;
  pty: IPty | null; // tmux 后端可为 null(已 detach,按需重连)
  buf: string; // 输出节流缓冲
  flushTimer: NodeJS.Timeout | null;
  /** 网页终端态:interactive=本端 attach 双向;readonly=本端已断开、靠 capture-pane 镜像(本地终端在驱动)。 */
  mode: TermMode;
  /** 点「打开终端」后等待外部客户端出现的起点(ms);null=非等待中。超时未见外部则回退 interactive。 */
  pendingSince: number | null;
}

/**
 * 启动独立会话前,剔除 Claude Code 自身注入的「本次调用/嵌套」环境标记,否则被 spawn 的
 * claude 会误判为嵌套子会话而不在 `claude agents --json` 注册。见 docs/03-architecture.md。
 */
function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === "CLAUDECODE" || k === "AI_AGENT" || k === "CLAUDE_EFFORT") continue;
    if (k.startsWith("CLAUDE_CODE_")) continue;
    out[k] = v;
  }
  return out;
}

/** 单引号 shell 转义。 */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function tmuxAvailable(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const TX = ["-L", TMUX_SOCKET];

/** 客户端数监视:~1s 一轮 list-clients,驱动 interactive⇄readonly 自动切换。 */
const MONITOR_MS = 1000;
/** 只读态镜像:~500ms 一轮 capture-pane 推快照。 */
const SNAPSHOT_MS = 500;
/** 点「打开终端」后,等外部终端出现的兜底超时:超时仍无外部则回退 interactive。 */
const PENDING_TIMEOUT_MS = 15_000;
/** 打开网页终端时注入最近 tmux 历史,供 xterm 本地滚动。 */
const HISTORY_CAPTURE_LINES = 5000;

/**
 * 管理由本工具启动的交互式 claude 会话。
 * - tmux 后端(默认,若装了 tmux):用 `tmux -L ccwindow` 拉起 detached 会话,node-pty attach 桥接。
 *   好处:本地可 `tmux -L ccwindow attach -t <name>` 接管同一会话;cc-window 重启后会话不丢、可重新接管。
 * - 直连后端(无 tmux 时降级):node-pty 直接 spawn claude(关掉服务即结束)。
 * 见 docs/03-architecture.md。
 *
 * 事件:"data"(sessionId, data) / "exit"(sessionId, code, signal?)
 */
export class PtyManager extends EventEmitter {
  private sessions = new Map<string, Managed>();
  readonly useTmux = tmuxAvailable();
  private monitorTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  /** 「该会话有没有网页在看」判定(由 index 注入 subs 检查);用于只读镜像省 CPU。 */
  private viewerCheck: (sessionId: string) => boolean = () => true;

  managedIds(): Set<string> {
    return new Set(this.sessions.keys());
  }

  /** 注入「有没有网页订阅者」判定(只读镜像仅在有人看时才抓 capture-pane)。 */
  setViewerCheck(fn: (sessionId: string) => boolean): void {
    this.viewerCheck = fn;
  }

  /** 当前网页终端态(外部/未知会话默认 interactive)。 */
  modeOf(sessionId: string): TermMode {
    return this.sessions.get(sessionId)?.mode ?? "interactive";
  }

  managedMeta(): ManagedMeta[] {
    return [...this.sessions.values()].map((m) => ({
      sessionId: m.sessionId,
      tmuxTarget: m.tmuxName ? `tmux -L ${TMUX_SOCKET} attach -t ${m.tmuxName}` : undefined,
    }));
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 给本工具的 tmux socket 设全局选项(幂等;无 server 时静默失败,下次建会话再设)。
   * `mouse on`:保留 tmux/本地终端的鼠标能力;网页端会拦截 wheel,避免误进 copy-mode。
   * `status off`:网页 Dock 已有会话标签和状态,不再让 tmux 自己画底部状态栏。
   */
  private ensureTmuxOptions(): void {
    if (!this.useTmux) return;
    try {
      execFileSync("tmux", [...TX, "set-option", "-g", "mouse", "on"], { stdio: "ignore" });
      execFileSync("tmux", [...TX, "set-option", "-g", "status", "off"], { stdio: "ignore" });
    } catch {
      /* 无 server / 设置失败:忽略 */
    }
  }

  /** 启动会话,返回分配的 sessionId。 */
  launch(opts: SpawnOpts): { sessionId: string; name: string } {
    const sessionId = randomUUID();
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    const skipFlag = opts.skipPermissions ? " --dangerously-skip-permissions" : "";

    if (this.useTmux) {
      const tmuxName = `${TMUX_SESSION_PREFIX}${sessionId}`;
      const cmd =
        `claude --model ${shq(opts.model)} --session-id ${shq(sessionId)} -n ${shq(opts.name)}${skipFlag}`;
      execFileSync(
        "tmux",
        [...TX, "new-session", "-d", "-s", tmuxName, "-x", "200", "-y", "50", "-c", opts.cwd, cmd],
        { env: cleanEnv() },
      );
      this.ensureTmuxOptions(); // 首个 new-session 启动 server 后即可设 mouse on
      const m: Managed = {
        sessionId,
        name: opts.name,
        cwd: opts.cwd,
        model: opts.model,
        backend: "tmux",
        tmuxName,
        pty: null,
        buf: "",
        flushTimer: null,
        mode: "interactive",
        pendingSince: null,
      };
      this.sessions.set(sessionId, m);
      this.ensureAttached(sessionId, cols, rows);
      return { sessionId, name: opts.name };
    }

    // 直连降级
    const args = ["--model", opts.model, "--session-id", sessionId, "-n", opts.name];
    if (opts.skipPermissions) args.push("--dangerously-skip-permissions");
    const p = spawn("claude", args, {
      name: "xterm-color",
      cols,
      rows,
      cwd: opts.cwd,
      env: cleanEnv(),
    });
    const m: Managed = {
      sessionId,
      name: opts.name,
      cwd: opts.cwd,
      model: opts.model,
      backend: "direct",
      pty: p,
      buf: "",
      flushTimer: null,
      mode: "interactive",
      pendingSince: null,
    };
    this.sessions.set(sessionId, m);
    this.wire(m);
    return { sessionId, name: opts.name };
  }

  /** tmux 后端:确保有一个 attach 客户端 PTY(按需重连,供重启后接管 / 重新打开面板)。 */
  ensureAttached(sessionId: string, cols = 80, rows = 24): void {
    const m = this.sessions.get(sessionId);
    if (!m || m.backend !== "tmux" || m.pty || !m.tmuxName) return;
    const p = spawn("tmux", [...TX, "attach-session", "-t", m.tmuxName], {
      name: "xterm-color",
      cols,
      rows,
      cwd: m.cwd || undefined,
      env: cleanEnv(),
    });
    m.pty = p;
    this.wire(m);
  }

  private wire(m: Managed): void {
    const p = m.pty;
    if (!p) return;
    m.buf = "";
    m.flushTimer = null;
    const flush = () => {
      m.flushTimer = null;
      const d = m.buf;
      m.buf = "";
      if (d) this.emit("data", m.sessionId, d);
    };
    p.onData((data) => {
      // 输出节流:TERM_FLUSH_MS 窗口内合并,降帧降 CPU
      m.buf += data;
      if (!m.flushTimer) m.flushTimer = setTimeout(flush, TERM_FLUSH_MS);
    });
    p.onExit(({ exitCode, signal }) => {
      if (m.flushTimer) {
        clearTimeout(m.flushTimer);
        m.flushTimer = null;
      }
      if (m.buf) {
        this.emit("data", m.sessionId, m.buf); // 退出前 flush 残留输出
        m.buf = "";
      }
      m.pty = null;
      if (m.backend === "tmux" && m.tmuxName && this.tmuxExists(m.tmuxName)) {
        return; // 只是 detach,tmux 会话仍在;保留条目,下次按需重连
      }
      this.sessions.delete(m.sessionId);
      this.emit("exit", m.sessionId, exitCode, signal);
    });
  }

  private tmuxExists(tmuxName: string): boolean {
    try {
      execFileSync("tmux", [...TX, "has-session", "-t", tmuxName], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  write(sessionId: string, data: string): void {
    const m = this.sessions.get(sessionId);
    if (!m) return;
    if (!m.pty) this.ensureAttached(sessionId);
    m.pty?.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const m = this.sessions.get(sessionId);
    if (!m || cols <= 0 || rows <= 0) return;
    if (!m.pty) this.ensureAttached(sessionId, cols, rows);
    m.pty?.resize(cols, rows);
  }

  switchModel(sessionId: string, model: string): void {
    this.write(sessionId, `/model ${model}\r`);
  }

  /** 抓最近 tmux 历史 + 当前屏,用于网页端本地 scrollback 初始化。 */
  captureHistory(sessionId: string): string | null {
    const m = this.sessions.get(sessionId);
    if (!m || m.backend !== "tmux" || !m.tmuxName) return null;
    return this.capturePane(m.tmuxName, HISTORY_CAPTURE_LINES);
  }

  /** 网页 interactive 打开前,退出遗留 tmux copy-mode,避免重开面板仍显示 `[N/M]` 历史界面。 */
  cancelCopyModeForWeb(sessionId: string): void {
    const m = this.sessions.get(sessionId);
    if (!m || m.backend !== "tmux" || !m.tmuxName) return;
    if (!this.paneInCopyMode(m.tmuxName)) return;
    try {
      execFileSync("tmux", cancelCopyModeArgs(TX, m.tmuxName), { stdio: "ignore" });
    } catch {
      /* tmux pane 已退出/不在 copy-mode:忽略 */
    }
  }

  /** 显式删除会话(用户主动关闭):tmux 后端会真正 kill-session。 */
  kill(sessionId: string): void {
    const m = this.sessions.get(sessionId);
    if (!m) return;
    if (m.flushTimer) clearTimeout(m.flushTimer);
    if (m.backend === "tmux" && m.tmuxName) {
      try {
        execFileSync("tmux", [...TX, "kill-session", "-t", m.tmuxName], { stdio: "ignore" });
      } catch {
        /* 已不在 */
      }
    }
    try {
      m.pty?.kill();
    } catch {
      /* 已退出 */
    }
    this.sessions.delete(sessionId);
  }

  /** 服务关闭:只 detach(tmux 会话保活),直连会话无法保活只能随之结束。 */
  shutdown(): void {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    this.monitorTimer = this.snapshotTimer = null;
    for (const m of this.sessions.values()) {
      try {
        m.pty?.kill(); // tmux: 仅断开 attach 客户端,会话继续;direct: 进程结束
      } catch {
        /* ignore */
      }
    }
  }

  // ── 网页 ⇄ 本地终端交接(见 docs/08-terminal-handoff.md)──────────────

  /** 启动客户端数监视 + 只读镜像两个轮询(tmux 后端才有意义)。 */
  startMonitor(): void {
    if (!this.useTmux || this.monitorTimer) return;
    this.ensureTmuxOptions(); // 接管已有会话时也确保 mouse on
    this.monitorTimer = setInterval(() => this.monitorClients(), MONITOR_MS);
    this.snapshotTimer = setInterval(() => this.pushSnapshots(), SNAPSHOT_MS);
  }

  /** 某 tmux 会话当前 attach 的客户端数;查询失败返回 -1(本轮跳过)。 */
  private clientCount(tmuxName: string): number {
    try {
      const out = execFileSync("tmux", [...TX, "list-clients", "-t", tmuxName, "-F", "x"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return out.split("\n").filter((l) => l.length > 0).length;
    } catch {
      return -1;
    }
  }

  /**
   * 每轮:按「我自己应有几个客户端(ours)」与实际 list-clients 数 n 比对。
   *  - interactive:n > ours ⇒ 冒出外部终端 ⇒ 断开自己转 readonly
   *  - readonly:外部归零(已确认出现过 / pending 超时)⇒ 重新 attach 转 interactive
   */
  private monitorClients(): void {
    const now = Date.now();
    for (const m of this.sessions.values()) {
      if (m.backend !== "tmux" || !m.tmuxName) continue;
      const n = this.clientCount(m.tmuxName);
      if (n < 0) continue; // 查询失败:保持原态
      if (m.mode === "interactive") {
        const ours = m.pty ? 1 : 0;
        if (n > ours) this.enterReadonly(m); // 有别人 attach 进来了
      } else {
        // readonly:本端无 attach,n 即外部终端数
        if (n >= 1) {
          m.pendingSince = null; // 外部已确认出现
        } else {
          // n === 0
          if (m.pendingSince == null) this.exitReadonly(m); // 外部曾在、现已走 → 收回
          else if (now - m.pendingSince > PENDING_TIMEOUT_MS) this.exitReadonly(m); // 终端没起来,兜底回退
          // 否则:pending 中且未超时,继续等外部 attach
        }
      }
    }
  }

  /** 只读态镜像:有网页在看时,周期把 capture-pane 整屏快照推给前端。 */
  private pushSnapshots(): void {
    for (const m of this.sessions.values()) {
      if (m.mode !== "readonly" || m.backend !== "tmux" || !m.tmuxName) continue;
      if (!this.viewerCheck(m.sessionId)) continue;
      const snap = this.capturePane(m.tmuxName);
      if (snap != null) this.emit("snapshot", m.sessionId, snap);
    }
  }

  private capturePane(tmuxName: string, historyLines = 0): string | null {
    const args = [...TX, "capture-pane", "-p", "-e"];
    if (historyLines > 0) args.push("-S", `-${historyLines}`);
    args.push("-t", tmuxName);
    try {
      return execFileSync("tmux", args, {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null;
    }
  }

  private paneInCopyMode(tmuxName: string): boolean {
    try {
      const out = execFileSync(
        "tmux",
        [...TX, "display-message", "-p", "-t", tmuxName, "#{pane_in_mode}"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      return isPaneInCopyMode(out);
    } catch {
      return false;
    }
  }

  /** 转只读:断开本端 attach(tmux 会话存活),广播 mode 变化。 */
  private enterReadonly(m: Managed): void {
    if (m.mode === "readonly") return;
    if (m.flushTimer) {
      clearTimeout(m.flushTimer);
      m.flushTimer = null;
    }
    try {
      m.pty?.kill(); // 仅断开 attach 客户端;wire 的 onExit 见 tmux 仍在会保留条目
    } catch {
      /* 已退出 */
    }
    m.pty = null;
    m.mode = "readonly";
    this.emit("mode", m.sessionId, "readonly");
  }

  /** 收回交互:转 interactive;若有网页在看则重新 attach 恢复实时双向。 */
  private exitReadonly(m: Managed): void {
    if (m.mode === "interactive") return;
    m.mode = "interactive";
    m.pendingSince = null;
    this.emit("mode", m.sessionId, "interactive");
    if (this.viewerCheck(m.sessionId)) this.ensureAttached(m.sessionId);
  }

  /**
   * 在本机 Terminal.app 打开并 attach 该会话;同时本端立即转只读(等外部终端接管)。
   * 仅 macOS;其它平台返回 false(前端降级为复制 attach 命令)。
   */
  openLocalTerminal(sessionId: string): boolean {
    const m = this.sessions.get(sessionId);
    if (!m || m.backend !== "tmux" || !m.tmuxName) return false;
    if (process.platform !== "darwin") return false;
    this.enterReadonly(m); // 先断自己,避免与即将 attach 的终端短暂双客户端
    m.pendingSince = Date.now();
    const attachCmd = `tmux -L ${TMUX_SOCKET} attach -t ${m.tmuxName}`;
    try {
      execFileSync("osascript", [
        "-e",
        `tell application "Terminal" to do script ${JSON.stringify(attachCmd)}`,
        "-e",
        `tell application "Terminal" to activate`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /** 启动时重新发现已存在的 cc-window tmux 会话(服务重启不丢、可重新接管)。 */
  discover(): void {
    if (!this.useTmux) return;
    let out = "";
    try {
      out = execFileSync(
        "tmux",
        [...TX, "list-sessions", "-F", "#{session_name}\t#{pane_current_path}"],
        { encoding: "utf8" },
      );
    } catch {
      return; // 无 server / 无会话
    }
    for (const line of out.split("\n")) {
      const [tmuxName, cwd] = line.split("\t");
      if (!tmuxName || !tmuxName.startsWith(TMUX_SESSION_PREFIX)) continue;
      const sessionId = tmuxName.slice(TMUX_SESSION_PREFIX.length);
      if (this.sessions.has(sessionId)) continue;
      this.sessions.set(sessionId, {
        sessionId,
        name: "",
        cwd: cwd ?? "",
        model: "",
        backend: "tmux",
        tmuxName,
        pty: null, // 按需(客户端 attach 时)重连
        buf: "",
        flushTimer: null,
        mode: "interactive",
        pendingSince: null,
      });
    }
  }
}
