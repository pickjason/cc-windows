import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { spawn } from "node-pty";
import type { IPty } from "node-pty";
import { TMUX_SOCKET, TMUX_SESSION_PREFIX } from "./config.js";

export interface SpawnOpts {
  cwd: string;
  model: string;
  name: string;
  cols?: number;
  rows?: number;
}

export interface ManagedMeta {
  sessionId: string;
  tmuxTarget?: string;
}

interface Managed {
  sessionId: string;
  name: string;
  cwd: string;
  model: string;
  backend: "tmux" | "direct";
  tmuxName?: string;
  pty: IPty | null; // tmux 后端可为 null(已 detach,按需重连)
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

  managedIds(): Set<string> {
    return new Set(this.sessions.keys());
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

  /** 启动会话,返回分配的 sessionId。 */
  launch(opts: SpawnOpts): { sessionId: string; name: string } {
    const sessionId = randomUUID();
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    if (this.useTmux) {
      const tmuxName = `${TMUX_SESSION_PREFIX}${sessionId}`;
      const cmd =
        `claude --model ${shq(opts.model)} --session-id ${shq(sessionId)} -n ${shq(opts.name)}`;
      execFileSync(
        "tmux",
        [...TX, "new-session", "-d", "-s", tmuxName, "-x", "200", "-y", "50", "-c", opts.cwd, cmd],
        { env: cleanEnv() },
      );
      const m: Managed = {
        sessionId,
        name: opts.name,
        cwd: opts.cwd,
        model: opts.model,
        backend: "tmux",
        tmuxName,
        pty: null,
      };
      this.sessions.set(sessionId, m);
      this.ensureAttached(sessionId, cols, rows);
      return { sessionId, name: opts.name };
    }

    // 直连降级
    const p = spawn("claude", ["--model", opts.model, "--session-id", sessionId, "-n", opts.name], {
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
    p.onData((data) => this.emit("data", m.sessionId, data));
    p.onExit(({ exitCode, signal }) => {
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

  /** 显式删除会话(用户主动关闭):tmux 后端会真正 kill-session。 */
  kill(sessionId: string): void {
    const m = this.sessions.get(sessionId);
    if (!m) return;
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
    for (const m of this.sessions.values()) {
      try {
        m.pty?.kill(); // tmux: 仅断开 attach 客户端,会话继续;direct: 进程结束
      } catch {
        /* ignore */
      }
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
      });
    }
  }
}
