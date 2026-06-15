#!/usr/bin/env node
// cc-window CLI 入口(npx cc-window / 全局安装后 cc-window)。
//   cc-window                 启动看板(默认 http://127.0.0.1:4317)
//   cc-window install-hooks   安装监控 hooks(透传 --dry-run / --uninstall)
//   cc-window --help
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
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
  // 用 tsx 直接跑 TS 服务端(tsx 是 runtime 依赖)。
  // 注意:npm/npx 安装会把 tsx 提升(hoist)到顶层 node_modules,包内
  // node_modules/.bin/tsx 并不存在 —— 必须按 Node 模块解析定位(会向上查找),
  // 再用 node 跑它的 cli,跨平台且不依赖 .bin/.cmd 布局。
  const require = createRequire(import.meta.url);
  const tsxPkgPath = require.resolve("tsx/package.json");
  const binField = JSON.parse(fs.readFileSync(tsxPkgPath, "utf8")).bin;
  const binRel = typeof binField === "string" ? binField : binField.tsx;
  const tsxCli = path.join(path.dirname(tsxPkgPath), binRel);
  run(process.execPath, [tsxCli, path.join(root, "server", "index.ts")]);
}
