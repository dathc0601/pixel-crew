// ---------------------------------------------------------------------------
// Dispatcher (plan P1.1, §7.4): a shared pool of work items handed to idle devs.
//
// - Pool order: urgent first, then FIFO.
// - Only idle devs get work. Score: "@Name:" preference, then skill match, then
//   least recently busy. "@Name!:" pins wait for that dev.
// - Every assignment walks a hand-off first: the item stays handing_off for exactly
//   handoffDurationMs() (read live, 0 = instant) and only then starts. No client ack.
// - Zombie re-queue: a run that ends without a result (process exit, heartbeat
//   timeout) goes back to the queue; after maxAttempts the item fails and the
//   failure is forwarded to the Lead.
// - Lead self-work: when the policy allows it and an item waited waitMs with no
//   idle dev, the Lead takes it (one at a time).
// - Held items (restored after a daemon restart) are invisible to all of the
//   above until releaseHeld(): they never start, wait or count as pending work.
// ---------------------------------------------------------------------------

import { nanoid } from "nanoid";
import { CONFIG } from "./config.js";
import { canLeadSelfWork, DEFAULT_LEAD_POLICY, NO_BOSS_FLAGS, type LeadPolicyConfig } from "./lead-policy.js";
import {
  ACTIVE_STATES,
  canTransition,
  isTerminal,
  workItemTitle,
  type BossTaskFlags,
  type HandoffKind,
  type WorkItem,
  type WorkItemState,
} from "./work-item.js";
import type { OrchestratorEvent } from "./types.js";

export interface DispatchDev {
  agentId: string;
  name: string;
  /** Role text, including skills ("Developer — React, CSS") */
  role: string;
  /** Busy outside the pool (running a process, waiting for approval, private queue) */
  busy: boolean;
}

/** Why a run ended (set by AgentSession). */
export type RunEndReason =
  | "result"
  | "exit_no_result"
  | "heartbeat_timeout"
  | "timeout"
  | "spawn_error"
  | "cancelled"
  | "not_approved";

export interface RunEndDecision {
  /** requeued/ignored: do not forward to the Lead. failed: forward `summary` as a failure. */
  action: "untracked" | "ignored" | "requeued" | "done" | "in_review" | "failed" | "cancelled";
  summary?: string;
}

export interface DispatcherHost {
  /** Assignable devs: team members that are neither the Lead nor a reviewer */
  devs(): DispatchDev[];
  leadId(): string | null;
  /** Whether the team has a reviewer (delivered items then wait in_review) */
  hasReviewer(): boolean;
  /** Start real work on a dev, after the hand-off */
  startOnDev(item: WorkItem, agentId: string): void;
  /** Start Lead self-work on an item */
  startOnLead(item: WorkItem, leadId: string): void;
  /**
   * Heartbeat timeout: kill the agent's run of this item. "waiting" = the item is not
   * the agent's current run yet (queued behind other work, or waiting for approval);
   * "gone" = nothing to kill.
   */
  abortRun(agentId: string, itemId: string): "aborted" | "waiting" | "gone";
  /** Forward a failure to the Lead for an item whose run never reported back */
  forwardFailure(item: WorkItem, summary: string): void;
  emit(event: OrchestratorEvent): void;
}

export interface DispatcherOptions {
  /** Hand-off duration, read at the start of every hand-off (hot-reload applies to the next one) */
  handoffDurationMs?: () => number;
  /** Lead policy, read when it is needed */
  leadPolicy?: () => LeadPolicyConfig;
  maxAttempts?: number;
  heartbeatTimeoutMs?: number;
  now?: () => number;
}

export interface EnqueueSpec {
  id: string;
  parentId: string | null;
  prompt: string;
  title?: string;
  priority?: "normal" | "urgent";
  requiredSkills?: string[];
  preferredAgentId?: string | null;
  pinned?: boolean;
  fromAgentId?: string | null;
  repoPath?: string;
}

const MAX_TERMINAL_ITEMS = 100;
/** States an item can be cancelled from with CANCEL_WORK_ITEM (no agent is working on it) */
const NOT_STARTED: ReadonlySet<WorkItemState> = new Set(["queued", "assigned", "handing_off"]);

export class Dispatcher {
  private items = new Map<string, WorkItem>();
  private handoffTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private waitTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Items whose waitMs passed with no idle dev (eligible for Lead self-work) */
  private waitExpired = new Set<string>();
  /** fix taskId → item id (reviewer FAIL → direct fix by the same dev) */
  private fixRuns = new Map<string, string>();
  private abortRequested = new Set<string>();
  private lastBusy = new Map<string, number>();
  private busySeq = 0;
  private itemSeq = 0;
  private order = new Map<string, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastWaiting = { queueLength: 0, reason: "none" as string };
  private pumpScheduled = false;
  private destroyed = false;

  private readonly handoffDurationMs: () => number;
  private readonly leadPolicy: () => LeadPolicyConfig;
  private readonly maxAttempts: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly now: () => number;

  constructor(private host: DispatcherHost, opts: DispatcherOptions = {}) {
    this.handoffDurationMs = opts.handoffDurationMs ?? (() => CONFIG.dispatch.defaultHandoffMs);
    this.leadPolicy = opts.leadPolicy ?? (() => DEFAULT_LEAD_POLICY);
    this.maxAttempts = opts.maxAttempts ?? CONFIG.dispatch.maxAttempts;
    this.heartbeatTimeoutMs = opts.heartbeatTimeoutMs ?? CONFIG.dispatch.heartbeatTimeoutMs;
    this.now = opts.now ?? Date.now;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  /** All items, oldest first (copies) */
  list(): WorkItem[] {
    return [...this.items.values()].sort((a, b) => this.seqOf(a) - this.seqOf(b)).map((i) => ({ ...i }));
  }

  /** Items waiting for a dev (held items do not count) */
  queuedCount(): number {
    let n = 0;
    for (const i of this.items.values()) if (i.state === "queued" && !i.held) n++;
    return n;
  }

  /** Items that still need a dev or are being worked on (in_review and held items do not count) */
  hasActiveItems(): boolean {
    for (const i of this.items.values()) {
      if (i.origin === "lead" && !i.held && (i.state === "queued" || ACTIVE_STATES.has(i.state))) return true;
    }
    return false;
  }

  /** Items paused after a daemon restart (see restore / releaseHeld) */
  heldCount(): number {
    let n = 0;
    for (const i of this.items.values()) if (i.held) n++;
    return n;
  }

  /** At least one dev exists and none is idle */
  allDevsBusy(): boolean {
    const devs = this.host.devs();
    return devs.length > 0 && devs.every((d) => !this.isIdle(d));
  }

  /** Most recent Boss item that is not finished (held ones excluded) */
  currentRoot(): WorkItem | undefined {
    let best: WorkItem | undefined;
    for (const i of this.items.values()) {
      if (i.origin === "boss" && !i.held && !isTerminal(i.state) && (!best || this.seqOf(i) > this.seqOf(best))) best = i;
    }
    return best;
  }

  /** Unfinished Boss items, held ones excluded (a Lead result must never finish a held item) */
  activeRoots(): WorkItem[] {
    return this.list().filter((i) => i.origin === "boss" && !i.held && !isTerminal(i.state));
  }

  /** BOSS_ASSIGN flags governing an item (its own for Boss items, the parent's for sub-tasks) */
  flagsFor(itemId: string | null | undefined): BossTaskFlags {
    const item = itemId ? this.items.get(itemId) : undefined;
    if (item?.flags) return item.flags;
    const parent = item?.parentId ? this.items.get(item.parentId) : undefined;
    return parent?.flags ?? NO_BOSS_FLAGS;
  }

  isSelfWorkRun(taskId: string): boolean {
    const item = this.items.get(taskId);
    return !!item?.selfWork && item.state === "running";
  }

  // ---------------------------------------------------------------------------
  // Boss items
  // ---------------------------------------------------------------------------

  /** Create the Boss's item, held by the Lead, and walk it over (boss_to_lead). */
  assignToLead(spec: { prompt: string; flags: BossTaskFlags; leadId: string }, onArrive: (item: WorkItem) => void): WorkItem {
    const now = this.now();
    const item: WorkItem = {
      id: nanoid(),
      parentId: null,
      origin: "boss",
      title: workItemTitle(spec.prompt),
      prompt: spec.prompt,
      priority: spec.flags.urgent ? "urgent" : "normal",
      preferredAgentId: spec.leadId,
      pinned: true,
      state: "queued",
      assigneeId: null,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      heartbeatAt: null,
      flags: { ...spec.flags },
      fromAgentId: null,
    };
    this.add(item);
    this.emitUpdate(item);
    this.beginRootHandoff(item, spec.leadId, onArrive);
    return { ...item };
  }

  private beginRootHandoff(item: WorkItem, leadId: string, onArrive: (item: WorkItem) => void): void {
    item.assigneeId = leadId;
    this.setState(item, "assigned");
    this.handOff(item, "boss", leadId, "boss_to_lead", () => {
      item.attempts++;
      item.heartbeatAt = this.now();
      this.setState(item, "running");
      onArrive({ ...item });
    });
  }

  /**
   * The Lead finished the Boss task (final result) or it failed. Delivered sub-tasks
   * are accepted; sub-tasks that never started are cancelled.
   */
  finishRoot(rootId: string, success: boolean, error?: string): void {
    const root = this.items.get(rootId);
    if (!root || root.origin !== "boss" || isTerminal(root.state)) return;
    for (const child of this.childrenOf(rootId)) {
      if (child.state === "in_review" && success) this.setState(child, "done");
      else if (child.state === "queued" || child.state === "assigned" || child.state === "handing_off") this.cancelItem(child);
    }
    if (error) root.error = error;
    this.forceState(root, success ? "done" : "failed");
    this.prune();
    this.schedulePump();
  }

  /**
   * Boss items the Lead actually holds (state running). A Boss item still walking over
   * (assigned / handing_off) has not reached the Lead, so a Lead result must not finish it.
   */
  runningRoots(): WorkItem[] {
    return this.activeRoots().filter((i) => i.state === "running");
  }

  /** Finish every Boss item that has no sub-task left to do (Lead's final result). */
  finishSettledRoots(): string[] {
    const finished: string[] = [];
    for (const root of this.runningRoots()) {
      const pending = this.childrenOf(root.id).some((c) => c.state === "queued" || ACTIVE_STATES.has(c.state));
      if (!pending) {
        this.finishRoot(root.id, true);
        finished.push(root.id);
      }
    }
    return finished;
  }

  // ---------------------------------------------------------------------------
  // Sub-tasks (the shared pool)
  // ---------------------------------------------------------------------------

  enqueue(spec: EnqueueSpec): WorkItem {
    const now = this.now();
    const parent = spec.parentId ? this.items.get(spec.parentId) : undefined;
    const item: WorkItem = {
      id: spec.id,
      parentId: spec.parentId,
      origin: "lead",
      title: spec.title ?? workItemTitle(spec.prompt),
      prompt: spec.prompt,
      priority: spec.priority ?? parent?.priority ?? "normal",
      requiredSkills: spec.requiredSkills?.length ? [...spec.requiredSkills] : undefined,
      preferredAgentId: spec.preferredAgentId ?? null,
      pinned: !!spec.pinned && !!spec.preferredAgentId,
      state: "queued",
      assigneeId: null,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      heartbeatAt: null,
      fromAgentId: spec.fromAgentId ?? null,
      repoPath: spec.repoPath,
    };
    this.add(item);
    this.emitUpdate(item);
    this.armSelfWorkTimer(item);
    this.pump();
    return { ...item };
  }

  /**
   * Assign queued items to idle devs. Safe to call any time; starts happen after the
   * hand-off (a microtask when the duration is 0), never re-entrantly.
   */
  pump(): void {
    if (this.destroyed) return;
    const devs = this.host.devs();
    const idle = devs.filter((d) => this.isIdle(d));
    const queued = this.queuedItems();

    for (const item of queued) {
      if (idle.length === 0) break;
      const candidates = item.pinned ? idle.filter((d) => d.agentId === item.preferredAgentId) : idle;
      if (candidates.length === 0) continue; // a pin waits for its dev
      const pick = this.best(candidates, item);
      idle.splice(idle.indexOf(pick), 1);
      this.startHandoffToDev(item, pick.agentId);
    }

    this.pumpSelfWork();
    this.updateWaiting(devs);
  }

  private startHandoffToDev(item: WorkItem, agentId: string): void {
    this.clearWaitTimer(item.id);
    item.assigneeId = agentId;
    item.selfWork = undefined;
    this.setState(item, "assigned");
    const fromId = item.fromAgentId ?? this.host.leadId() ?? "lead";
    this.handOff(item, fromId, agentId, "lead_to_dev", () => {
      this.beginRun(item, agentId);
      this.host.startOnDev({ ...item }, agentId);
    });
  }

  private pumpSelfWork(): void {
    if (this.waitExpired.size === 0) return;
    const leadId = this.host.leadId();
    if (!leadId) return;
    const leadBusy = [...this.items.values()].some((i) => i.selfWork && i.assigneeId === leadId && ACTIVE_STATES.has(i.state));
    if (leadBusy) return;
    for (const item of this.queuedItems()) {
      if (!this.waitExpired.has(item.id)) continue;
      this.waitExpired.delete(item.id);
      if (item.pinned || !canLeadSelfWork(this.leadPolicy(), this.flagsFor(item.id))) continue;
      item.assigneeId = leadId;
      item.selfWork = true;
      this.setState(item, "assigned");
      // No walk: the Lead keeps the paper. handing_off lasts 0 ms.
      this.setState(item, "handing_off");
      this.beginRun(item, leadId);
      this.host.emit({ type: "lead:self-work", leadId, workItemId: item.id });
      this.host.startOnLead({ ...item }, leadId);
      return;
    }
  }

  private beginRun(item: WorkItem, agentId: string): void {
    item.attempts++;
    item.heartbeatAt = this.now();
    item.error = undefined;
    this.lastBusy.set(agentId, ++this.busySeq);
    this.setState(item, "running");
    this.ensureHeartbeatTimer();
  }

  /**
   * A tracked run ended. Decides done / in_review / re-queue / fail. Callers must not
   * forward "requeued" or "ignored" results to the Lead.
   */
  onRunEnded(agentId: string, taskId: string, outcome: { success: boolean; reason: RunEndReason | null; summary: string }): RunEndDecision {
    const fixOf = this.fixRuns.get(taskId);
    if (fixOf) {
      this.fixRuns.delete(taskId);
      const item = this.items.get(fixOf);
      if (item && item.state === "running" && item.assigneeId === agentId) {
        if (outcome.success) this.setState(item, "in_review");
        else { item.error = outcome.summary.slice(0, 300); this.setState(item, "failed"); }
      }
      this.schedulePump();
      return { action: "untracked" };
    }

    const item = this.items.get(taskId);
    if (!item || item.origin !== "lead") return { action: "untracked" };
    if (item.assigneeId !== agentId || item.state !== "running") return { action: "ignored" };

    this.lastBusy.set(agentId, ++this.busySeq);
    this.abortRequested.delete(item.id);
    const reason = outcome.reason ?? (outcome.success ? "result" : "exit_no_result");
    let decision: RunEndDecision;

    if (outcome.success) {
      const next: WorkItemState = this.host.hasReviewer() && !item.selfWork ? "in_review" : "done";
      item.selfWork = item.selfWork ? false : undefined;
      this.setState(item, next);
      decision = { action: next === "in_review" ? "in_review" : "done" };
    } else if (reason === "cancelled") {
      this.setState(item, "cancelled");
      decision = { action: "cancelled" };
    } else if (reason === "exit_no_result" || reason === "heartbeat_timeout" || reason === "spawn_error") {
      decision = this.requeueOrFail(item, reason);
    } else {
      item.error = outcome.summary.slice(0, 300);
      this.setState(item, "failed");
      decision = { action: "failed", summary: outcome.summary };
    }
    this.prune();
    this.schedulePump();
    return decision;
  }

  private requeueOrFail(item: WorkItem, reason: RunEndReason): RunEndDecision {
    const why = reason === "heartbeat_timeout" ? "no output before the heartbeat timeout" : "the process exited without a result";
    if (item.attempts < this.maxAttempts) {
      item.error = `Attempt ${item.attempts} interrupted: ${why}`;
      item.assigneeId = null;
      item.selfWork = undefined;
      this.setState(item, "queued");
      this.armSelfWorkTimer(item);
      console.log(`[Dispatcher] Re-queued "${item.title}" (${item.error})`);
      return { action: "requeued" };
    }
    const summary = `Work item "${item.title}" failed after ${item.attempts} attempts: ${why}. Decide whether to retry it differently or report to the Boss.`;
    item.error = `Failed after ${item.attempts} attempts: ${why}`;
    this.setState(item, "failed");
    console.log(`[Dispatcher] ${item.error} — escalating "${item.title}" to the Lead`);
    return { action: "failed", summary };
  }

  /** A dev was fired: its items go back to the pool (pins to it are dropped). */
  releaseAgent(agentId: string): void {
    for (const item of this.items.values()) {
      if (item.preferredAgentId === agentId && item.origin === "lead") {
        item.preferredAgentId = null;
        item.pinned = false;
      }
      if (item.origin === "lead" && item.assigneeId === agentId && ACTIVE_STATES.has(item.state)) {
        this.clearHandoffTimer(item.id);
        item.assigneeId = null;
        item.selfWork = undefined;
        item.error = "Assignee left the team";
        this.setState(item, "queued");
        this.armSelfWorkTimer(item);
      }
    }
    this.lastBusy.delete(agentId);
    this.schedulePump();
  }

  /** Cancel everything that is not finished (STOP_TEAM / FIRE_TEAM). */
  cancelAll(): void {
    for (const item of this.items.values()) {
      if (!isTerminal(item.state)) this.cancelItem(item);
    }
    this.fixRuns.clear();
    this.updateWaiting(this.host.devs());
  }

  /** Cancel everything, then forget the pool (FIRE_TEAM). */
  reset(): void {
    this.cancelAll();
    for (const t of this.handoffTimers.values()) clearTimeout(t);
    this.handoffTimers.clear();
    this.items.clear();
    this.order.clear();
    this.lastBusy.clear();
    this.abortRequested.clear();
  }

  // ---------------------------------------------------------------------------
  // Review loop (reviews stay on DelegationRouter's direct path)
  // ---------------------------------------------------------------------------

  /** Reviewer PASS: the dev's delivered items are accepted. */
  reviewPassed(devAgentId: string): void {
    for (const item of this.items.values()) {
      if (item.assigneeId === devAgentId && item.state === "in_review") this.setState(item, "done");
    }
  }

  /** Reviewer FAIL → direct fix by the same dev: its delivered items are back in progress. */
  fixStarted(devAgentId: string, fixTaskId: string): void {
    for (const item of this.items.values()) {
      if (item.assigneeId === devAgentId && item.state === "in_review") {
        item.heartbeatAt = this.now();
        this.setState(item, "running");
        this.fixRuns.set(fixTaskId, item.id);
        return;
      }
    }
  }

  /** The item the dev most recently delivered or is working on (for hand-off labels). */
  latestItemOf(agentId: string): WorkItem | undefined {
    let best: WorkItem | undefined;
    for (const i of this.items.values()) {
      if (i.assigneeId === agentId && i.origin === "lead" && (!best || this.seqOf(i) > this.seqOf(best))) best = i;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Hand-offs
  // ---------------------------------------------------------------------------

  /** Emit a HANDOFF that does not change item state (dev_to_lead, dev_to_reviewer). */
  announceHandoff(spec: { workItemId: string; fromId: string; toId: string; kind: HandoffKind; label: string }, onArrive: () => void): void {
    const durationMs = this.currentHandoffMs();
    this.host.emit({ type: "handoff", handoffId: nanoid(), ...spec, durationMs });
    this.after(durationMs, onArrive);
  }

  private handOff(item: WorkItem, fromId: string, toId: string, kind: HandoffKind, onArrive: () => void): void {
    const durationMs = this.currentHandoffMs();
    this.setState(item, "handing_off");
    this.host.emit({ type: "handoff", handoffId: nanoid(), fromId, toId, workItemId: item.id, kind, label: item.title, durationMs });
    const expectedAssignee = item.assigneeId;
    const arrive = () => {
      this.handoffTimers.delete(item.id);
      if (this.destroyed || item.state !== "handing_off" || item.assigneeId !== expectedAssignee) return;
      onArrive();
    };
    if (durationMs <= 0) {
      queueMicrotask(arrive);
    } else {
      this.handoffTimers.set(item.id, setTimeout(arrive, durationMs));
    }
  }

  private currentHandoffMs(): number {
    const ms = Number(this.handoffDurationMs());
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0;
  }

  private after(ms: number, fn: () => void): void {
    if (ms <= 0) queueMicrotask(() => { if (!this.destroyed) fn(); });
    else setTimeout(() => { if (!this.destroyed) fn(); }, ms);
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  /** Any output from the agent counts as a heartbeat for its running item. */
  heartbeat(agentId: string): void {
    const now = this.now();
    for (const item of this.items.values()) {
      if (item.assigneeId === agentId && item.state === "running") item.heartbeatAt = now;
    }
  }

  private ensureHeartbeatTimer(): void {
    if (this.heartbeatTimer || this.heartbeatTimeoutMs <= 0) return;
    const every = Math.max(50, Math.min(Math.floor(this.heartbeatTimeoutMs / 4), 15_000));
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), every);
    this.heartbeatTimer.unref?.();
  }

  /** Kill runs whose heartbeat is older than the timeout; the run end re-queues them. */
  checkHeartbeats(): void {
    const now = this.now();
    let running = 0;
    for (const item of [...this.items.values()]) {
      if (item.state !== "running" || item.origin !== "lead" || !item.assigneeId) continue;
      running++;
      // Fix runs and Lead self-work run under other task ids or behind the Lead's own runs
      if (this.fixRunOf(item.id) || item.selfWork) continue;
      if (this.abortRequested.has(item.id)) continue;
      if (now - (item.heartbeatAt ?? item.updatedAt) <= this.heartbeatTimeoutMs) continue;
      const result = this.host.abortRun(item.assigneeId, item.id);
      if (result === "waiting") {
        item.heartbeatAt = now;
        continue;
      }
      this.abortRequested.add(item.id);
      console.log(`[Dispatcher] Heartbeat timeout for "${item.title}" on ${item.assigneeId}`);
      if (result === "gone") {
        // Nothing to kill (the run never really started): handle it as a zombie here.
        const agentId = item.assigneeId;
        const decision = this.onRunEnded(agentId, item.id, { success: false, reason: "heartbeat_timeout", summary: "" });
        if (decision.action === "failed") this.host.forwardFailure({ ...item }, decision.summary ?? "");
      }
    }
    if (running === 0 && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private fixRunOf(itemId: string): boolean {
    for (const id of this.fixRuns.values()) if (id === itemId) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Persistence (team-state.json)
  // ---------------------------------------------------------------------------

  snapshot(): WorkItem[] {
    return this.list();
  }

  /**
   * Restore a saved pool. Items that were assigned, handing off or running become
   * queued again; Boss items with sub-tasks still to do stay running (the Lead holds
   * them); Boss items with nothing pending become queued for a new Lead run.
   *
   * hold (default true): every restored item that would start work (queued sub-tasks,
   * every unfinished Boss item) is marked held and nothing starts until releaseHeld().
   * hold false: no item is held and Boss items with nothing pending are returned so
   * the caller can re-run the Lead.
   */
  restore(saved: WorkItem[], opts: { hold?: boolean } = {}): { rootsToResume: WorkItem[]; held: number } {
    const hold = opts.hold ?? true;
    const restored: WorkItem[] = [];
    for (const raw of saved) {
      if (!raw || typeof raw.id !== "string" || this.items.has(raw.id)) continue;
      const item: WorkItem = { ...raw, selfWork: undefined, held: undefined };
      if (item.origin === "lead" && (ACTIVE_STATES.has(item.state))) {
        item.state = "queued";
        item.assigneeId = null;
        item.error = "Re-queued after a daemon restart";
      }
      this.add(item);
      restored.push(item);
    }
    const rootsToResume: WorkItem[] = [];
    let held = 0;
    for (const item of restored) {
      if (item.origin === "lead" && item.state === "queued") {
        if (hold) { item.held = true; held++; } else this.armSelfWorkTimer(item);
      }
      if (item.origin !== "boss" || isTerminal(item.state)) continue;
      if (this.hasPendingChildren(item.id)) {
        item.state = "running";
      } else {
        item.state = "queued";
        item.assigneeId = null;
        if (!hold) rootsToResume.push({ ...item });
      }
      if (hold) { item.held = true; held++; }
    }
    for (const item of this.list()) this.host.emit({ type: "work:updated", item });
    return { rootsToResume, held };
  }

  /**
   * Un-hold every held item (RESUME_POOL). Sub-tasks go back to the normal queue (the
   * caller pumps). Returns the released items and the Boss items to re-hand to the
   * Lead: those with no sub-task left to do (a held Boss item whose sub-tasks were all
   * cancelled meanwhile counts too).
   */
  releaseHeld(): { released: WorkItem[]; rootsToResume: WorkItem[] } {
    const held = [...this.items.values()].filter((i) => i.held).sort((a, b) => this.seqOf(a) - this.seqOf(b));
    for (const item of held) item.held = undefined;
    const rootsToResume: WorkItem[] = [];
    for (const item of held) {
      if (item.origin === "lead" && item.state === "queued") this.armSelfWorkTimer(item);
      if (item.origin === "boss" && !isTerminal(item.state)) {
        if (item.state === "running" && !this.hasPendingChildren(item.id)) {
          item.state = "queued";
          item.assigneeId = null;
        }
        if (item.state === "queued") rootsToResume.push({ ...item });
      }
      item.updatedAt = this.now();
      this.emitUpdate(item);
    }
    return { released: held.map((i) => ({ ...i })), rootsToResume };
  }

  /**
   * CANCEL_WORK_ITEM: cancel an item no agent is working on yet.
   * - Sub-task: only while queued (held or not), assigned or handing off.
   * - Boss item: refused while the Lead is running it (`leadRunning`) or while one of
   *   its sub-tasks is running; otherwise its sub-tasks that have not started are
   *   cancelled and the Boss item is cancelled from whatever state it is in.
   *   Delivered sub-tasks (in_review/done) are left as they are.
   * Returns the ids of every item cancelled.
   */
  cancelPending(id: string, opts: { leadRunning?: boolean } = {}): { ok: true; cancelled: string[] } | { ok: false; error: string } {
    const item = this.items.get(id);
    if (!item) return { ok: false, error: "That work item no longer exists." };
    if (isTerminal(item.state)) return { ok: false, error: `"${item.title}" is already ${item.state}.` };
    const cancelled: string[] = [];
    if (item.origin === "lead") {
      if (!NOT_STARTED.has(item.state)) {
        return { ok: false, error: `"${item.title}" has already started (${item.state.replace("_", " ")}); stop its agent instead.` };
      }
      this.cancelItem(item);
      cancelled.push(item.id);
    } else {
      if (opts.leadRunning) return { ok: false, error: `The Team Lead is working on "${item.title}" right now; stop the team instead.` };
      const children = this.childrenOf(id);
      const busy = children.find((c) => c.state === "running");
      if (busy) return { ok: false, error: `"${busy.title}" is already running; stop it before cancelling "${item.title}".` };
      for (const child of children) {
        if (NOT_STARTED.has(child.state)) {
          this.cancelItem(child);
          cancelled.push(child.id);
        }
      }
      this.cancelItem(item);
      cancelled.push(item.id);
    }
    this.prune();
    this.schedulePump();
    return { ok: true, cancelled };
  }

  /** Re-run a restored Boss item through the boss_to_lead hand-off. */
  resumeRoot(rootId: string, leadId: string, onArrive: (item: WorkItem) => void): void {
    const item = this.items.get(rootId);
    if (!item || item.state !== "queued") return;
    this.beginRootHandoff(item, leadId, onArrive);
  }

  destroy(): void {
    this.destroyed = true;
    for (const t of this.handoffTimers.values()) clearTimeout(t);
    for (const t of this.waitTimers.values()) clearTimeout(t);
    this.handoffTimers.clear();
    this.waitTimers.clear();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private add(item: WorkItem): void {
    this.items.set(item.id, item);
    this.order.set(item.id, ++this.itemSeq);
  }

  private seqOf(item: WorkItem): number {
    return this.order.get(item.id) ?? 0;
  }

  private childrenOf(rootId: string): WorkItem[] {
    return [...this.items.values()].filter((i) => i.parentId === rootId);
  }

  /** A sub-task of this Boss item still needs a dev or is being worked on */
  private hasPendingChildren(rootId: string): boolean {
    return this.childrenOf(rootId).some((c) => c.state === "queued" || ACTIVE_STATES.has(c.state));
  }

  /** Sub-tasks waiting for a dev, in pool order (held items excluded) */
  private queuedItems(): WorkItem[] {
    return [...this.items.values()]
      .filter((i) => i.state === "queued" && i.origin === "lead" && !i.held)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === "urgent" ? -1 : 1;
        return this.seqOf(a) - this.seqOf(b);
      });
  }

  private isIdle(dev: DispatchDev): boolean {
    if (dev.busy) return false;
    for (const i of this.items.values()) {
      if (i.assigneeId === dev.agentId && ACTIVE_STATES.has(i.state)) return false;
    }
    return true;
  }

  /** Preference, then skill match, then least recently busy, then roster order. */
  private best(candidates: DispatchDev[], item: WorkItem): DispatchDev {
    const skills = item.requiredSkills ?? [];
    const scored = candidates.map((d, index) => {
      const text = d.role.toLowerCase();
      return {
        d,
        index,
        preferred: item.preferredAgentId === d.agentId ? 1 : 0,
        skill: skills.filter((s) => text.includes(s)).length,
        lastBusy: this.lastBusy.get(d.agentId) ?? 0,
      };
    });
    scored.sort((a, b) => b.preferred - a.preferred || b.skill - a.skill || a.lastBusy - b.lastBusy || a.index - b.index);
    return scored[0].d;
  }

  private armSelfWorkTimer(item: WorkItem): void {
    this.clearWaitTimer(item.id);
    if (item.pinned || item.origin !== "lead" || item.held) return;
    const cfg = this.leadPolicy();
    if (!canLeadSelfWork(cfg, this.flagsFor(item.id))) return;
    const waitMs = Math.max(0, cfg.waitMs);
    const timer = setTimeout(() => {
      this.waitTimers.delete(item.id);
      if (this.destroyed || item.state !== "queued" || item.held) return;
      this.waitExpired.add(item.id);
      this.pump();
    }, waitMs);
    timer.unref?.();
    this.waitTimers.set(item.id, timer);
  }

  private clearWaitTimer(id: string): void {
    const t = this.waitTimers.get(id);
    if (t) clearTimeout(t);
    this.waitTimers.delete(id);
    this.waitExpired.delete(id);
  }

  private clearHandoffTimer(id: string): void {
    const t = this.handoffTimers.get(id);
    if (t) clearTimeout(t);
    this.handoffTimers.delete(id);
  }

  private cancelItem(item: WorkItem): void {
    item.held = undefined;
    this.clearHandoffTimer(item.id);
    this.clearWaitTimer(item.id);
    this.forceState(item, "cancelled");
  }

  private setState(item: WorkItem, to: WorkItemState): boolean {
    if (item.state === to) return true;
    if (!canTransition(item.state, to)) {
      console.warn(`[Dispatcher] Illegal transition ${item.state} → ${to} for "${item.title}" (ignored)`);
      return false;
    }
    item.state = to;
    item.updatedAt = this.now();
    this.emitUpdate(item);
    return true;
  }

  /** Terminal moves that are always allowed (finishing or cancelling a Boss task). */
  private forceState(item: WorkItem, to: "done" | "failed" | "cancelled"): void {
    if (isTerminal(item.state)) return;
    item.state = to;
    item.updatedAt = this.now();
    this.emitUpdate(item);
  }

  private emitUpdate(item: WorkItem): void {
    this.host.emit({ type: "work:updated", item: { ...item } });
  }

  /** Re-check the pool soon (after the current call stack), e.g. when an agent frees up. */
  poke(): void {
    this.schedulePump();
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.destroyed) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private updateWaiting(devs: DispatchDev[]): void {
    const queued = this.queuedItems();
    let reason: string;
    if (queued.length === 0) reason = "none";
    else if (devs.length === 0) reason = "no_devs";
    else if (queued.every((i) => i.pinned)) reason = "pinned_dev_busy";
    else reason = "all_devs_busy";
    if (queued.length === this.lastWaiting.queueLength && reason === this.lastWaiting.reason) return;
    this.lastWaiting = { queueLength: queued.length, reason };
    this.host.emit({
      type: "lead:waiting",
      leadId: this.host.leadId(),
      queueLength: queued.length,
      reason: reason as "all_devs_busy" | "pinned_dev_busy" | "no_devs" | "none",
    });
  }

  /** Keep the newest terminal items only. */
  private prune(): void {
    const terminal = this.list().filter((i) => isTerminal(i.state));
    const excess = terminal.length - MAX_TERMINAL_ITEMS;
    for (let k = 0; k < excess; k++) {
      const victim = terminal[k];
      // Never drop a finished sub-task whose Boss item is still open
      if (victim.parentId && this.items.get(victim.parentId) && !isTerminal(this.items.get(victim.parentId)!.state)) continue;
      this.items.delete(victim.id);
      this.order.delete(victim.id);
    }
  }
}
