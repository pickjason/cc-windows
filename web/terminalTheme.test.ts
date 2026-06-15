import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./TerminalPane.tsx", import.meta.url), "utf8");

function themeColor(name: string): string {
  const match = source.match(new RegExp(`\\b${name}:\\s*"(#[0-9a-fA-F]{6})"`));
  const color = match?.[1];
  assert.ok(color, `XTERM_THEME should define ${name}`);
  return color;
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  assert.ok(match, `invalid hex color ${hex}`);
  const channels: [number, number, number] = [
    parseInt(match[1]!, 16) / 255,
    parseInt(match[2]!, 16) / 255,
    parseInt(match[3]!, 16) / 255,
  ];
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const background = themeColor("background");

assert.ok(
  contrastRatio(themeColor("red"), background) <= 4.5,
  "ANSI red should stay muted enough for full-line diff backgrounds",
);
assert.ok(
  contrastRatio(themeColor("green"), background) <= 4.5,
  "ANSI green should stay muted enough for full-line diff backgrounds",
);
assert.ok(
  contrastRatio(themeColor("brightRed"), background) <= 6,
  "bright ANSI red should be explicit and not fall back to a vivid xterm default",
);
assert.ok(
  contrastRatio(themeColor("brightGreen"), background) <= 6,
  "bright ANSI green should be explicit and not fall back to a vivid xterm default",
);
