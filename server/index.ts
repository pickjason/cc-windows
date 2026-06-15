import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import {
  HOST,
  PORT,
  MODELS,
  DEFAULT_MODEL,
  PATHS,
  CONTEXT_POLL_MS,
  EVENTS_MAX_LINES,
  EVENTS_KEEP_LINES,
  EVENTS_ROTATE_MS,
} from "./config.js";
import { RosterPoller } from "./roster.js";
import { EventTailer } from "./events.js";
import { StatusEngine } from "./status.js";
import { PtyManager } from "./pty.js";
import { ContextTracker } from "./transcript.js";
import { recentDirs } from "./recent-dirs.js";

// ── 状态引擎(M2)+ PTY 管理(M4)──────────────────────────────
const roster = new RosterPoller();
const tailer = new EventTailer();
const ptyMgr = new PtyManager();
const ctxTracker = new ContextTracker();
const engine = new StatusEngine(roster, tailer, {
  managed: () => ptyMgr.managedMeta(),
  context: (id) => ctxTracker.get(id),
});

roster.on("error", (err: Error) =>
  console.warn(`[roster] 轮询失败(保留上一份名册): ${err.message}`),
);

// ── HTTP(express)─────────────────────────────────────────────
const app = express();
app.use(express.json());

app.get("/api/sessions", (_req, res) => res.json(engine.computeViews(Date.now())));
app.get("/api/models", (_req, res) => res.json(MODELS));
app.get("/api/recent-dirs", async (_req, res) => {
  res.json(await recentDirs(roster));
});

// 新建会话:校验目录 → 启动交互式 claude(PTY)→ 返回 sessionId
app.post("/api/sessions", async (req, res) => {
  const { cwd, model, name } = req.body ?? {};
  if (typeof cwd !== "string" || !cwd) {
    return res.status(400).json({ error: "缺少 cwd" });
  }
  try {
    const st = await fsp.stat(cwd);
    if (!st.isDirectory()) return res.status(400).json({ error: "cwd 不是目录" });
  } catch {
    return res.status(400).json({ error: "cwd 不存在" });
  }
  const m = typeof model === "string" && model ? model : DEFAULT_MODEL;
  const n = typeof name === "string" && name ? name : path.basename(cwd);
  const out = ptyMgr.launch({ cwd, model: m, name: n });
  broadcast({ t: "launched", sessionId: out.sessionId, name: out.name, cwd, model: m });
  scheduleBroadcast();
  res.json({ sessionId: out.sessionId, name: out.name, cwd, model: m });
});

// 结束会话(本台):真正 kill 掉(tmux 后端会 kill-session)
app.delete("/api/sessions/:id", (req, res) => {
  ptyMgr.kill(req.params.id);
  scheduleBroadcast();
  res.status(204).end();
});

// 生产:托管前端构建产物;开发用 vite(5173)+ 代理,不走这里。
const webDist = path.resolve(process.cwd(), "dist/web");
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => res.sendFile(path.join(webDist, "index.html")));
}

const server = http.createServer(app);

// ── WebSocket(/ws)────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: "/ws" });
const clients = new Set<WebSocket>();
// sessionId -> 订阅其终端输出的 ws 集合
const subs = new Map<string, Set<WebSocket>>();

function send(ws: WebSocket, obj: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function broadcast(obj: unknown): void {
  const msg = JSON.stringify(obj);
  for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
}

// 合并 150ms 内的多次变化,避免高频广播状态。
let pending: NodeJS.Timeout | null = null;
function scheduleBroadcast(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    broadcast({ t: "roster", sessions: engine.computeViews(Date.now()) });
  }, 150);
}
roster.on("update", scheduleBroadcast);
tailer.on("event", scheduleBroadcast);

// PTY 输出 → 路由给订阅者
ptyMgr.on("data", (sessionId: string, data: string) => {
  const set = subs.get(sessionId);
  if (set) for (const ws of set) send(ws, { t: "term_output", sessionId, data });
});
ptyMgr.on("exit", (sessionId: string, code: number, signal?: number) => {
  const set = subs.get(sessionId);
  if (set) for (const ws of set) send(ws, { t: "term_exit", sessionId, code, signal });
  subs.delete(sessionId);
  scheduleBroadcast();
});

function attach(ws: WebSocket, sessionId: string): void {
  let set = subs.get(sessionId);
  if (!set) subs.set(sessionId, (set = new Set()));
  set.add(ws);
}
function detach(ws: WebSocket, sessionId: string): void {
  subs.get(sessionId)?.delete(ws);
}
function detachAll(ws: WebSocket): void {
  for (const set of subs.values()) set.delete(ws);
}

wss.on("connection", (ws) => {
  clients.add(ws);
  send(ws, { t: "hello", version: "0.1.0" });
  send(ws, { t: "roster", sessions: engine.computeViews(Date.now()) });

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : "";
    switch (msg.t) {
      case "attach":
        if (sessionId) {
          ptyMgr.ensureAttached(sessionId); // tmux 会话按需重连(重启后接管 / 重开面板)
          attach(ws, sessionId);
        }
        break;
      case "detach":
        if (sessionId) detach(ws, sessionId);
        break;
      case "term_input":
        if (sessionId && typeof msg.data === "string") ptyMgr.write(sessionId, msg.data);
        break;
      case "term_resize":
        if (sessionId && typeof msg.cols === "number" && typeof msg.rows === "number")
          ptyMgr.resize(sessionId, msg.cols, msg.rows);
        break;
      case "switch_model":
        if (sessionId && typeof msg.model === "string")
          ptyMgr.switchModel(sessionId, msg.model);
        break;
      case "kill":
        if (sessionId) {
          ptyMgr.kill(sessionId);
          scheduleBroadcast();
        }
        break;
      case "launch": {
        const cwd = typeof msg.cwd === "string" ? msg.cwd : "";
        if (!cwd) break;
        const model = typeof msg.model === "string" && msg.model ? msg.model : DEFAULT_MODEL;
        const name = typeof msg.name === "string" && msg.name ? msg.name : path.basename(cwd);
        const out = ptyMgr.launch({ cwd, model, name });
        attach(ws, out.sessionId); // 启动者自动订阅其输出
        send(ws, { t: "launched", sessionId: out.sessionId, name: out.name, cwd, model });
        scheduleBroadcast();
        break;
      }
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    detachAll(ws);
  });
  ws.on("error", () => {
    clients.delete(ws);
    detachAll(ws);
  });
});

// ── 启动 ──────────────────────────────────────────────────────
// events.jsonl 行数滚动:超过上限只保留最后 EVENTS_KEEP_LINES 行(EventTailer 会感知截断并重新 seed)
async function rotateEvents(): Promise<void> {
  try {
    const lines = (await fsp.readFile(PATHS.eventsFile, "utf8"))
      .split("\n")
      .filter((l) => l.length > 0);
    if (lines.length <= EVENTS_MAX_LINES) return;
    const tmp = `${PATHS.eventsFile}.tmp`;
    await fsp.writeFile(tmp, lines.slice(-EVENTS_KEEP_LINES).join("\n") + "\n");
    await fsp.rename(tmp, PATHS.eventsFile);
    console.log(`[events] rotated ${lines.length} -> ${EVENTS_KEEP_LINES} 行`);
  } catch {
    /* 不存在 / 读写失败,忽略 */
  }
}

function refreshContext(): void {
  const entries = [...roster.getMap().values()].map((r) => ({
    sessionId: r.sessionId,
    cwd: r.cwd,
  }));
  void ctxTracker
    .refresh(entries)
    .then(scheduleBroadcast)
    .catch(() => {});
}

async function main(): Promise<void> {
  ptyMgr.discover(); // 重新发现上次遗留的 tmux 会话并接管
  await tailer.start();
  roster.start();
  refreshContext();
  setInterval(refreshContext, CONTEXT_POLL_MS);
  setInterval(() => void rotateEvents(), EVENTS_ROTATE_MS);
  server.listen(PORT, HOST, () => {
    console.log(
      `[cc-window] http://${HOST}:${PORT}  (dev: http://${HOST}:5173)  backend=${ptyMgr.useTmux ? "tmux" : "direct"}`,
    );
  });
}

void main();

process.on("SIGINT", () => {
  ptyMgr.shutdown(); // 只 detach,tmux 会话保活
  process.exit(0);
});
