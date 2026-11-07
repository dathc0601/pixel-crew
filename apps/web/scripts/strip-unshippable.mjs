#!/usr/bin/env node
// Removes assets that must never ship from the static export (apps/web/out).
// Next.js copies everything in public/ into out/, so a locally installed paid
// tileset or the quarantined themes would otherwise end up in releases.
// See THIRD_PARTY_NOTICES.md and apps/web/assets-quarantine/README.md.
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const UNSHIPPABLE = ["Office Tileset", "offices"];

export function stripUnshippable(outDir) {
  const removed = [];
  for (const name of UNSHIPPABLE) {
    const p = join(outDir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outDir = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "out");
  const removed = stripUnshippable(outDir);
  if (removed.length) console.log(`[strip-unshippable] removed from ${outDir}: ${removed.join(", ")}`);
}
