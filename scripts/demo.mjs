#!/usr/bin/env node
// `pnpm demo`: the whole office with scripted fake agents. No AI CLI, no tokens.
// Builds the web UI when it is missing or older than its sources, then starts the gateway
// in demo mode; the gateway serves the UI and opens it at http://localhost:9090.
// Extra arguments go to the gateway (e.g. `pnpm demo --lan`). `--rebuild` forces a web build.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const args = process.argv.slice(2);
const forceBuild = args.includes("--rebuild");
const gatewayArgs = args.filter((a) => a !== "--rebuild" && a !== "--demo");

/** Newest modification time of a file or of anything under a directory (0 if missing). */
function newestMtime(dir) {
  if (!existsSync(dir)) return 0;
  if (!statSync(dir).isDirectory()) return statSync(dir).mtimeMs;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const p = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

const builtIndex = join(root, "apps", "web", "out", "index.html");
// The root package.json carries the version shown in the UI
const sources = ["apps/web/src", "apps/web/public", "packages/shared/src", "apps/web/next.config.ts", "package.json"].map((d) => join(root, d));
const builtAt = existsSync(builtIndex) ? statSync(builtIndex).mtimeMs : 0;
const stale = forceBuild || builtAt === 0 || sources.some((d) => newestMtime(d) > builtAt);

// pnpm is a .cmd shim on Windows, which needs a shell; the arguments are fixed strings
if (stale) {
  console.log("[demo] Building the web UI (first run or sources changed)...");
  const res = spawnSync(pnpm, ["--filter", "web", "build"], { cwd: root, stdio: "inherit", shell: isWindows });
  if (res.status !== 0) process.exit(res.status ?? 1);
} else {
  console.log("[demo] Web UI is up to date (pass --rebuild to build it anyway).");
}

if (isWindows && !gatewayArgs.every((a) => /^[\w.:=/-]+$/.test(a))) {
  console.error("[demo] Gateway arguments may only contain letters, digits and . : = / - on Windows.");
  process.exit(1);
}
const child = spawn(pnpm, ["--filter", "pixel-crew", "demo", ...gatewayArgs], { cwd: root, stdio: "inherit", shell: isWindows });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
