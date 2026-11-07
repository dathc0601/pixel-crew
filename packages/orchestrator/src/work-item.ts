// ---------------------------------------------------------------------------
// Work items: the unit the Dispatcher hands to devs (plan §7.4).
// Local types (the orchestrator does not depend on @pixel-crew/shared); the
// gateway maps them onto WorkItemSchema for the wire.
// ---------------------------------------------------------------------------

export type WorkItemState =
  | "queued"
  | "assigned"
  | "handing_off"
  | "running"
  | "in_review"
  | "done"
  | "failed"
  | "cancelled";

export type WorkItemPriority = "normal" | "urgent";
export type WorkItemOrigin = "boss" | "lead";
export type HandoffKind = "boss_to_lead" | "lead_to_dev" | "dev_to_lead" | "dev_to_reviewer";

/** Pseudo-agent id of the Boss (the human). */
export const BOSS_ID = "boss";

/** Per-task flags from BOSS_ASSIGN. They can only narrow the office lead policy. */
export interface BossTaskFlags {
  urgent: boolean;
  allowLeadSelfWork?: boolean;
  allowSubagents?: boolean;
}

export interface WorkItem {
  /** Also the taskId of every run of this item */
  id: string;
  parentId: string | null;
  origin: WorkItemOrigin;
  title: string;
  prompt: string;
  priority: WorkItemPriority;
  requiredSkills?: string[];
  preferredAgentId: string | null;
  pinned: boolean;
  state: WorkItemState;
  assigneeId: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  heartbeatAt: number | null;
  selfWork?: boolean;
  flags?: BossTaskFlags;
  error?: string;
  /** Who put the item in the pool (the Lead); daemon-internal */
  fromAgentId?: string | null;
  /** Working directory override parsed from a "[dir]" prefix; daemon-internal */
  repoPath?: string;
}

export const TERMINAL_STATES: ReadonlySet<WorkItemState> = new Set(["done", "failed", "cancelled"]);
/** States in which an item occupies its assignee */
export const ACTIVE_STATES: ReadonlySet<WorkItemState> = new Set(["assigned", "handing_off", "running"]);

/**
 * Allowed transitions. "→ queued" from assigned/handing_off/running is the zombie
 * re-queue (process exit without a result, heartbeat timeout, dev fired, daemon restart).
 */
const TRANSITIONS: Record<WorkItemState, readonly WorkItemState[]> = {
  queued: ["assigned", "cancelled", "failed"],
  assigned: ["handing_off", "queued", "cancelled"],
  handing_off: ["running", "queued", "cancelled"],
  running: ["in_review", "done", "failed", "queued", "cancelled"],
  in_review: ["running", "done", "failed", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: WorkItemState, to: WorkItemState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminal(state: WorkItemState): boolean {
  return TERMINAL_STATES.has(state);
}

/** One-line label for a hand-off bubble or a board card. */
export function workItemTitle(prompt: string, max = 60): string {
  const line = prompt.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------------------
// Lead output parsing
// ---------------------------------------------------------------------------

export interface ParsedDelegation {
  /** Agent name for "@Name:" / "@Name!:"; null for "TASK:" (any idle dev) */
  target: string | null;
  /** "@Name!:" — only that dev may take it */
  pinned: boolean;
  /** From "TASK[skill, skill]:" */
  skills: string[];
  prompt: string;
}

/**
 * Delegation lines in the Lead's output (optionally bulleted or bold):
 *   @Name: task      preference for Name; an idle peer takes it if Name is busy
 *   @Name!: task     hard pin; waits for Name
 *   TASK: task       any idle dev
 *   TASK[ui, css]: task   any idle dev, preferring these skills
 */
const DELEGATION_LINE_RE = /^\s*(?:[-*>]\s*)?(?:\*\*)?(?:@(\w+)(!)?|TASK(?:\[([^\]]*)\])?)(?:\*\*)?:\s*(.+)$/;

export function parseDelegationLine(line: string): ParsedDelegation | null {
  const m = line.match(DELEGATION_LINE_RE);
  if (!m) return null;
  const [, name, bang, skillList, prompt] = m;
  const skills = (skillList ?? "")
    .split(/[,;]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { target: name ?? null, pinned: !!name && bang === "!", skills, prompt };
}
