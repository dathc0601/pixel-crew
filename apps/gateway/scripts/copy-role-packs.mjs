#!/usr/bin/env node
// Ships the bundled role packs next to the bundle (dist/agents/), where the orchestrator's
// getBundledAgentsDir() looks first. Without them the built gateway has no packs to pass
// with --agents and the legacy ~/.claude/agents cleanup cannot recognise our old copies.
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "..", "packages", "orchestrator", "agents");
const dest = join(here, "..", "dist", "agents");
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith(".md"));
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log(`[copy-role-packs] ${files.length} role packs ${src} -> ${dest}`);
