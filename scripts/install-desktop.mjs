#!/usr/bin/env node
// `pnpm build:desktop`: bumps the patch version, builds the desktop app for this OS and,
// on macOS, installs it into /Applications. Cross-platform replacement for the old
// install-desktop.sh. Pass --no-bump to keep the version, --no-install to only build.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriConfPath = join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
const rootPkgPath = join(root, "package.json");
const args = new Set(process.argv.slice(2));

const readJson = (p) => JSON.parse(readFileSync(p, "utf-8"));
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");

const tauriConf = readJson(tauriConfPath);
const appName = tauriConf.productName;
if (!appName) {
  console.error(`Could not read productName from ${tauriConfPath}`);
  process.exit(1);
}

// Auto-increment the patch version in tauri.conf.json and the root package.json (the UI reads the root one)
if (!args.has("--no-bump")) {
  const [major, minor, patch] = String(tauriConf.version).split(".").map((n) => Number(n) || 0);
  const next = `${major}.${minor}.${patch + 1}`;
  tauriConf.version = next;
  writeJson(tauriConfPath, tauriConf);
  const rootPkg = readJson(rootPkgPath);
  rootPkg.version = next;
  writeJson(rootPkgPath, rootPkg);
  console.log(`Building ${appName} v${next}...`);
} else {
  console.log(`Building ${appName} v${tauriConf.version}...`);
}

const res = spawnSync("pnpm", ["--filter", "pixel-crew-desktop", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32", // pnpm is a .cmd shim on Windows (fixed arguments)
});
if (res.status !== 0) process.exit(res.status || 1);

const bundleRoot = join(root, "apps", "desktop", "src-tauri", "target", "release", "bundle");
if (process.platform !== "darwin" || args.has("--no-install")) {
  console.log(`Installers are in ${bundleRoot}`);
  process.exit(0);
}

const bundleDir = join(bundleRoot, "macos");
const appPath = join(bundleDir, `${appName}.app`);
if (!existsSync(appPath)) {
  console.error(`Build output not found: ${appPath}`);
  process.exit(1);
}

// Remove apps left in /Applications by earlier product names
const oldNames = new Set(["Bit Office", "Open Office"]);
for (const entry of readdirSync(bundleDir)) {
  if (entry.endsWith(".app")) oldNames.add(basename(entry, ".app"));
}
oldNames.delete(appName);
for (const name of oldNames) {
  const old = join("/Applications", `${name}.app`);
  if (existsSync(old)) {
    console.log(`Removing old app: ${old}`);
    rmSync(old, { recursive: true, force: true });
  }
}

const target = join("/Applications", `${appName}.app`);
rmSync(target, { recursive: true, force: true });
cpSync(appPath, target, { recursive: true, verbatimSymlinks: true });
console.log(`Installed to ${target}`);
