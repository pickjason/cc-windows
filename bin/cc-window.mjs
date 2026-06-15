#!/usr/bin/env node
// cc-window CLI 入口(npx cc-window / 全局安装后 cc-window)。
//   cc-window                 启动看板(默认 http://127.0.0.1:4317)
//   cc-window install-hooks   安装监控 hooks(透传 --dry-run / --uninstall)
//   cc-window --help
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const [, , cmd, ...rest] = process.argv;

function run(file, args) {
  const child = spawn(file, args, { stdio: "inherit", env: process.env, cwd: root });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", (err) => {
    console.error(`[cc-window] 无法执行 ${file}: ${err.message}`);
    process.exit(1);
  });
}

if (cmd === "install-hooks") {
  run("bash", [path.join(root, "scripts", "install-hooks.sh"), ...rest]);
} else if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  console.log(`cc-window — local web dashboard for Claude Code

Usage:
  cc-window                 start the dashboard (default http://127.0.0.1:4317)
  cc-window install-hooks   install monitoring hooks into ~/.claude/settings.json
                            (flags: --dry-run preview, --uninstall revert)

Env overrides: CC_PORT / PORT, CC_HOST, CC_TMUX_SOCKET`);
  process.exit(0);
} else {
  // 用包内自带的 tsx 直接跑 TS 服务端(tsx 已列为 runtime 依赖)
  const tsxBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  run(tsxBin, [path.join(root, "server", "index.ts")]);
}
