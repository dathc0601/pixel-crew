import { existsSync } from "fs";
import path from "path";
import { createFakeBackend, resolveCommand, spawnPortableSync, type AIBackend } from "@pixel-crew/orchestrator";

// Claude Code refuses --dangerously-skip-permissions as root. Running as root at all
// requires --allow-root (see root-guard.ts); bypass then degrades to auto mode.
const isRoot = process.getuid?.() === 0;

const backends: AIBackend[] = [
  // ── Stable backends ───────────────────────────────────────────
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    supportsStdin: true,
    instructionPath: ".claude/CLAUDE.md",
    stability: "stable",
    guardType: "hooks",
    supportsResume: true,
    supportsAgentType: true,
    supportsNativeWorktree: true,
    supportsStructuredOutput: true,
    // --permission-mode auto (verified in Claude Code 2.1.x `claude --help`); re-probed in detectBackends()
    supportsAutoPermission: true,
    buildArgs(prompt, opts) {
      const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
      if (opts.permissionMode === "bypass" && !isRoot) {
        // Only when the owner opted this backend into bypass in config.json
        args.push("--dangerously-skip-permissions");
      } else if (opts.permissionMode !== "default") {
        args.push("--permission-mode", "auto");
      }
      if (!opts.skipResume) {
        if (opts.resumeSessionId) {
          args.push("--resume", opts.resumeSessionId);
        } else if (opts.continue) {
          args.push("--continue");
        }
      }
      // --tools / --disallowedTools take a comma-separated list (claude --help, 2.1.319)
      if (opts.tools) args.push("--tools", opts.tools.join(","));
      else if (opts.noTools) args.push("--tools", "");
      if (opts.disallowedTools?.length) args.push("--disallowedTools", opts.disallowedTools.join(","));
      if (opts.model) args.push("--model", opts.model);
      if (opts.agentType) args.push("--agent", opts.agentType);
      if (opts.worktree) args.push("--worktree");
      return args;
    },
    deleteEnv: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    instructionPath: "AGENTS.md",
    stability: "stable",
    guardType: "sandbox",          // OS-level Seatbelt (macOS) / Landlock (Linux)
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      if (opts.fullAccess && !isRoot) {
        return ["exec", prompt, "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check"];
      }
      return ["exec", prompt, "--full-auto", "--skip-git-repo-check"];
    },
  },

  // ── Beta backends ─────────────────────────────────────────────
  {
    id: "gemini",
    name: "Gemini CLI",
    command: "gemini",
    instructionPath: "GEMINI.md",
    stability: "beta",
    guardType: "flag",             // --sandbox flag
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      // --yolo auto-approves every tool call: only with an explicit bypass opt-in
      return opts.fullAccess ? ["-p", prompt, "--yolo"] : ["-p", prompt];
    },
  },

  // ── Experimental backends ─────────────────────────────────────
  {
    id: "copilot",
    name: "GitHub Copilot",
    command: "copilot",
    instructionPath: ".github/copilot-instructions.md",
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      const args = ["-p", prompt];
      if (opts.fullAccess) args.push("--allow-all-tools");
      if (opts.model) args.push("--model", opts.model);
      return args;
    },
  },
  {
    id: "cursor",
    name: "Cursor CLI",
    command: "agent",              // Cursor's CLI binary is "agent", not "cursor"
    instructionPath: ".cursor/rules/instructions.md",
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      const args = ["-p", prompt];
      if (opts.fullAccess) args.push("--yolo");
      if (opts.model) args.push("--model", opts.model);
      return args;
    },
  },
  {
    id: "aider",
    name: "Aider",
    command: "aider",
    instructionPath: ".aider.conf.yml",
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      // --yes auto-confirms every prompt: only with an explicit bypass opt-in
      const args = ["--message", prompt];
      if (opts.fullAccess) args.push("--yes");
      args.push("--no-pretty", "--no-git");
      return args;
    },
  },
  {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    instructionPath: "AGENTS.md",  // Same convention as Codex
    stability: "experimental",
    guardType: "none",
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: true,
    buildArgs(prompt) {
      return ["run", prompt, "--format", "json"];
    },
  },
  {
    id: "pi",
    name: "Pi",
    command: "pi",
    instructionPath: ".claude/CLAUDE.md",  // Pi reads .claude/CLAUDE.md like Claude Code
    stability: "experimental",
    guardType: "none",             // .pi/extensions/ guard system exists but not deployed by us
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: false,
    buildArgs(prompt, opts) {
      const args = ["-p", prompt];
      if (opts.model) args.push("--model", opts.model);
      return args;
    },
  },
  {
    id: "sapling",
    name: "Sapling",
    command: "sp",
    instructionPath: "SAPLING.md",
    stability: "experimental",
    guardType: "none",             // .sapling/guards.json exists but not deployed by us
    supportsResume: false,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: true,
    buildArgs(prompt, opts) {
      const args = ["run"];
      if (opts.model) args.push("--model", opts.model);
      args.push("--json", prompt);
      return args;
    },
  },
];

// Fake backend (scripted stream-json, no model calls) for demos and manual testing from source:
//   PIXEL_CREW_FAKE_SCENARIO=path/to/scenario.json pnpm dev:gateway   (format: fake-agent.mjs header)
if (process.env.PIXEL_CREW_FAKE_SCENARIO) {
  const fake = createFakeBackend({ scenarioFile: path.resolve(process.env.PIXEL_CREW_FAKE_SCENARIO) });
  if (existsSync(fake.buildArgs("", {})[0])) {
    backends.push(fake);
  } else {
    console.warn("[backends] PIXEL_CREW_FAKE_SCENARIO is set but fake-agent.mjs was not found (run from source)");
  }
}

const backendMap = new Map<string, AIBackend>(backends.map((b) => [b.id, b]));

export function getBackend(id: string): AIBackend | undefined {
  return backendMap.get(id);
}

export function getAllBackends(): AIBackend[] {
  return backends;
}

/**
 * Version probes for backends with ambiguous binary names: the backend counts as
 * installed only when `<command> --version` output matches. Backends not listed here
 * only need their (distinctive) command on PATH.
 */
const VERSION_PROBES: Record<string, RegExp> = {
  // "agent" is too generic — verify it's actually Cursor's CLI
  cursor: /cursor/i,
  // "copilot" also names AWS Copilot CLI — verify GitHub's agentic CLI
  copilot: /GitHub Copilot CLI|github copilot/i,
  // "pi" collides with math utilities, coreutils, etc.
  pi: /pi/i,
  // "sp" collides with Sapling SCM and other tools
  sapling: /sapling/i,
};

/** `<command> --version` (stdout + stderr), or null when it cannot run. No shell involved. */
function versionOutput(command: string): string | null {
  const r = spawnPortableSync(command, ["--version"], { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"] });
  if (r.error) return null;
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

/**
 * Confirm the installed Claude Code lists "auto" under --permission-mode.
 * Older CLIs without it fall back to the CEO-approval gate instead of bypass.
 */
function probeClaudeAutoMode(backend: AIBackend): void {
  try {
    const r = spawnPortableSync(backend.command, ["--help"], { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
    if (r.error) throw r.error;
    const help = String(r.stdout ?? "");
    backend.supportsAutoPermission = hasAutoPermissionMode(help);
    if (!backend.supportsAutoPermission) {
      console.warn("[backends] claude: --permission-mode auto not found in `claude --help`; runs will need approval");
    }
  } catch {
    /* keep the static default; spawn errors surface later with a clear message */
  }
}

/** True when `claude --help` output lists "auto" among --permission-mode choices. */
export function hasAutoPermissionMode(helpText: string): boolean {
  const idx = helpText.indexOf("--permission-mode");
  if (idx < 0) return false;
  return /"auto"/.test(helpText.slice(idx, idx + 600));
}

/** Check which AI CLI tools are installed on this machine.
 *  Looks each command up on PATH in-process (PATHEXT on Windows) and stores the
 *  absolute path, so that spawn() works even if the child process env has a different PATH. */
export function detectBackends(): string[] {
  const detected: string[] = [];
  for (const backend of backends) {
    const absPath = resolveCommand(backend.command);
    if (!absPath) continue;
    const probe = VERSION_PROBES[backend.id];
    if (probe) {
      // Ambiguous name — the version output must name the real CLI
      const out = versionOutput(absPath);
      if (out === null || !probe.test(out)) continue;
    }
    backend.command = absPath;
    console.log(`[backends] ${backend.id}: resolved to ${absPath}`);
    if (backend.id === "claude") probeClaudeAutoMode(backend);
    detected.push(backend.id);
  }
  return detected;
}
