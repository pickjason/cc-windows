export type TerminalSize = {
  cols: number;
  rows: number;
};

const MIN_COLS = 20;
const MAX_COLS = 300;
const MIN_ROWS = 5;
const MAX_ROWS = 120;

function clampDimension(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function normalizeTerminalSize(size: TerminalSize): TerminalSize {
  return {
    cols: clampDimension(size.cols, MIN_COLS, MAX_COLS),
    rows: clampDimension(size.rows, MIN_ROWS, MAX_ROWS),
  };
}

export function terminalSizeChanged(last: TerminalSize | null, next: TerminalSize): boolean {
  return !last || last.cols !== next.cols || last.rows !== next.rows;
}
