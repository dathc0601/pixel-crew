// ---------------------------------------------------------------------------
// Attached Claude Code sessions (Phase 2a): external sessions the owner put on the team.
//
// - attach(): an external Claude session becomes a team dev under the same agent id,
//   with a fork driver (default) or a live driver (inbox socket). The Dispatcher then
//   treats it like any other dev: hand-off walk, queue, Lead policy, zombie rules.
// - Liveness: every tickMs the owner's pid and Claude's session registry are checked.
//   A gone session detaches (its running item is re-queued by removeAgent); a busy one
//   (owner mid-turn in that terminal) gets no new work until it is idle again.
// - Persistence: attachments.json in the instance dir. On restart an attachment is
//   restored only when the same session is still running; otherwise it is dropped.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import {
  createClaudeForkDriver,
  createClaudeLiveDriver,
  isPidAlive,
  FORK_NOTE,
  LIVE_NOTE,
  LIVE_NOTE_BYPASS,
  type AgentDriver,
  type AttachMode,
  type AttachTarget,
  type CreateAgentOpts,
} from "@pixel-crew/orchestrator";
import {
  argsBypassPermissions,
  newestTranscript,
  readClaudeSession,
  sessionIsBusy,
  transcriptExists,
  transcriptPathFor,
  type ClaudeSessionEntry,
} from "./claude-sessions.js";

/** An external agent as the gateway tracks it (process scanner or demo). */
export interface ExternalSession {
  agentId: string;
  pid: number;
  cwd: string | null;
  backendId: string;
  palette?: number;
  /** Full command line, when known (used to spot permission bypass) */
  args?: string;
}

export interface AttachHost {
  /** The hired team, or null (attach needs a team with a Lead) */
  team(): { teamId: string; leadId: string } | null;
  createAgent(opts: CreateAgentOpts): void;
  removeAgent(agentId: string): void;
  hasAgent(agentId: string): boolean;
  agentNames(): string[];
  /** Re-check the work pool (the owner's session went idle) */
  poke(): void;
  /** Backend id registered for Claude ("claude"; the demo backend in demo mode) */
  backendId: string;
}

export interface AttachManagerOptions {
  host: AttachHost;
  /** Claude config dir (sessions/ and projects/ live there) */
  claudeHome: string;
  /** attachments.json */
  stateFile: string;
  isAlive?: (pid: number) => boolean;
  /** Demo mode / tests: run fork mode with this command instead of `claude` */
  forkCommand?: { command: string; prefixArgs: string[] };
  /** Live driver tuning (tests) */
  live?: { pollMs?: number; deliveryTimeoutMs?: number };
  tickMs?: number;
  /** An attachment ended because its session went away (not by the owner) */
  onSessionGone?: (agentId: string) => void;
}

export interface Attachment {
  agentId: string;
  pid: number;
  cwd: string;
  sessionId: string;
  mode: AttachMode;
  name: string;
  role: string;
  palette?: number;
  bypass: boolean;
  startedAt?: number;
  attachedAt: number;
}

interface Live {
  rec: Attachment;
  driver: AgentDriver;
  busy: boolean;
}

export type AttachResult = { ok: true; attachment: Attachment } | { ok: false; error: string };

const ROLE_PREFIX = "Developer — attached Claude Code session";

export class AttachManager {
  private live = new Map<string, Live>();
  /** Ids being taken off the team right now (their agent:fired is not a real fire) */
  private detaching = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly isAlive: (pid: number) => boolean;

  constructor(private o: AttachManagerOptions) {
    this.isAlive = o.isAlive ?? isPidAlive;
  }

  // ── Queries ─────────────────────────────────────────────────────────

  isAttached(agentId: string): boolean {
    return this.live.has(agentId);
  }

  isAttachedPid(pid: number): boolean {
    for (const l of this.live.values()) if (l.rec.pid === pid) return true;
    return false;
  }

  get(agentId: string): Attachment | undefined {
    return this.live.get(agentId)?.rec;
  }

  list(): Attachment[] {
    return [...this.live.values()].map((l) => ({ ...l.rec }));
  }

  /** Fields for AGENT_CREATED of an attached member ({} for everyone else). */
  wireFields(agentId: string): { attached?: true; attachMode?: AttachMode; attachNote?: string; isExternal?: false } {
    const l = this.live.get(agentId);
    if (!l) return {};
    return { attached: true, attachMode: l.rec.mode, attachNote: l.driver.note, isExternal: false };
  }

  /** How an external session could join (empty: it cannot). */
  options(ext: ExternalSession): Array<{ mode: AttachMode; note: string }> {
    if (ext.backendId !== "claude" || !ext.cwd) return [];
    const found = this.resolveSession(ext.pid, ext.cwd);
    if (!found) return [];
    const opts: Array<{ mode: AttachMode; note: string }> = [{ mode: "fork", note: FORK_NOTE }];
    if (found.entry?.messagingSocketPath) opts.push({ mode: "live", note: argsBypassPermissions(ext.args) ? LIVE_NOTE_BYPASS : LIVE_NOTE });
    return opts;
  }

  // ── Attach / detach ─────────────────────────────────────────────────

  attach(ext: ExternalSession, mode: AttachMode = "fork"): AttachResult {
    if (this.live.has(ext.agentId)) return { ok: false, error: "This session is already on the team." };
    if (ext.backendId !== "claude") return { ok: false, error: "Only Claude Code sessions can join the team." };
    if (!ext.cwd) return { ok: false, error: "The session's folder is unknown, so it cannot be resumed." };
    if (!this.isAlive(ext.pid)) return { ok: false, error: "That session is no longer running." };
    const team = this.o.host.team();
    if (!team) return { ok: false, error: "Hire a team first: an attached session joins the team as a developer." };
    if (this.o.host.hasAgent(ext.agentId)) return { ok: false, error: "An agent with this id already exists." };
    const found = this.resolveSession(ext.pid, ext.cwd);
    if (!found) return { ok: false, error: "No transcript found for this session yet; send it one message in its terminal first." };
    if (mode === "tmux") return { ok: false, error: "tmux mode is not available; use fork or live." };
    if (mode === "live" && !found.entry?.messagingSocketPath) {
      return { ok: false, error: "Live mode needs Claude Code 2.1.224 or later (cross-session inbox); use fork mode." };
    }
    const rec: Attachment = {
      agentId: ext.agentId,
      pid: ext.pid,
      cwd: found.entry?.cwd ?? ext.cwd,
      sessionId: found.sessionId,
      mode,
      name: this.pickName(ext.cwd),
      role: `${ROLE_PREFIX} (${path.basename(ext.cwd) || ext.cwd})`,
      palette: ext.palette,
      bypass: argsBypassPermissions(ext.args),
      startedAt: found.entry?.startedAt,
      attachedAt: Date.now(),
    };
    this.add(rec, team.teamId);
    this.save();
    console.log(`[Attach] ${rec.name} (${rec.agentId}, pid ${rec.pid}) joined the team in ${mode} mode; session ${rec.sessionId}`);
    return { ok: true, attachment: { ...rec } };
  }

  /** Take a member off the team. Its running item goes back to the pool. */
  detach(agentId: string, reason = "the owner"): Attachment | null {
    const l = this.live.get(agentId);
    if (!l) return null;
    this.live.delete(agentId);
    this.save();
    this.detaching.add(agentId);
    try {
      if (this.o.host.hasAgent(agentId)) this.o.host.removeAgent(agentId);
    } finally {
      // agent:fired is emitted synchronously by removeAgent; keep the flag a moment longer
      setTimeout(() => this.detaching.delete(agentId), 0);
    }
    console.log(`[Attach] ${l.rec.name} (${agentId}) left the team (${reason})`);
    return { ...l.rec };
  }

  /**
   * The orchestrator fired an agent. True when it was attached (or being detached): the
   * caller should show it as an external session again instead of removing it.
   */
  onAgentFired(agentId: string): boolean {
    if (this.detaching.has(agentId)) return true;
    if (!this.live.has(agentId)) return false;
    this.live.delete(agentId); // FIRE_TEAM / CREATE_TEAM / FIRE_AGENT took it off the team
    this.save();
    return true;
  }

  // ── Liveness and persistence ────────────────────────────────────────

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.o.tickMs ?? 3000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Check every attachment once: gone sessions detach, busy/idle changes poke the pool. */
  tick(): void {
    let poke = false;
    for (const l of [...this.live.values()]) {
      if (!this.isAlive(l.rec.pid)) {
        this.detach(l.rec.agentId, "session ended");
        this.o.onSessionGone?.(l.rec.agentId);
        continue;
      }
      const entry = readClaudeSession(this.o.claudeHome, l.rec.pid);
      if (entry && entry.sessionId !== l.rec.sessionId) {
        console.log(`[Attach] ${l.rec.name}: session is now ${entry.sessionId} (was ${l.rec.sessionId})`);
        l.rec.sessionId = entry.sessionId;
        this.save();
      }
      const busy = sessionIsBusy(entry);
      if (l.busy && !busy) poke = true;
      l.busy = busy;
    }
    if (poke) this.o.host.poke();
  }

  /**
   * Re-attach what was attached before a restart, if the same session still runs (same
   * pid, alive, and the registry still names the same session start or session id).
   * Needs the team to be restored first. Returns the restored attachments.
   */
  restore(): Attachment[] {
    const saved = this.load();
    const team = this.o.host.team();
    const restored: Attachment[] = [];
    for (const rec of saved) {
      const entry = readClaudeSession(this.o.claudeHome, rec.pid);
      const sameSession = !!entry && (entry.startedAt !== undefined && rec.startedAt !== undefined
        ? entry.startedAt === rec.startedAt
        : entry.sessionId === rec.sessionId);
      const why = !team ? "no team" : !this.isAlive(rec.pid) ? "session ended" : !sameSession ? "a different session now has that pid" : null;
      if (why) {
        console.log(`[Attach] Dropping saved attachment ${rec.name} (${rec.agentId}): ${why}`);
        continue;
      }
      if (entry) rec.sessionId = entry.sessionId;
      this.add(rec, team!.teamId);
      restored.push({ ...rec });
      console.log(`[Attach] Restored ${rec.name} (${rec.agentId}, ${rec.mode} mode)`);
    }
    this.save();
    return restored;
  }

  // ── Internals ───────────────────────────────────────────────────────

  private add(rec: Attachment, teamId: string): void {
    const driver = this.makeDriver(rec);
    this.live.set(rec.agentId, { rec, driver, busy: sessionIsBusy(readClaudeSession(this.o.claudeHome, rec.pid)) });
    this.o.host.createAgent({
      agentId: rec.agentId,
      name: rec.name,
      role: rec.role,
      backend: this.o.host.backendId,
      palette: rec.palette,
      teamId,
      workDir: rec.cwd,
      driver,
    });
  }

  private target(rec: Attachment): AttachTarget {
    const entry = readClaudeSession(this.o.claudeHome, rec.pid);
    const sessionId = entry?.sessionId ?? rec.sessionId;
    const cwd = entry?.cwd ?? rec.cwd;
    return { pid: rec.pid, cwd, sessionId, transcriptPath: transcriptPathFor(this.o.claudeHome, cwd, sessionId), messagingSocketPath: entry?.messagingSocketPath };
  }

  private makeDriver(rec: Attachment): AgentDriver {
    const target = () => this.target(rec);
    const externallyBusy = () => this.live.get(rec.agentId)?.busy ?? false;
    if (rec.mode === "live") {
      return createClaudeLiveDriver({
        target,
        isAlive: () => this.isAlive(rec.pid),
        externallyBusy,
        bypassesPermissions: rec.bypass,
        pollMs: this.o.live?.pollMs,
        deliveryTimeoutMs: this.o.live?.deliveryTimeoutMs,
      });
    }
    return createClaudeForkDriver({
      target,
      externallyBusy,
      command: this.o.forkCommand?.command,
      prefixArgs: this.o.forkCommand?.prefixArgs,
    });
  }

  private resolveSession(pid: number, cwd: string): { sessionId: string; entry: ClaudeSessionEntry | null } | null {
    const entry = readClaudeSession(this.o.claudeHome, pid);
    if (entry && transcriptExists(transcriptPathFor(this.o.claudeHome, entry.cwd, entry.sessionId))) return { sessionId: entry.sessionId, entry };
    if (entry) return null;
    const newest = newestTranscript(this.o.claudeHome, cwd);
    return newest ? { sessionId: newest.sessionId, entry: null } : null;
  }

  /** A short @-able name from the folder ("my-shop" → "MyShop"), unique in the office. */
  private pickName(cwd: string): string {
    const base = (path.basename(cwd) || "Claude")
      .split(/[^a-zA-Z0-9]+/).filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1)).join("").slice(0, 12) || "Claude";
    const taken = new Set(this.o.host.agentNames().map((n) => n.toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
  }

  private load(): Attachment[] {
    try {
      if (!existsSync(this.o.stateFile)) return [];
      const raw = JSON.parse(readFileSync(this.o.stateFile, "utf-8"));
      return Array.isArray(raw?.attachments)
        ? raw.attachments.filter((a: Attachment) => a && typeof a.agentId === "string" && typeof a.pid === "number" && typeof a.cwd === "string" && (a.mode === "fork" || a.mode === "live"))
        : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.o.stateFile), { recursive: true });
      const tmp = `${this.o.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ attachments: [...this.live.values()].map((l) => l.rec) }, null, 2));
      renameSync(tmp, this.o.stateFile);
    } catch (err) {
      console.warn(`[Attach] Could not save attachments: ${(err as Error).message}`);
    }
  }
}
