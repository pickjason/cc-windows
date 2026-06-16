export function tmuxBaseOptionArgs(tx: string[]): string[][] {
  return [
    [...tx, "set-option", "-g", "mouse", "off"],
    [...tx, "set-option", "-g", "status", "off"],
  ];
}
