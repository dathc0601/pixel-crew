#!/usr/bin/env node
// Tauri beforeDevCommand: runs the gateway (dev, port 9099) and the Next.js dev server
// side by side, and stops both when Tauri stops this script. Replaces
// `pnpm --filter pixel-crew dev & pnpm --filter web dev`, which needs a POSIX shell.
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const isWindows = process.platform === "win32";

const children = [
  // Same as the gateway's `dev` script, with the env set here instead of in shell syntax
  { name: "gateway", args: ["--filter", "pixel-crew", "exec", "tsx", "watch", "src/index.ts"], env: { NODE_ENV: "development", WS_PORT: "9099" } },
  { name: "web", args: ["--filter", "web", "dev"], env: {} },
].map(({ name, args, env }) => {
  // pnpm is a .cmd shim on Windows, which Node only starts through a shell (fixed arguments here)
  const child = spawn("pnpm", args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    detached: !isWindows, // own process group, so the whole tree can be stopped
    env: { ...process.env, ...env },
  });
  child.on("exit", (code, signal) => {
    console.log(`[dev-servers] ${name} exited (${code ?? signal})`);
    stopAll(code ?? 1);
  });
  return child;
});

let stopping = false;
function stopAll(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    try {
      if (isWindows) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      else process.kill(-child.pid, "SIGTERM");
    } catch { /* already gone */ }
  }
  process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => stopAll(0));
