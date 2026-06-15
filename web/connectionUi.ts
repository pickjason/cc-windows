export function shouldReattachTerminal(connected: boolean): boolean {
  return connected;
}

export function shouldShowConnectingEmpty(connected: boolean, sessionCount: number): boolean {
  return !connected && sessionCount === 0;
}
