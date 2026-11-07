// ---------------------------------------------------------------------------
// AgentDriver (plan §7.5, kept small): how one task run reaches an agent.
//
// AgentSession still owns prompts, output parsing and the run lifecycle. A driver only
// starts a run and hands back something that behaves like a child process: stdout
// carries Claude stream-json lines, "close" fires with an exit code. Today:
//   - no driver        → spawn per task from the AIBackend (LegacyCli path, unchanged)
//   - ClaudeForkDriver → `claude -p --resume <id> --fork-session` for an attached session
//   - ClaudeLiveDriver → a message into the session's own inbox socket, read back from
//                        its transcript (a virtual process, no child is spawned)
// ---------------------------------------------------------------------------

import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import type { BuildArgsOpts } from "../ai-backend.js";

/** How an attached session receives work (matches the wire AttachMode). */
export type AttachMode = "fork" | "live" | "tmux";

/** The Claude Code session the owner started in their own terminal. */
export interface AttachTarget {
  /** Process id of the interactive `claude` */
  pid: number;
  /** Its working directory (Claude resumes and stores the transcript by cwd) */
  cwd: string;
  /** Current session id (it changes after /clear, so drivers read it per run) */
  sessionId: string;
  /** Transcript file of that session */
  transcriptPath: string;
  /** Inbox socket for cross-session messages (Claude Code ≥ 2.1.224), if it has one */
  messagingSocketPath?: string;
}

/** One run as the session asks for it. */
export interface DriverRunSpec {
  /** Rendered prompt (template + task) */
  prompt: string;
  /** Flags the session would give a spawned CLI (permission mode, tool policy, model…) */
  opts: BuildArgsOpts;
  cwd: string;
  env: Record<string, string | undefined>;
  /** Directories the run should also be allowed to touch (e.g. the team project) */
  addDirs: string[];
  taskId: string;
}

/** What AgentSession needs from a running task: a ChildProcess or a VirtualRun. */
export type DriverProcess = ChildProcess | VirtualRun;

export interface AgentDriver {
  readonly kind: "spawn" | AttachMode;
  /** One line for the UI ("Work runs in a fork of this session; …") */
  readonly note: string;
  /** Every run uses this cwd instead of the team project / worktree */
  readonly pinnedCwd?: string;
  /**
   * Runs continue someone else's conversation: the session never resumes its own id,
   * always renders the attached-worker prompt, and gets no worktree.
   */
  readonly borrowsSession: boolean;
  /** Busy outside Pixel Crew (the owner is mid-turn in that terminal) */
  externallyBusy?(): boolean;
  /** Command line shown in logs (and asserted by tests) for a spec */
  describe(spec: DriverRunSpec): { command: string; args: string[] };
  start(spec: DriverRunSpec): DriverProcess;
}

/**
 * A run with no child process behind it. Emits like a ChildProcess: stdout/stderr
 * "data" (Buffers) and "close"(code). kill() ends it with code null.
 */
export class VirtualRun extends EventEmitter {
  readonly virtual = true;
  readonly pid: undefined = undefined;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  private closed = false;
  private onKill: (() => void) | null = null;

  /** Called once when the run is killed (stop watching, close sockets) */
  setKillHandler(fn: () => void): void {
    this.onKill = fn;
  }

  writeLine(obj: unknown): void {
    if (this.closed) return;
    this.stdout.emit("data", Buffer.from(JSON.stringify(obj) + "\n"));
  }

  writeErr(text: string): void {
    if (this.closed) return;
    this.stderr.emit("data", Buffer.from(text.endsWith("\n") ? text : text + "\n"));
  }

  finish(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    // Asynchronous, like a real process: listeners attached right after start() still hear it
    setImmediate(() => this.emit("close", code));
  }

  get isClosed(): boolean {
    return this.closed;
  }

  kill(): boolean {
    if (this.closed) return false;
    const fn = this.onKill;
    this.onKill = null;
    try { fn?.(); } finally { this.finish(null); }
    return true;
  }
}

export function isVirtualRun(p: DriverProcess | null | undefined): p is VirtualRun {
  return !!p && (p as VirtualRun).virtual === true;
}
