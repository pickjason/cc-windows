import assert from "node:assert/strict";
import { normalizeTerminalSize, terminalSizeChanged } from "./terminalResize";

assert.deepEqual(normalizeTerminalSize({ cols: 10525, rows: 200 }), { cols: 300, rows: 120 });
assert.deepEqual(normalizeTerminalSize({ cols: 10, rows: 2 }), { cols: 20, rows: 5 });
assert.equal(terminalSizeChanged(null, { cols: 192, rows: 35 }), true);
assert.equal(terminalSizeChanged({ cols: 192, rows: 35 }, { cols: 192, rows: 35 }), false);
assert.equal(terminalSizeChanged({ cols: 192, rows: 35 }, { cols: 193, rows: 35 }), true);

console.log("terminalResize tests passed");
