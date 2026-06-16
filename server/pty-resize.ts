export interface PtySize {
  cols: number;
  rows: number;
}

export function shouldApplyPtyResize(current: PtySize | null, next: PtySize): boolean {
  return current == null || current.cols !== next.cols || current.rows !== next.rows;
}
