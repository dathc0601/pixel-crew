// Demo mode (no tokens): one simulated "Claude Code session the owner opened in a
// terminal", so Join team → hand-off → Leave team can be watched end to end.
// It is fake-claude-session.mjs: a registry entry and transcript in a fake Claude config
// dir inside the demo data dir, plus a fake inbox socket. Nothing touches ~/.claude.
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { startFakeClaudeSession, FAKE_CLAUDE_SESSION_SCRIPT, type FakeClaudeSession } from "@pixel-crew/orchestrator";
import type { ExternalSession } from "./attach-manager.js";

/** Fake Claude config dir used by demo mode (sessions/ and projects/). */
export function demoClaudeHome(dataDir: string): string {
  return join(dataDir, "demo-claude");
}

/** fake-claude-session.mjs next to the bundle in dist/, or in the orchestrator package from source. */
function resolveScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "fake-claude-session.mjs"), join(here, "..", "fake-claude-session.mjs"), FAKE_CLAUDE_SESSION_SCRIPT]) {
    if (existsSync(candidate)) return candidate;
  }
  return FAKE_CLAUDE_SESSION_SCRIPT;
}

export async function startDemoExternalSession(dataDir: string, delayScale = 1): Promise<{ session: FakeClaudeSession; external: ExternalSession }> {
  const cwd = join(dataDir, "demo-terminal", "webshop");
  mkdirSync(cwd, { recursive: true });
  const session = await startFakeClaudeSession({
    home: demoClaudeHome(dataDir),
    cwd,
    replyDelayMs: Math.max(200, Math.round(5000 * delayScale)),
    reply: "STATUS: done\nSUMMARY: (demo) Did it right in my own terminal session.",
    chatterMs: Math.max(1000, Math.round(20_000 * delayScale)),
    scriptPath: resolveScript(),
  });
  return {
    session,
    external: {
      agentId: `ext-claude-${session.pid}`,
      pid: session.pid,
      cwd,
      backendId: "claude",
      palette: session.pid % 6,
      args: "claude --permission-mode auto",
    },
  };
}
