import assert from "node:assert/strict";
import { shouldApplyPtyResize } from "./pty-resize";

assert.equal(shouldApplyPtyResize(null, { cols: 120, rows: 30 }), true);
assert.equal(shouldApplyPtyResize({ cols: 120, rows: 30 }, { cols: 120, rows: 30 }), false);
assert.equal(shouldApplyPtyResize({ cols: 119, rows: 30 }, { cols: 120, rows: 30 }), true);
assert.equal(shouldApplyPtyResize({ cols: 120, rows: 29 }, { cols: 120, rows: 30 }), true);

console.log("pty-resize tests passed");
