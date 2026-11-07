#!/usr/bin/env node
// `pnpm dev`: gateway + web dev server side by side, on every OS (no shell `&`).
// Ctrl+C stops both; if either exits, the other is stopped too.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const pnpm = isWindows ? "pnpm.cmd" : "pnpm";
const children = [
  ["pixel-crew", ["--filter", "pixel-crew", "dev"]],
  ["web", ["--filter", "web", "dev"]],
].map(([name, args]) => {
  // pnpm is a .cmd shim on Windows, which needs a shell; the arguments are fixed strings
  const child = spawn(pnpm, args, { stdio: "inherit", shell: isWindows });
  child.on("exit", (code) => {
    console.log(`[dev] ${name} exited (${code ?? "signal"})`);
    stopAll();
    process.exitCode = code ?? 1;
  });
  return child;
});

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill("SIGTERM");
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
