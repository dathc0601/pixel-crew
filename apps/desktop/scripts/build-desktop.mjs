#!/usr/bin/env node
// Tauri beforeBuildCommand: builds the web UI and the standalone gateway bundle, then
// fills src-tauri/sidecar/ (bundled as an app resource). Cross-platform replacement
// for the old build-desktop.sh.
//
// Node.js is NOT bundled by default: the app runs the gateway on the user's Node.js 22+.
// PIXEL_CREW_BUNDLE_NODE=1 copies the current Node binary into the bundle as a fallback
// for machines without Node (adds roughly 60-120 MB depending on the platform).
// --skip-build reuses the existing apps/gateway/dist (build it with BUNDLE_ALL=1 first).
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, statSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, "..");
const root = join(desktop, "..", "..");
const gatewayDist = join(root, "apps", "gateway", "dist");
const sidecar = join(desktop, "src-tauri", "sidecar");
const isWindows = process.platform === "win32";
const bundleNode = process.env.PIXEL_CREW_BUNDLE_NODE === "1";
const skipBuild = process.argv.includes("--skip-build");

function run(args, env = {}) {
  console.log(`> pnpm ${args.join(" ")}`);
  // pnpm is a .cmd shim on Windows, which Node only starts through a shell (fixed arguments here)
  const res = spawnSync("pnpm", args, { cwd: root, stdio: "inherit", shell: isWindows, env: { ...process.env, ...env } });
  if (res.status !== 0) {
    console.error(`[build-desktop] pnpm ${args.join(" ")} failed (exit ${res.status ?? res.signal})`);
    process.exit(res.status || 1);
  }
}

function dirSize(p) {
  const s = statSync(p);
  if (!s.isDirectory()) return s.size;
  return readdirSync(p).reduce((sum, name) => sum + dirSize(join(p, name)), 0);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

console.log("=== Building Pixel Crew Desktop ===");

if (skipBuild) {
  console.log("[1-2/3] Skipping the web and gateway builds (--skip-build)");
} else {
  console.log("[1/3] Building web...");
  run(["--filter", "web", "build"]);

  console.log("[2/3] Building gateway (standalone, all dependencies bundled)...");
  run(["--filter", "pixel-crew", "build"], { BUNDLE_ALL: "1" });
}
if (!existsSync(join(gatewayDist, "index.js")) || !existsSync(join(gatewayDist, "web"))) {
  console.error(`[build-desktop] ${gatewayDist} is incomplete: run without --skip-build`);
  process.exit(1);
}

console.log("[3/3] Preparing sidecar...");
rmSync(sidecar, { recursive: true, force: true });
mkdirSync(sidecar, { recursive: true });
copyFileSync(join(gatewayDist, "index.js"), join(sidecar, "gateway.js"));
// Demo mode looks for the scripted fake agent next to the bundle
if (existsSync(join(gatewayDist, "fake-agent.mjs"))) {
  copyFileSync(join(gatewayDist, "fake-agent.mjs"), join(sidecar, "fake-agent.mjs"));
}
// dist/web is the web export minus assets that must never ship (scripts/copy-web.mjs)
cpSync(join(gatewayDist, "web"), join(sidecar, "web"), { recursive: true });

if (bundleNode) {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    console.error(`[build-desktop] PIXEL_CREW_BUNDLE_NODE=1 needs Node.js 22+ to copy (this is ${process.version})`);
    process.exit(1);
  }
  const target = join(sidecar, isWindows ? "node.exe" : "node");
  copyFileSync(process.execPath, target);
  console.log(`[build-desktop] Bundled Node.js ${process.version} (${mb(statSync(target).size)}) as the fallback runtime`);
} else {
  console.log("[build-desktop] Node.js not bundled: the app uses the system Node.js 22+ (PIXEL_CREW_BUNDLE_NODE=1 bundles it)");
}

console.log(`=== Sidecar ready: ${sidecar} (${mb(dirSize(sidecar))}) ===`);
for (const name of readdirSync(sidecar)) {
  console.log(`  ${name}  ${mb(dirSize(join(sidecar, name)))}`);
}
