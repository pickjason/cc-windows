const SGR_MOUSE_RE = /\x1b\[<(\d+);\d+;\d+[mM]/g;
const X10_MOUSE_PREFIX = "\x1b[M";
const WHEEL_BUTTON_MIN = 64;
const WHEEL_BUTTON_MAX = 67;
const X10_BUTTON_OFFSET = 32;

function isWheelButton(button: number): boolean {
  return button >= WHEEL_BUTTON_MIN && button <= WHEEL_BUTTON_MAX;
}

export function stripMouseWheelInput(data: string): string {
  const withoutSgr = data.replace(SGR_MOUSE_RE, (seq, button: string) =>
    isWheelButton(Number(button)) ? "" : seq,
  );

  let out = "";
  for (let i = 0; i < withoutSgr.length; i += 1) {
    if (withoutSgr.startsWith(X10_MOUSE_PREFIX, i) && i + 5 < withoutSgr.length) {
      const button = withoutSgr.charCodeAt(i + 3) - X10_BUTTON_OFFSET;
      if (isWheelButton(button)) {
        i += 5;
        continue;
      }
    }
    out += withoutSgr[i];
  }
  return out;
}
