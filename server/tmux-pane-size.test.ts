import assert from "node:assert/strict";
import { parsePaneSize } from "./tmux-pane-size";

assert.deepEqual(parsePaneSize("227 27\n"), { cols: 227, rows: 27 });
assert.deepEqual(parsePaneSize("80x24"), { cols: 80, rows: 24 });
assert.equal(parsePaneSize("x"), null);
assert.equal(parsePaneSize("0 24"), null);
assert.equal(parsePaneSize("120 0"), null);

console.log("tmux-pane-size tests passed");
