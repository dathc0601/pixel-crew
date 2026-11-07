// ---------------------------------------------------------------------------
// Fork mode (the default way an attached Claude Code session takes work).
//
// Each task runs headless in a FORK of the owner's session:
//   claude -p <prompt> --resume <sessionId> --fork-session
//          --output-format stream-json --verbose --permission-mode auto [--add-dir …]
// - The fork copies the whole conversation, gets its own session id and transcript,
//   and leaves the original "unchanged on disk" (code.claude.com/docs/en/sessions.md).
//   Resuming WITHOUT --fork-session while the terminal is open would interleave both
//   processes' messages in one transcript (same page), so fork is never optional here.
// - Every task forks the session as it is right now (latest owner context); forks never
//   chain, so Pixel Crew work does not pile up in a hidden branch.
// - It runs in the session's own cwd: that is where the owner's work lives and where
//   Claude looks the session up first. The team project, if any, is added with --add-dir.
// - Permissions follow the office policy for Claude (default `auto`), like a hired dev.
// ---------------------------------------------------------------------------

import { spawnPortable } from "../proc.js";
import type { BuildArgsOpts } from "../ai-backend.js";
import type { AgentDriver, AttachTarget, DriverRunSpec } from "./driver.js";

export const FORK_NOTE = "Work runs in a fork of this session; your terminal is not touched.";

/** The exact argv of one fork-mode run (without the command itself). */
export function buildClaudeForkArgs(prompt: string, sessionId: string, opts: Pick<BuildArgsOpts, "permissionMode" | "tools" | "noTools" | "disallowedTools" | "model">, addDirs: readonly string[] = []): string[] {
  const args = ["-p", prompt, "--resume", sessionId, "--fork-session", "--output-format", "stream-json", "--verbose"];
  if (opts.permissionMode === "bypass") args.push("--dangerously-skip-permissions");
  else if (opts.permissionMode !== "default") args.push("--permission-mode", "auto");
  if (opts.tools) args.push("--tools", opts.tools.join(","));
  else if (opts.noTools) args.push("--tools", "");
  if (opts.disallowedTools?.length) args.push("--disallowedTools", opts.disallowedTools.join(","));
  if (opts.model) args.push("--model", opts.model);
  for (const dir of addDirs) args.push("--add-dir", dir);
  return args;
}

export interface ClaudeForkDriverOptions {
  /** Read before every run (the session id changes after /clear) */
  target: () => AttachTarget;
  /** Binary to run (default "claude"); demo mode and tests point it at fake-agent.mjs */
  command?: string;
  /** Arguments placed before the Claude flags (e.g. [fake-agent.mjs, --scenario, file]) */
  prefixArgs?: readonly string[];
  /** The owner is mid-turn in that terminal: do not hand it new work yet */
  externallyBusy?: () => boolean;
}

export function createClaudeForkDriver(o: ClaudeForkDriverOptions): AgentDriver {
  const command = o.command ?? "claude";
  const describe = (spec: DriverRunSpec) => ({
    command,
    args: [...(o.prefixArgs ?? []), ...buildClaudeForkArgs(spec.prompt, o.target().sessionId, spec.opts, spec.addDirs)],
  });
  return {
    kind: "fork",
    note: FORK_NOTE,
    get pinnedCwd() { return o.target().cwd; },
    borrowsSession: true,
    externallyBusy: o.externallyBusy,
    describe,
    start(spec) {
      const { command: cmd, args } = describe(spec);
      // Own process group like every other run, so cancel and timeouts kill the whole tree
      return spawnPortable(cmd, args, { cwd: spec.cwd, env: spec.env, stdio: ["ignore", "pipe", "pipe"], group: true });
    },
  };
}
