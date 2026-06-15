// 状态配置 + 派生 helper —— 对应设计交接 data.jsx(去掉 SEED/MODELS 假数据)。
// 状态枚举/语义/排序权重是契约(见 docs/04、docs/09),仅视觉可改。
import type { SessionStatus, SessionView } from "../server/types";

export interface StatusMeta {
  label: string;
  color: string;
  pulse: boolean;
  weight: number;
  glyph: string;
}

export const STATUS: Record<SessionStatus, StatusMeta> = {
  WAITING_PERMISSION: { label: "等授权", color: "#ef4444", pulse: false, weight: 0, glyph: "‼" },
  WAITING_INPUT: { label: "等输入", color: "#f59e0b", pulse: false, weight: 1, glyph: "?" },
  WORKING: { label: "干活中", color: "#3b82f6", pulse: true, weight: 2, glyph: "▸" },
  DONE: { label: "刚完成", color: "#22c55e", pulse: false, weight: 3, glyph: "✓" },
  IDLE: { label: "空闲", color: "#6b7280", pulse: false, weight: 4, glyph: "·" },
  ERROR: { label: "错误", color: "#dc2626", pulse: false, weight: 5, glyph: "×" },
  CLOSED: { label: "关闭", color: "#374151", pulse: false, weight: 6, glyph: "■" },
};

/** 待处理语义:等授权 + 等输入。 */
export const NEEDS_ME: SessionStatus[] = ["WAITING_PERMISSION", "WAITING_INPUT"];

/** 年龄格式: <60s→Ns; <60m→Nm; <48h→Nh; 否则 Nd。 */
export function fmtAge(ms: number, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 48) return h + "h";
  return Math.floor(h / 24) + "d";
}

/** token 格式: ≥1000→Nk(≥10000 取整)。 */
export function fmtTokens(n?: number): string {
  if (n == null) return "";
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (n >= 10000 ? Math.round(k) : Number(k.toFixed(1))) + "k";
}

/** 排序: 状态权重升序, 同权重 lastActivityTs 倒序。 */
export function sortSessions(list: SessionView[]): SessionView[] {
  return [...list].sort((a, b) => {
    const wa = STATUS[a.status].weight;
    const wb = STATUS[b.status].weight;
    if (wa !== wb) return wa - wb;
    return b.lastActivityTs - a.lastActivityTs;
  });
}

/** Dock 标签名:name → projectName → sid 前 8。 */
export function displayName(s: SessionView): string {
  return s.name || s.projectName || s.sessionId.slice(0, 8);
}
