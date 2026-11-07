/**
 * Demo mode: every agent (the Lead too) is the scripted fake backend, so the whole
 * Boss → Lead → Dev flow can be watched without any AI CLI and without spending tokens.
 *
 * Imported by index.ts right after root-guard, before config.ts resolves the data dir.
 *
 * It can only be turned on explicitly, per run: `--demo` on the command line or
 * PIXEL_CREW_DEMO=1 in the environment. Nothing in config.json enables it. Unless
 * PIXEL_CREW_HOME is set, demo runs use their own data dir (~/.pixel-crew-demo), so
 * demo teams and work items never mix with a real office.
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

export const DEMO_BACKEND_ID = "demo";

/** True only for an explicit `--demo` flag or PIXEL_CREW_DEMO=1 (no other value counts). */
export function isDemoRequested(argv: readonly string[], env: NodeJS.ProcessEnv): boolean {
  return argv.includes("--demo") || env.PIXEL_CREW_DEMO === "1";
}

export const DEMO_MODE = isDemoRequested(process.argv, process.env);

if (DEMO_MODE) {
  if (!process.env.PIXEL_CREW_HOME) process.env.PIXEL_CREW_HOME = join(homedir(), ".pixel-crew-demo");
  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────┐");
  console.log("  │  DEMO MODE: every agent is a scripted fake. No AI CLI    │");
  console.log("  │  runs and no tokens are spent.                           │");
  console.log("  └──────────────────────────────────────────────────────────┘");
  console.log(`  Data dir: ${process.env.PIXEL_CREW_HOME}`);
  console.log("");
}

interface DemoRule {
  match: string;
  text?: string | string[];
  delayMs?: number;
  jitterMs?: number;
}

/**
 * The script every demo agent follows (fake-agent.mjs; first matching rule wins).
 * The Lead splits each Boss task into three TASK: lines, so with two devs the
 * third one waits on the task board. Devs "work" for a few seconds.
 */
export const DEMO_SCENARIO: { rules: DemoRule[]; default: Omit<DemoRule, "match"> } = {
  rules: [
    // Lead doing a queued sub-task itself (lead.selfWork policy)
    { match: "doing this task yourself", text: ["STATUS: done", "SUMMARY: (demo) The Lead finished this one personally."], delayMs: 3500, jitterMs: 1500 },
    // Lead reading results: no new delegation, so the Boss task finishes when the pool is empty
    { match: "New result from", text: "FINAL SUMMARY: (demo) The team delivered every part of the Boss's task.", delayMs: 1200 },
    // Lead receiving a Boss task
    {
      match: "The Boss assigned you a task",
      text: [
        "Got it, Boss. I'll split this into three parts:",
        "TASK[ui]: Sketch the screens and layout",
        "TASK: Build the core feature",
        "TASK: Write tests and polish the details",
      ],
      delayMs: 1500,
    },
    // Reviewer
    { match: "VERDICT", text: ["VERDICT: PASS", "SUMMARY: (demo) Reviewed, looks good."], delayMs: 3000 },
    // Developers (first run: "Your name is …"; resumed runs: "[Assigned by …]")
    { match: "Your name is|Assigned by", text: ["STATUS: done", "SUMMARY: (demo) Finished my part."], delayMs: 5000, jitterMs: 3000 },
  ],
  default: { text: "(demo) I am a scripted demo agent. Click the Boss to assign the team a task.", delayMs: 800 },
};

/** fake-agent.mjs: next to the bundle in dist/, or in the orchestrator package when running from source. */
export function resolveDemoAgentScript(fallback: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "fake-agent.mjs"), fallback]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Demo mode: fake-agent.mjs not found (looked in ${here} and ${fallback})`);
}

/** Write the demo scenario into the data dir and return its path. */
export function writeDemoScenario(dataDir: string): string {
  const file = resolve(dataDir, "demo-scenario.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(DEMO_SCENARIO, null, 2));
  return file;
}
