#!/usr/bin/env node
// Copies the web static export (apps/web/out) into dist/web for the published
// gateway, skipping assets that must never ship. Cross-platform replacement for
// `rm -rf dist/web && cp -r ../web/out dist/web`.
import { cpSync, existsSync, rmSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "web", "out");
const dest = join(here, "..", "dist", "web");
const UNSHIPPABLE = new Set(["Office Tileset", "offices"]);

if (!existsSync(src)) {
  console.error(`[copy-web] ${src} not found. Build the web app first: pnpm --filter web build`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, {
  recursive: true,
  filter: (p) => {
    const top = relative(src, p).split(sep)[0];
    if (UNSHIPPABLE.has(top)) {
      console.log(`[copy-web] skipping unshippable asset: ${basename(p)}`);
      return false;
    }
    return true;
  },
});
console.log(`[copy-web] ${src} -> ${dest}`);
