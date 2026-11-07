#!/usr/bin/env node
// Runs the local Tauri CLI with ~/.cargo/bin on PATH (rustup installs cargo there, and a
// fresh terminal may not have sourced ~/.cargo/env yet). Usage: node scripts/tauri.mjs <args>
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const cargoBin = join(process.env.CARGO_HOME || join(homedir(), ".cargo"), "bin");
const env = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
if (existsSync(cargoBin) && !(env[pathKey] ?? "").split(delimiter).includes(cargoBin)) {
  env[pathKey] = [cargoBin, env[pathKey]].filter(Boolean).join(delimiter);
}

const require = createRequire(join(desktop, "package.json"));
const cli = join(dirname(require.resolve("@tauri-apps/cli/package.json")), "tauri.js");
const res = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: desktop, stdio: "inherit", env });
process.exit(res.status ?? 1);
