import { execSync } from "child_process";
import { existsSync } from "fs";
import type { AIBackend } from "@pixel-crew/orchestrator";

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
      if (opts.noTools) args.push("--tools", "");
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

const backendMap = new Map<string, AIBackend>(backends.map((b) => [b.id, b]));

export function getBackend(id: string): AIBackend | undefined {
  return backendMap.get(id);
}

export function getAllBackends(): AIBackend[] {
  return backends;
}

/**
 * Version-probe commands for backends with ambiguous binary names.
 * Maps backend id → shell command that succeeds ONLY if the real CLI is installed.
 * Backends not listed here use plain `which <command>` (their names are distinctive enough).
 */
const VERSION_PROBES: Record<string, string> = {
  // "agent" is too generic — verify it's actually Cursor's CLI
  cursor: "agent --version 2>&1 | grep -iq cursor",
  // "copilot" also names AWS Copilot CLI — verify GitHub's agentic CLI
  copilot: "copilot --version 2>&1 | grep -Eiq 'GitHub Copilot CLI|github copilot'",
  // "pi" collides with math utilities, coreutils, etc.
  pi: "pi --version 2>&1 | grep -iq pi",
  // "sp" collides with Sapling SCM and other tools
  sapling: "sp --version 2>&1 | grep -iq sapling",
};

/**
 * `which`/`execSync` above run through a POSIX shell (Git Bash on Windows), so resolved
 * paths come back like "/c/Users/arsla/.local/bin/claude". Node's spawn() on Windows goes
 * through the native Win32 CreateProcess API, which doesn't understand that syntax and
 * fails with ENOENT. Convert to a native Windows path so spawn() can actually find the
 * binary.
 *
 * npm/global installs on Windows commonly create BOTH an extensionless POSIX shell shim
 * and a .cmd/.exe wrapper side by side. Git Bash's `which` may return the extensionless
 * shim, which exists on disk but is a shell script Win32 spawn() cannot execute directly.
 * So a real Windows-executable candidate (.exe/.cmd/.bat) must be preferred FIRST, falling
 * back to the bare converted path only if none of those exist.
 */
function toNativeWindowsPath(posixPath: string): string {
  const match = posixPath.match(/^\/([a-zA-Z])\/(.*)$/);
  if (!match) return posixPath;
  const [, drive, rest] = match;
  const winPath = `${drive.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`;
  for (const ext of [".exe", ".cmd", ".bat"]) {
    if (existsSync(winPath + ext)) {
      return winPath + ext;
    }
  }
  return winPath;
}

/**
 * Confirm the installed Claude Code lists "auto" under --permission-mode.
 * Older CLIs without it fall back to the CEO-approval gate instead of bypass.
 */
function probeClaudeAutoMode(backend: AIBackend): void {
  try {
    const help = execSync(`"${backend.command}" --help`, { encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
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
 *  Also resolves each detected backend's command to its absolute path
 *  so that spawn() works even if the child process env has a different PATH. */
export function detectBackends(): string[] {
  const detected: string[] = [];
  for (const backend of backends) {
    try {
      const probe = VERSION_PROBES[backend.id];
      if (probe) {
        // Ambiguous name — run version probe to verify identity
        execSync(probe, { stdio: "ignore", timeout: 5000 });
      } else {
        // Distinctive name — `which` is sufficient
        execSync(`which ${backend.command}`, { stdio: "ignore", timeout: 3000 });
      }
      // Resolve absolute path so spawn() doesn't depend on child env PATH
      try {
        let absPath = execSync(`which ${backend.command}`, { encoding: "utf-8", timeout: 3000 }).trim();
        if (absPath && absPath.startsWith("/")) {
          if (process.platform === "win32") absPath = toNativeWindowsPath(absPath);
          backend.command = absPath;
          console.log(`[backends] ${backend.id}: resolved to ${absPath}`);
        }
      } catch { /* keep relative command as fallback */ }
      if (backend.id === "claude") probeClaudeAutoMode(backend);
      detected.push(backend.id);
    } catch {
      // not installed or wrong binary
    }
  }
  return detected;
}
