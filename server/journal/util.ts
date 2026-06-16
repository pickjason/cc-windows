import type { Usage } from "./types.js";

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

export function addUsage(target: Usage, src: Usage): void {
  target.input += src.input;
  target.output += src.output;
  target.cacheCreation += src.cacheCreation;
  target.cacheRead += src.cacheRead;
}

export function totalTokens(u: Usage): number {
  return u.input + u.output + u.cacheCreation + u.cacheRead;
}

/** UTC 时间戳 → 本地时区的 YYYY-MM-DD */
export function localDay(ts: string): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** UTC 时间戳 → 本地时区小时 0-23 */
export function localHour(ts: string): number {
  return new Date(ts).getHours();
}

export function localHm(ts: string): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function todayLocal(): string {
  return localDay(new Date().toISOString());
}

/** 1234567 → "1.23M" */
export function fmtTokens(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

export function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}
