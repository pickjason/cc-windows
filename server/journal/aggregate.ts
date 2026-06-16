import type {
  AggregateResult,
  DayOut,
  ParsedFile,
  Usage,
} from "./types.js";
import { addUsage, emptyUsage, localDay, localHour } from "./util.js";

interface DayAcc {
  sessionSet: Set<string>;
  userMessages: number;
  assistantMessages: number;
  usage: Usage;
  sidechain: Usage;
  hours: number[];
  byProject: Map<string, { usage: Usage; userMessages: number }>;
  byModel: Map<string, { usage: Usage; count: number }>;
}

interface SessionAcc {
  id: string;
  project: string;
  start: string;
  end: string;
  title: string | null;
  userMessages: number;
  usage: Usage;
  models: Set<string>;
  days: Set<string>;
}

interface ProjectAcc {
  sessionSet: Set<string>;
  userMessages: number;
  usage: Usage;
  firstDay: string;
  lastDay: string;
}

export function aggregate(files: ParsedFile[]): AggregateResult {
  // 排除本工具自身产生的会话与无内容文件;按开始时间排序,使去重时用量归属到原始会话
  const real = files
    .filter((f) => !f.excluded && f.sessionId && (f.events.length > 0 || f.userMessages.length > 0))
    .sort((a, b) => (a.firstTs ?? "9999").localeCompare(b.firstTs ?? "9999"));

  const seenEvent = new Set<string>();
  const seenUserMsg = new Set<string>();
  const days = new Map<string, DayAcc>();
  const sessions = new Map<string, SessionAcc>();
  const projects = new Map<string, ProjectAcc>();
  const models = new Map<string, { usage: Usage; count: number }>();

  const getDay = (day: string): DayAcc => {
    let d = days.get(day);
    if (!d) {
      d = {
        sessionSet: new Set(),
        userMessages: 0,
        assistantMessages: 0,
        usage: emptyUsage(),
        sidechain: emptyUsage(),
        hours: new Array<number>(24).fill(0),
        byProject: new Map(),
        byModel: new Map(),
      };
      days.set(day, d);
    }
    return d;
  };

  const getProject = (name: string, day: string): ProjectAcc => {
    let p = projects.get(name);
    if (!p) {
      p = { sessionSet: new Set(), userMessages: 0, usage: emptyUsage(), firstDay: day, lastDay: day };
      projects.set(name, p);
    }
    if (day < p.firstDay) p.firstDay = day;
    if (day > p.lastDay) p.lastDay = day;
    return p;
  };

  for (const f of real) {
    const sid = f.sessionId!;
    // agent-*.jsonl 是子代理转录:用量计入,但不作为独立会话
    let sess: SessionAcc | null = null;
    if (!f.forceSidechain) {
      sess = sessions.get(sid) ?? null;
      if (!sess) {
        sess = {
          id: sid,
          project: f.project,
          start: f.firstTs ?? "",
          end: f.lastTs ?? "",
          title: null,
          userMessages: 0,
          usage: emptyUsage(),
          models: new Set(),
          days: new Set(),
        };
        sessions.set(sid, sess);
      }
      if (f.firstTs && (!sess.start || f.firstTs < sess.start)) sess.start = f.firstTs;
      if (f.lastTs && (!sess.end || f.lastTs > sess.end)) sess.end = f.lastTs;
      if (!sess.title && f.firstUserMessage) sess.title = f.firstUserMessage;
    }

    for (const ev of f.events) {
      if (seenEvent.has(ev.key)) continue;
      seenEvent.add(ev.key);

      const day = localDay(ev.ts);
      const d = getDay(day);
      d.assistantMessages++;
      addUsage(d.usage, ev.usage);
      if (ev.sidechain) addUsage(d.sidechain, ev.usage);
      const hour = localHour(ev.ts);
      d.hours[hour] = (d.hours[hour] ?? 0) + 1;

      let bp = d.byProject.get(f.project);
      if (!bp) {
        bp = { usage: emptyUsage(), userMessages: 0 };
        d.byProject.set(f.project, bp);
      }
      addUsage(bp.usage, ev.usage);

      let bm = d.byModel.get(ev.model);
      if (!bm) {
        bm = { usage: emptyUsage(), count: 0 };
        d.byModel.set(ev.model, bm);
      }
      addUsage(bm.usage, ev.usage);
      bm.count++;

      let gm = models.get(ev.model);
      if (!gm) {
        gm = { usage: emptyUsage(), count: 0 };
        models.set(ev.model, gm);
      }
      addUsage(gm.usage, ev.usage);
      gm.count++;

      const proj = getProject(f.project, day);
      addUsage(proj.usage, ev.usage);

      if (sess) {
        addUsage(sess.usage, ev.usage);
        sess.models.add(ev.model);
        sess.days.add(day);
        d.sessionSet.add(sid);
        proj.sessionSet.add(sid);
      }
    }

    for (const m of f.userMessages) {
      if (m.sidechain) continue;
      if (seenUserMsg.has(m.uuid)) continue;
      seenUserMsg.add(m.uuid);

      const day = localDay(m.ts);
      const d = getDay(day);
      d.userMessages++;
      const hour = localHour(m.ts);
      d.hours[hour] = (d.hours[hour] ?? 0) + 1;

      let bp = d.byProject.get(f.project);
      if (!bp) {
        bp = { usage: emptyUsage(), userMessages: 0 };
        d.byProject.set(f.project, bp);
      }
      bp.userMessages++;

      const proj = getProject(f.project, day);
      proj.userMessages++;

      if (sess) {
        sess.userMessages++;
        sess.days.add(day);
        d.sessionSet.add(sid);
        proj.sessionSet.add(sid);
      }
    }
  }

  const dayKeys = [...days.keys()].sort();
  const totals = {
    sessions: sessions.size,
    activeDays: days.size,
    projects: projects.size,
    userMessages: 0,
    assistantMessages: 0,
    usage: emptyUsage(),
    sidechain: emptyUsage(),
  };

  const daysOut: Record<string, DayOut> = {};
  for (const day of dayKeys) {
    const d = days.get(day)!;
    totals.userMessages += d.userMessages;
    totals.assistantMessages += d.assistantMessages;
    addUsage(totals.usage, d.usage);
    addUsage(totals.sidechain, d.sidechain);
    daysOut[day] = {
      sessions: d.sessionSet.size,
      userMessages: d.userMessages,
      assistantMessages: d.assistantMessages,
      usage: d.usage,
      sidechain: d.sidechain,
      hours: d.hours,
      byProject: Object.fromEntries(d.byProject),
      byModel: Object.fromEntries(d.byModel),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    rangeStart: dayKeys[0] ?? null,
    rangeEnd: dayKeys[dayKeys.length - 1] ?? null,
    totals,
    days: daysOut,
    projects: Object.fromEntries(
      [...projects.entries()].map(([name, p]) => [
        name,
        {
          sessions: p.sessionSet.size,
          userMessages: p.userMessages,
          usage: p.usage,
          firstDay: p.firstDay,
          lastDay: p.lastDay,
        },
      ])
    ),
    models: Object.fromEntries(models),
    sessions: [...sessions.values()]
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((s) => ({
        id: s.id,
        project: s.project,
        start: s.start,
        end: s.end,
        title: s.title,
        userMessages: s.userMessages,
        usage: s.usage,
        models: [...s.models],
        days: [...s.days].sort(),
      })),
  };
}
