import assert from "node:assert/strict";
import { shouldReattachTerminal, shouldShowConnectingEmpty } from "./connectionUi";

assert.equal(shouldReattachTerminal(false), false);
assert.equal(shouldReattachTerminal(true), true);

assert.equal(shouldShowConnectingEmpty(false, 0), true);
assert.equal(shouldShowConnectingEmpty(false, 2), false);
assert.equal(shouldShowConnectingEmpty(true, 0), false);

console.log("connectionUi tests passed");
