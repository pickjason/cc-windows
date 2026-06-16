import assert from "node:assert/strict";
import { tmuxBaseOptionArgs } from "./tmux-options";

assert.deepEqual(tmuxBaseOptionArgs(["-L", "ccwindow"]), [
  ["-L", "ccwindow", "set-option", "-g", "mouse", "off"],
  ["-L", "ccwindow", "set-option", "-g", "status", "off"],
]);

console.log("tmux-options tests passed");
