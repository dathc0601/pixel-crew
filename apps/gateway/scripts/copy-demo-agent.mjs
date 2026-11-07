#!/usr/bin/env node
// Ships the scripted fake agent next to the bundle so `pixel-crew --demo` works from
// the published package (demo-mode.ts looks for dist/fake-agent.mjs first).
import { copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// fake-claude-session.mjs is demo mode's simulated external Claude session (attach flow)
for (const name of ["fake-agent.mjs", "fake-claude-session.mjs"]) {
  const src = join(here, "..", "..", "..", "packages", "orchestrator", "fake-agent", name);
  const dest = join(here, "..", "dist", name);
  copyFileSync(src, dest);
  console.log(`[copy-demo-agent] ${src} -> ${dest}`);
}
