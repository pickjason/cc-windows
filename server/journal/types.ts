/** token 用量,四项分开统计,避免 cache 与真实输入混淆 */
export interface Usage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** 一次 API 请求的用量事件(同一 message.id 的多行已在解析时去重) */
export interface AssistantEvent {
  /** message.id:requestId,跨文件全局去重用(fork/resume 会复制历史行) */
  key: string;
  ts: string;
  model: string;
  sidechain: boolean;
  usage: Usage;
}

export interface UserMessage {
  uuid: string;
  ts: string;
  text: string;
  sidechain: boolean;
}

/** 单个 jsonl 文件的解析结果(缓存单元) */
export interface ParsedFile {
  file: string;
  sessionId: string | null;
  project: string;
  cwd: string | null;
  gitBranch: string | null;
  /** 首条用户消息带 [journal-summary] 标记 → 本工具自身产生的会话,统计时排除 */
  excluded: boolean;
  /** agent-*.jsonl 等子代理转录文件:用量计入但不算独立会话 */
  forceSidechain: boolean;
  firstTs: string | null;
  lastTs: string | null;
  firstUserMessage: string | null;
  userMessages: UserMessage[];
  events: AssistantEvent[];
}

export interface DayOut {
  sessions: number;
  userMessages: number;
  assistantMessages: number;
  usage: Usage;
  sidechain: Usage;
  hours: number[];
  byProject: Record<string, { usage: Usage; userMessages: number }>;
  byModel: Record<string, { usage: Usage; count: number }>;
}

export interface ProjectOut {
  sessions: number;
  userMessages: number;
  usage: Usage;
  firstDay: string;
  lastDay: string;
}

export interface ModelOut {
  count: number;
  usage: Usage;
}

export interface SessionOut {
  id: string;
  project: string;
  start: string;
  end: string;
  title: string | null;
  userMessages: number;
  usage: Usage;
  models: string[];
  days: string[];
}

export interface AggregateResult {
  generatedAt: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  totals: {
    sessions: number;
    activeDays: number;
    projects: number;
    userMessages: number;
    assistantMessages: number;
    usage: Usage;
    sidechain: Usage;
  };
  days: Record<string, DayOut>;
  projects: Record<string, ProjectOut>;
  models: Record<string, ModelOut>;
  sessions: SessionOut[];
}
