#!/usr/bin/env node
// Ships the scripted fake agent next to the bundle so `pixel-crew --demo` works from
// the published package (demo-mode.ts looks for dist/fake-agent.mjs first).
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "packages", "orchestrator", "fake-agent", "fake-agent.mjs");
const dest = join(here, "..", "dist", "fake-agent.mjs");
copyFileSync(src, dest);
console.log(`[copy-demo-agent] ${src} -> ${dest}`);
