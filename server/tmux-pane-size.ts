export interface PaneSize {
  cols: number;
  rows: number;
}

export function parsePaneSize(value: string): PaneSize | null {
  const match = value.trim().match(/^(\d+)(?:x|\s+)(\d+)$/);
  if (!match) return null;
  const cols = Number(match[1]);
  const rows = Number(match[2]);
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return null;
  return { cols, rows };
}
