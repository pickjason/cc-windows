import assert from "node:assert/strict";
import { cancelCopyModeArgs, isPaneInCopyMode } from "./tmux-copy-mode";

assert.equal(isPaneInCopyMode("1\n"), true);
assert.equal(isPaneInCopyMode("0\n"), false);
assert.equal(isPaneInCopyMode(""), false);
assert.deepEqual(cancelCopyModeArgs(["-L", "ccwindow"], "ccw_test"), [
  "-L",
  "ccwindow",
  "send-keys",
  "-t",
  "ccw_test",
  "-X",
  "cancel",
]);

console.log("tmux-copy-mode tests passed");
