// ---------------------------------------------------------------------------
// Where a running Claude Code session can be found on disk (read-only).
//
// - <config>/sessions/<pid>.json: Claude Code's registry of running sessions (seen in
//   2.1.316–2.1.319: pid, sessionId, cwd, status "idle"/"busy"/…, messagingSocketPath,
//   startedAt). It is not a documented interface, so every field is optional here and a
//   missing registry falls back to the newest transcript in the project folder.
// - <config>/projects/<cwd key>/<sessionId>.jsonl: the session transcript (documented
//   location; its record format is internal).
// <config> is CLAUDE_CONFIG_DIR when set (Claude Code honours it), else ~/.claude.
// Nothing here writes to the Claude config directory.
// ---------------------------------------------------------------------------

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import os from "os";
import path from "path";
import { claudeProjectDir } from "../external-output-reader.js";

export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

export interface ClaudeSessionEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  status?: string;
  messagingSocketPath?: string;
  peerProtocol?: number;
  startedAt?: number;
  version?: string;
}

/** The registry entry of a running session, or null (no registry, unreadable, other pid). */
export function readClaudeSession(home: string, pid: number): ClaudeSessionEntry | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(home, "sessions", `${pid}.json`), "utf-8")) as Record<string, unknown>;
    if (raw.pid !== pid || typeof raw.sessionId !== "string" || typeof raw.cwd !== "string") return null;
    return {
      pid,
      sessionId: raw.sessionId,
      cwd: raw.cwd,
      status: typeof raw.status === "string" ? raw.status : undefined,
      messagingSocketPath: typeof raw.messagingSocketPath === "string" && raw.messagingSocketPath ? raw.messagingSocketPath : undefined,
      peerProtocol: typeof raw.peerProtocol === "number" ? raw.peerProtocol : undefined,
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : undefined,
      version: typeof raw.version === "string" ? raw.version : undefined,
    };
  } catch {
    return null;
  }
}

export function projectsRoot(home: string): string {
  return path.join(home, "projects");
}

export function transcriptPathFor(home: string, cwd: string, sessionId: string): string {
  return path.join(claudeProjectDir(cwd, projectsRoot(home)), `${sessionId}.jsonl`);
}

/** Newest transcript in the cwd's project folder (fallback when there is no registry entry). */
export function newestTranscript(home: string, cwd: string): { sessionId: string; path: string } | null {
  const dir = claudeProjectDir(cwd, projectsRoot(home));
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ f, m: statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (!files.length) return null;
    return { sessionId: files[0].f.replace(/\.jsonl$/, ""), path: path.join(dir, files[0].f) };
  } catch {
    return null;
  }
}

/** The owner is mid-turn in that terminal (anything but "idle" counts; no status = idle). */
export function sessionIsBusy(entry: ClaudeSessionEntry | null): boolean {
  return !!entry?.status && entry.status !== "idle";
}

/**
 * The session skips permission prompts, judged from its command line. Cross-session
 * messages to such a session are held for approval in its terminal. A bypass default
 * set in settings files is not visible here.
 */
export function argsBypassPermissions(args: string | undefined): boolean {
  return !!args && /--dangerously-skip-permissions|--permission-mode[= ]bypassPermissions/.test(args);
}

export function transcriptExists(p: string): boolean {
  return existsSync(p);
}
