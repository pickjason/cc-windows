import { useEffect, useRef, useState } from "react";
import type { JournalMessages, Lang } from "./i18n";
import { mdToHtml } from "./util";

type Mode = "rule" | "llm";

/** 当日日报:规则版即时;点按钮调 /api/journal/summary?llm=1 生成 LLM 浓缩版(走本机 claude)。 */
export function DayReport({
  day,
  lang,
  hasDay,
  t,
}: {
  day: string;
  lang: Lang;
  hasDay: boolean;
  t: JournalMessages;
}) {
  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<Mode>("rule");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  // 切日后丢弃过期请求结果
  const dayRef = useRef(day);
  dayRef.current = day;

  // 去掉日报自带的大标题与概览行:面板已有日期、当日概览已显示同样的统计
  function strip(md: string): string {
    return md
      .replace(/^# .*\n+/, "")
      .replace(/^\*\*概览\*\*.*\n+/, "")
      .replace(/^\*\*Overview\*\*.*\n+/, "")
      .replace(/^-{3,}\s*\n+/, "");
  }

  async function load(opts: { llm?: boolean; force?: boolean } = {}): Promise<void> {
    if (!hasDay) {
      setHtml("");
      setStatus("");
      setMode("rule");
      return;
    }
    if (opts.llm) {
      setLoading(true);
      setStatus(t.generating);
    }
    try {
      const q = `date=${day}&lang=${lang}` + (opts.llm ? `&llm=1${opts.force ? "&force=1" : ""}` : "");
      const r = await fetch(`/api/journal/summary?${q}`);
      const data = await r.json();
      if (dayRef.current !== day) return; // 已切到别的日期
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setMode(data.llm ? "llm" : "rule");
      setHtml(mdToHtml(strip(String(data.markdown ?? ""))));
      setLoading(false);
      setStatus(data.llm ? (data.cached ? t.cachedTag : "") : t.ruleTag);
      // 已有 LLM 缓存 → 自动加载(秒开)
      if (!data.llm && data.hasLlm) void load({ llm: true });
    } catch (e: any) {
      if (dayRef.current !== day) return;
      setLoading(false);
      setStatus(t.reportFailed(e?.message ?? String(e)));
    }
  }

  // 切日 / 切语言 → 重载规则版
  useEffect(() => {
    void load();
    // eslint 无关:load 闭包引用 day/lang/hasDay,这里以它们为依赖即可
  }, [day, lang, hasDay]);

  if (!hasDay) {
    return (
      <div className="jr-report">
        <h3>{t.reportTitle}</h3>
        <div className="jr-empty">{t.noActivity}</div>
      </div>
    );
  }

  return (
    <div className="jr-report">
      <div className="jr-report-head">
        <h3>{t.reportTitle}</h3>
        <button
          className="cc-btn cc-btn-sm"
          disabled={loading}
          onClick={() => void load({ llm: true, force: mode === "llm" })}
        >
          {mode === "llm" ? t.btnRegen : t.btnLlm}
        </button>
        <span className="jr-report-status">{status}</span>
      </div>
      <div className="jr-report-box" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
