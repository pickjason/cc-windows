export type HandoffMode = "interactive" | "readonly";

export function initialModeForDiscoveredSession(clientCount: number): HandoffMode {
  return clientCount > 0 ? "readonly" : "interactive";
}

export function shouldUseReadonlyForWebAttach(
  mode: HandoffMode,
  hasAttachPty: boolean,
  clientCount: number,
): boolean {
  return mode === "interactive" && !hasAttachPty && clientCount > 0;
}
