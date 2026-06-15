import assert from "node:assert/strict";
import { initialModeForDiscoveredSession, shouldUseReadonlyForWebAttach } from "./tmux-handoff";

assert.equal(initialModeForDiscoveredSession(0), "interactive");
assert.equal(initialModeForDiscoveredSession(1), "readonly");
assert.equal(initialModeForDiscoveredSession(2), "readonly");

assert.equal(shouldUseReadonlyForWebAttach("interactive", false, 1), true);
assert.equal(shouldUseReadonlyForWebAttach("interactive", false, 0), false);
assert.equal(shouldUseReadonlyForWebAttach("interactive", true, 2), false);
assert.equal(shouldUseReadonlyForWebAttach("readonly", false, 1), false);

console.log("tmux-handoff tests passed");
