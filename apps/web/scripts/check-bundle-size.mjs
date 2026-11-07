#!/usr/bin/env node
// CI size gate (plan P4.3): fails when a route's first-load JS grows more than the
// tolerance over the committed budget in perf-budget.json. Run after `next build`.
// Sizes are gzip, in kB of 1000 bytes, computed like Next's "First Load JS" column
// (root main files + the page's chunks), plus the root layout's chunks separately.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

/** Compare measured sizes with budgets. Returns one line per check and whether all passed. */
export function evaluateBudget(budget, measured) {
  const tolerance = budget.tolerance ?? 0.05;
  const lines = [];
  let ok = true;
  for (const [route, limits] of Object.entries(budget.routes)) {
    const m = measured[route];
    if (!m) {
      lines.push(`FAIL ${route}: no build output for this route`);
      ok = false;
      continue;
    }
    for (const key of ["firstLoadKb", "withLayoutKb"]) {
      if (limits[key] === undefined) continue;
      const max = limits[key] * (1 + tolerance);
      const pass = m[key] <= max;
      if (!pass) ok = false;
      lines.push(`${pass ? "ok  " : "FAIL"} ${route} ${key}: ${m[key].toFixed(1)} kB (budget ${limits[key]} kB, max ${max.toFixed(1)} kB)`);
    }
  }
  return { ok, lines };
}

/** Measure routes from a Next build directory (.next). */
export function measureRoutes(nextDir, routes) {
  const app = JSON.parse(readFileSync(join(nextDir, "app-build-manifest.json"), "utf8")).pages;
  const build = JSON.parse(readFileSync(join(nextDir, "build-manifest.json"), "utf8"));
  const gz = new Map();
  const size = (f) => {
    if (!gz.has(f)) gz.set(f, gzipSync(readFileSync(join(nextDir, f))).length);
    return gz.get(f);
  };
  const sum = (files) => [...new Set(files)].filter((f) => f.endsWith(".js")).reduce((t, f) => t + size(f), 0) / 1000;
  const out = {};
  for (const route of routes) {
    const page = app[`${route === "/" ? "" : route}/page`];
    if (!page) continue;
    const first = [...(build.rootMainFiles ?? []), ...page];
    out[route] = { firstLoadKb: sum(first), withLayoutKb: sum([...first, ...(app["/layout"] ?? [])]) };
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const budget = JSON.parse(readFileSync(join(webDir, "perf-budget.json"), "utf8"));
  const measured = measureRoutes(join(webDir, ".next"), Object.keys(budget.routes));
  const { ok, lines } = evaluateBudget(budget, measured);
  for (const l of lines) console.log(`[size-gate] ${l}`);
  if (!ok) {
    console.error("[size-gate] First-load JS is over budget. Lazy-load the new code, or raise apps/web/perf-budget.json in the same PR with a reason.");
    process.exit(1);
  }
}
