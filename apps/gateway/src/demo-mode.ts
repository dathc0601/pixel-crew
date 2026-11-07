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
 * The team demo mode hires into an empty office (agent definition ids from
 * DEFAULT_AGENT_DEFS): the Lead, four developers and the reviewer.
 */
export const DEMO_TEAM = {
  lead: "marcus",
  members: ["rex", "alex", "mia", "leo", "sophie"],
} as const;

/** The demo team's reviewer, by name: the Lead's script hands finished work to them. */
const DEMO_REVIEWER_NAME = "Sophie";

/**
 * The script every demo agent follows (fake-agent.mjs; first matching rule wins).
 * The Lead splits each Boss task into five TASK: lines, so the Dispatcher fans them out
 * to the idle devs (the fifth prefers an attached Claude session, else it waits its turn). Devs "work" for a few seconds and walk their result back;
 * the Lead then asks the reviewer for a review, and the reviewer's PASS closes the task.
 */
export const DEMO_SCENARIO: { rules: DemoRule[]; default: Omit<DemoRule, "match"> } = {
  rules: [
    // Lead doing a queued sub-task itself (lead.selfWork policy)
    { match: "doing this task yourself", text: ["STATUS: done", "SUMMARY: (demo) The Lead finished this one personally."], delayMs: 3500, jitterMs: 1500 },
    // Lead reading the reviewer's verdict: done, no new delegation
    { match: `New result from ${DEMO_REVIEWER_NAME}`, text: "FINAL SUMMARY: (demo) Reviewed and approved. The team delivered every part of the Boss's task.", delayMs: 1200 },
    // Lead reading dev results: hand the work to the reviewer
    { match: "New result from", text: `@${DEMO_REVIEWER_NAME}: Please review what the team just delivered.`, delayMs: 1200 },
    // Lead receiving a Boss task
    {
      match: "The Boss assigned you a task",
      text: [
        "Got it, Boss. I'll split this into five parts:",
        "TASK[ui]: Sketch the screens and layout",
        "TASK: Build the core feature",
        "TASK: Wire up the data and the API",
        "TASK: Write tests and polish the details",
        // Prefers a dev whose role mentions Claude: the demo's attached terminal session
        "TASK[claude]: Check the existing code for anything the new feature could break",
      ],
      delayMs: 1500,
    },
    // Reviewer
    { match: `VERDICT|Your name is ${DEMO_REVIEWER_NAME}|You are ${DEMO_REVIEWER_NAME} \\(`, text: ["VERDICT: PASS", "SUMMARY: (demo) Reviewed, looks good."], delayMs: 3000 },
    // An attached Claude Code session in fork mode (prompt template worker-attached)
    { match: "added this Claude Code session", text: ["STATUS: done", "SUMMARY: (demo) Checked it in a fork of my terminal session; nothing breaks."], delayMs: 5000, jitterMs: 2000 },
    // Developers (first run: "Your name is …"; later runs: "[Context reminder] You are …" / "[Assigned by …]")
    { match: "Your name is|Assigned by|Context reminder", text: ["STATUS: done", "SUMMARY: (demo) Finished my part."], delayMs: 6000, jitterMs: 4000 },
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

/**
 * The scenario with every delay multiplied by `scale` (PIXEL_CREW_DEMO_DELAY_SCALE,
 * default 1). Tests use a small scale so the full Boss → Lead → Dev → reviewer run
 * takes seconds; nobody needs it in normal use.
 */
export function scaledDemoScenario(scale: number): typeof DEMO_SCENARIO {
  if (!Number.isFinite(scale) || scale < 0 || scale === 1) return DEMO_SCENARIO;
  const s = (ms: number | undefined) => (ms === undefined ? undefined : Math.round(ms * scale));
  return {
    rules: DEMO_SCENARIO.rules.map((r) => ({ ...r, delayMs: s(r.delayMs), jitterMs: s(r.jitterMs) })),
    default: { ...DEMO_SCENARIO.default, delayMs: s(DEMO_SCENARIO.default.delayMs) },
  };
}

/** Write the demo scenario into the data dir and return its path. */
export function writeDemoScenario(dataDir: string, scale = Number(process.env.PIXEL_CREW_DEMO_DELAY_SCALE ?? 1)): string {
  const file = resolve(dataDir, "demo-scenario.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(scaledDemoScenario(scale), null, 2));
  return file;
}
