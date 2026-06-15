import assert from "node:assert/strict";
import { stripMouseWheelInput } from "./terminalInput";

assert.equal(stripMouseWheelInput("\x1b[<64;10;20M"), "");
assert.equal(stripMouseWheelInput("\x1b[<65;10;20M"), "");
assert.equal(stripMouseWheelInput(`a\x1b[<64;10;20Mb`), "ab");
assert.equal(stripMouseWheelInput("\x1b[<0;10;20M"), "\x1b[<0;10;20M");
assert.equal(stripMouseWheelInput("\x1b[M`!!"), "");
assert.equal(stripMouseWheelInput("\x1b[Ma!!"), "");
assert.equal(stripMouseWheelInput("hello"), "hello");

console.log("terminalInput tests passed");
