import { spawn } from "node:child_process";
import { SUM, type Lang } from "./i18n.js";
import type { AggregateResult, ParsedFile } from "./types.js";
import { fmtTokens, localDay, localHm, totalTokens } from "./util.js";

const MAX_MSGS_PER_SESSION = 30;

export interface SessionMaterial {
  sessionId: string;
  project: string;
  title: string | null;
  msgs: Array<{ ts: string; text: string }>;
}

/** 收集某天所有会话的用户指令素材(按项目分组前的扁平列表) */
export function buildDayMaterial(files: ParsedFile[], day: string): SessionMaterial[] {
  const seen = new Set<string>();
  const bySession = new Map<string, SessionMaterial>();

  for (const f of files) {
    if (f.excluded || f.forceSidechain || !f.sessionId) continue;
    for (const m of f.userMessages) {
      if (m.sidechain || localDay(m.ts) !== day) continue;
      if (seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      let s = bySession.get(f.sessionId);
      if (!s) {
        s = { sessionId: f.sessionId, project: f.project, title: f.firstUserMessage, msgs: [] };
        bySession.set(f.sessionId, s);
      }
      if (s.msgs.length < MAX_MSGS_PER_SESSION) s.msgs.push({ ts: m.ts, text: m.text });
    }
  }

  return [...bySession.values()]
    .filter((s) => s.msgs.length > 0)
    .sort((a, b) => a.msgs[0]!.ts.localeCompare(b.msgs[0]!.ts));
}

function statsLine(agg: AggregateResult, day: string, lang: Lang): string {
  const t = SUM[lang];
  const d = agg.days[day];
  if (!d) return t.noData;
  return t.overview({
    sessions: d.sessions,
    prompts: d.userMessages,
    output: fmtTokens(d.usage.output),
    input: fmtTokens(d.usage.input),
    cache: fmtTokens(d.usage.cacheCreation + d.usage.cacheRead),
    total: fmtTokens(totalTokens(d.usage)),
  });
}

/** 规则日报:零成本,直接从素材生成 markdown */
export function ruleSummary(
  agg: AggregateResult,
  sessions: SessionMaterial[],
  day: string,
  lang: Lang = "zh"
): string {
  const t = SUM[lang];
  const lines: string[] = [];
  lines.push(t.title(day));
  lines.push("");
  lines.push(`**${t.overviewLabel}**:${statsLine(agg, day, lang)}`);
  lines.push("");

  if (sessions.length === 0) {
    lines.push(t.noSessions);
    return lines.join("\n");
  }

  const byProject = new Map<string, SessionMaterial[]>();
  for (const s of sessions) {
    const list = byProject.get(s.project) ?? [];
    list.push(s);
    byProject.set(s.project, list);
  }

  for (const [project, list] of byProject) {
    lines.push(t.projectHeading(project, list.length));
    for (const s of list) {
      const start = localHm(s.msgs[0]!.ts);
      const end = localHm(s.msgs[s.msgs.length - 1]!.ts);
      const range = start === end ? start : `${start}–${end}`;
      lines.push(`### ${range} · ${s.title ?? t.untitled}`);
      for (const m of s.msgs) {
        lines.push(`> ${m.text}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** LLM 日报:把规则素材交给本机 claude CLI 浓缩(走订阅,无需 API key) */
export async function llmSummary(
  agg: AggregateResult,
  sessions: SessionMaterial[],
  day: string,
  model: string,
  lang: Lang = "zh"
): Promise<string> {
  const material = ruleSummary(agg, sessions, day, lang);
  const prompt = `${SUM[lang].llmPrompt}\n\n${material}`;
  return runClaude(prompt, model);
}

function runClaude(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--model", model, "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      reject(
        new Error(
          `Failed to launch the claude CLI — is Claude Code installed and on PATH? (${e.message})`
        )
      )
    );
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`claude exited with code ${code}: ${err.slice(0, 500)}`));
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    timer.unref();
    child.stdin.write(prompt);
    child.stdin.end();
  });
}
