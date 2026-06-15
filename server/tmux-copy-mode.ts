export function isPaneInCopyMode(value: string): boolean {
  return value.trim() === "1";
}

export function cancelCopyModeArgs(tx: string[], tmuxName: string): string[] {
  return [...tx, "send-keys", "-t", tmuxName, "-X", "cancel"];
}
