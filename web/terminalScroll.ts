export type ScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export const INTERACTIVE_SCROLLBACK_LINES = 5000;
export const READONLY_SCROLLBACK_LINES = 0;

export function wheelDeltaToScrollLines(deltaY: number, rowHeight: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 0;
  const safeRowHeight = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : 18;
  const lines = Math.max(1, Math.ceil(Math.abs(deltaY) / safeRowHeight));
  return deltaY > 0 ? lines : -lines;
}

export function isAtScrollBottom(metrics: ScrollMetrics, tolerance = 4): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= tolerance;
}
