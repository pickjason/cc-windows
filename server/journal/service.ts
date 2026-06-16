import fsp from "node:fs/promises";
import path from "node:path";
import { PATHS } from "../config.js";
import { aggregate } from "./aggregate.js";
import { refresh } from "./cache.js";
import { detectLang, type Lang } from "./i18n.js";
import { buildDayMaterial, llmSummary, ruleSummary } from "./summary.js";
import type { AggregateResult, ParsedFile } from "./types.js";

// 解析结果缓存 15s:看板拉取频繁,避免每次重扫 ~/.claude/projects
const REFRESH_INTERVAL_MS = 15_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODEL_RE = /^[\w.-]+$/;

let agg: AggregateResult | null = null;
let files: ParsedFile[] = [];
let lastRefresh = 0;
let refreshing: Promise<AggregateResult> | null = null;
// 同一天的 LLM 日报只允许一个生成中的请求,避免重复烧用量
const inflight = new Map<string, Promise<string>>();

/** 拉取聚合统计;15s 内复用上次结果,并发刷新合并到同一个 in-flight Promise。 */
export async function getStats(force = false): Promise<AggregateResult> {
  if (!force && agg && Date.now() - lastRefresh < REFRESH_INTERVAL_MS) return agg;
  if (!refreshing) {
    refreshing = (async () => {
      files = await refresh(PATHS.claudeDir, PATHS.journalDataDir);
      agg = aggregate(files);
      lastRefresh = Date.now();
      refreshing = null;
      return agg;
    })();
  }
  return refreshing;
}

function llmCachePath(date: string, lang: Lang): string {
  return path.join(PATHS.journalDataDir, "summaries", `${date}-llm.${lang}.md`);
}

export interface SummaryParams {
  date?: string;
  llm?: boolean;
  force?: boolean;
  model?: string;
  lang?: string;
}

/** 日报:规则版即时生成;LLM 版按天落盘缓存 + in-flight 去重(避免重复烧用量)。 */
export async function getSummary(p: SummaryParams): Promise<{ status: number; body: unknown }> {
  const date = p.date ?? "";
  if (!DATE_RE.test(date)) return { status: 400, body: { error: "invalid date" } };
  const model = p.model ?? "haiku";
  if (!MODEL_RE.test(model)) return { status: 400, body: { error: "invalid model" } };
  const lang = detectLang(p.lang);
  const wantLlm = p.llm === true;
  const force = p.force === true;

  const aggNow = await getStats();
  const material = buildDayMaterial(files, date);

  if (!wantLlm) {
    let hasLlm = false;
    try {
      await fsp.access(llmCachePath(date, lang));
      hasLlm = true;
    } catch {
      // 无缓存
    }
    return {
      status: 200,
      body: { date, llm: false, cached: false, hasLlm, markdown: ruleSummary(aggNow, material, date, lang) },
    };
  }

  const cacheFile = llmCachePath(date, lang);
  if (!force) {
    try {
      const md = await fsp.readFile(cacheFile, "utf8");
      return { status: 200, body: { date, llm: true, cached: true, markdown: md } };
    } catch {
      // 无缓存 → 生成
    }
  }

  const key = `${date}:${model}:${lang}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const md = await llmSummary(aggNow, material, date, model, lang);
        await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
        await fsp.writeFile(cacheFile, md);
        return md;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
  }
  const md = await pending;
  return { status: 200, body: { date, llm: true, cached: false, markdown: md } };
}
