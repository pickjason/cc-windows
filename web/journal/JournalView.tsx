import { useEffect, useMemo, useState } from "react";
import type { AggregateResult } from "../../server/journal/types";
import { detectLang, I18N, type Lang } from "./i18n";
import { fmt, localToday, type Metric, timeRange, totalTokens } from "./util";
import { heatmapOption, hoursOption, modelsOption, projectsOption, trendOption } from "./charts";
import { EChart } from "./EChart";
import { DayReport } from "./DayReport";

const METRICS: Metric[] = ["totalTokens", "output", "sessions", "userMessages"];

/** 历史用量统计视图(承接 cc-journal,见 docs/11)。拉取 /api/journal/stats 一次,本地切年/指标/日。 */
export function JournalView({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<AggregateResult | null>(null);
  const [err, setErr] = useState("");
  const [lang, setLang] = useState<Lang>(detectLang());
  const [year, setYear] = useState("");
  const [metric, setMetric] = useState<Metric>("totalTokens");
  const [day, setDay] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/journal/stats")
      .then((r) => r.json())
      .then((d: AggregateResult) => {
        if (!alive) return;
        setData(d);
        const years = [...new Set(Object.keys(d.days).map((x) => x.slice(0, 4)))].sort();
        const cur = String(new Date().getFullYear());
        setYear(years.includes(cur) ? cur : (years[years.length - 1] ?? cur));
        const today = localToday();
        setDay(d.days[today] ? today : (d.rangeEnd ?? today));
      })
      .catch((e) => {
        if (alive) setErr(e?.message ?? String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const t = I18N[lang];
  const ready = !!data && !!year;

  // 所有 hook 必须在任何 return 之前无条件调用:option 构造器对 null 数据返回 null
  const heat = useMemo(
    () => (data && year ? heatmapOption(data, year, metric, t) : null),
    [data, year, metric, lang],
  );
  const trend = useMemo(() => (data && year ? trendOption(data, year, t) : null), [data, year, lang]);
  const hours = useMemo(() => (data && year ? hoursOption(data, year, t) : null), [data, year, lang]);
  const projects = useMemo(() => (data && year ? projectsOption(data, year) : null), [data, year]);
  const models = useMemo(() => (data && year ? modelsOption(data, year) : null), [data, year]);

  const header = (
    <header className="cc-header jr-header">
      <div className="cc-brand">
        <span className="cc-brand-name">cc-window</span>
        <span className="cc-brand-sub">历史用量统计</span>
      </div>
      <button className="cc-btn" onClick={onBack}>← 看板</button>
      <span style={{ flex: 1 }} />
      {ready && (
        <>
          <label className="jr-ctrl">
            {t.lblYear}
            <select className="cc-input cc-input-sm" value={year} onChange={(e) => setYear(e.target.value)}>
              {[...new Set(Object.keys(data!.days).map((x) => x.slice(0, 4)))].sort().map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label className="jr-ctrl">
            {t.lblMetric}
            <select className="cc-input cc-input-sm" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {METRICS.map((m) => (
                <option key={m} value={m}>{t.metricOptions[m]}</option>
              ))}
            </select>
          </label>
        </>
      )}
      <select
        className="cc-input cc-input-sm"
        value={lang}
        onChange={(e) => {
          const l = e.target.value as Lang;
          setLang(l);
          try { localStorage.setItem("journal-lang", l); } catch { /* ignore */ }
        }}
      >
        <option value="zh">中文</option>
        <option value="en">English</option>
      </select>
    </header>
  );

  if (err) {
    return (
      <div className="jr">
        {header}
        <div className="jr-body"><div className="jr-error">加载失败:{err}</div></div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="jr">
        {header}
        <div className="jr-body"><div className="jr-loading">正在解析历史用量…(首次较慢)</div></div>
      </div>
    );
  }

  const tt = data!.totals;
  const dayData = data!.days[day];
  const daySessions = data!.sessions
    .filter((s) => s.days.includes(day))
    .sort((a, b) => b.start.localeCompare(a.start));

  return (
    <div className="jr">
      {header}
      <div className="jr-body">
        <div className="jr-chips">
          <span className="cc-chip"><b>{tt.sessions}</b> {t.chipSessions}</span>
          <span className="cc-chip"><b>{tt.activeDays}</b> {t.chipActiveDays}</span>
          <span className="cc-chip"><b>{tt.projects}</b> {t.chipProjects}</span>
          <span className="cc-chip"><b>{tt.userMessages}</b> {t.chipPrompts}</span>
          <span className="cc-chip"><b>{fmt(tt.usage.output)}</b> {t.chipOutput}</span>
          <span className="cc-chip"><b>{fmt(totalTokens(tt.usage))}</b> {t.chipTotal}</span>
        </div>

        <section className="jr-panel">
          <h2>{t.heatmapTitle(year, t.metricOptions[metric])}</h2>
          <EChart option={heat} height={200} onDayClick={setDay} />
        </section>

        <div className="jr-grid2">
          <section className="jr-panel"><h2>{t.h2Trend}</h2><EChart option={trend} height={300} /></section>
          <section className="jr-panel"><h2>{t.h2Hours}</h2><EChart option={hours} height={300} /></section>
          <section className="jr-panel"><h2>{t.h2Projects}</h2><EChart option={projects} height={340} /></section>
          <section className="jr-panel"><h2>{t.h2Models}</h2><EChart option={models} height={340} /></section>
        </div>

        <section className="jr-panel">
          <h2>{t.dayTitle(day)}</h2>
          {dayData && <div className="jr-day-summary" dangerouslySetInnerHTML={{ __html: t.daySummary(dayData) }} />}
          <div className="jr-day-grid">
            <DayReport day={day} lang={lang} hasDay={!!dayData} t={t} />
            <div>
              <h3 className="jr-col-title">{t.sessionsTitle(daySessions.length)}</h3>
              {daySessions.length === 0 ? (
                <div className="jr-empty">{dayData ? t.noSessions : t.noActivity}</div>
              ) : (
                daySessions.map((s) => (
                  <div className="jr-session" key={s.id}>
                    <div className="jr-session-head">
                      <span className="jr-session-time">{timeRange(s.start, s.end)}</span>
                      <span className="cc-badge">{s.project}</span>
                      <span className="jr-session-models">{s.models.join(", ")}</span>
                    </div>
                    <div className="jr-session-title">{s.title ?? t.untitled}</div>
                    <div className="jr-session-stats">{t.sessionStats(s)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <footer className="jr-footer">{t.footer}</footer>
      </div>
    </div>
  );
}
