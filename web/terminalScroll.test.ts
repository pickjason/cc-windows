import assert from "node:assert/strict";
import { isAtScrollBottom, wheelDeltaToScrollLines } from "./terminalScroll";

assert.equal(wheelDeltaToScrollLines(-120, 20), -6);
assert.equal(wheelDeltaToScrollLines(120, 20), 6);
assert.equal(wheelDeltaToScrollLines(-1, 20), -1);
assert.equal(wheelDeltaToScrollLines(0, 20), 0);
assert.equal(wheelDeltaToScrollLines(Number.NaN, 20), 0);

assert.equal(isAtScrollBottom({ scrollTop: 280, scrollHeight: 500, clientHeight: 220 }), true);
assert.equal(isAtScrollBottom({ scrollTop: 260, scrollHeight: 500, clientHeight: 220 }), false);

console.log("terminalScroll tests passed");
