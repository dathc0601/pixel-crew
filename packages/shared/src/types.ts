import { z } from "zod";

export const AgentStatusEnum = z.enum([
  "idle", "working", "waiting_approval", "done", "error",
]);
export type AgentStatus = z.infer<typeof AgentStatusEnum>;

export const RiskLevelEnum = z.enum(["low", "med", "high"]);
export type RiskLevel = z.infer<typeof RiskLevelEnum>;

export const DecisionEnum = z.enum(["yes", "no"]);
export type Decision = z.infer<typeof DecisionEnum>;

export const TeamPhaseEnum = z.enum(["create", "design", "execute", "complete"]);
export type TeamPhase = z.infer<typeof TeamPhaseEnum>;

export const UserRoleEnum = z.enum(["owner", "collaborator", "spectator"]);
export type UserRole = z.infer<typeof UserRoleEnum>;

// ---------------------------------------------------------------------------
// Work items (Phase 1 dispatcher). The daemon owns them; clients only render.
// queued → assigned → handing_off → running → (in_review → running…) → done | failed | cancelled
// ---------------------------------------------------------------------------

export const WorkItemStateEnum = z.enum([
  "queued", "assigned", "handing_off", "running", "in_review", "done", "failed", "cancelled",
]);
export type WorkItemState = z.infer<typeof WorkItemStateEnum>;

export const WorkItemPriorityEnum = z.enum(["normal", "urgent"]);
export type WorkItemPriority = z.infer<typeof WorkItemPriorityEnum>;

/** "boss": the Boss's task, held by the Lead. "lead": a sub-task the Lead put in the shared pool. */
export const WorkItemOriginEnum = z.enum(["boss", "lead"]);
export type WorkItemOrigin = z.infer<typeof WorkItemOriginEnum>;

/** Per-task flags from BOSS_ASSIGN (only on "boss" items). */
export const BossTaskFlagsSchema = z.object({
  urgent: z.boolean(),
  allowLeadSelfWork: z.boolean().optional(),
  allowSubagents: z.boolean().optional(),
});
export type BossTaskFlags = z.infer<typeof BossTaskFlagsSchema>;

export const WorkItemSchema = z.object({
  id: z.string(),
  /** The Boss item this sub-task belongs to (null for Boss items and legacy delegations) */
  parentId: z.string().nullable(),
  origin: WorkItemOriginEnum,
  title: z.string(),
  prompt: z.string(),
  priority: WorkItemPriorityEnum,
  requiredSkills: z.array(z.string()).optional(),
  /** "@Name:" preference or "@Name!:" pin (agentId) */
  preferredAgentId: z.string().nullable(),
  pinned: z.boolean(),
  state: WorkItemStateEnum,
  /** Agent holding the item ("boss" items are held by the Lead) */
  assigneeId: z.string().nullable(),
  /** Runs started so far (zombie re-queue fails the item at 2) */
  attempts: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
  heartbeatAt: z.number().nullable(),
  /** True while the Lead is doing this sub-task itself (lead.selfWork policy) */
  selfWork: z.boolean().optional(),
  flags: BossTaskFlagsSchema.optional(),
  error: z.string().optional(),
  /**
   * Restored after a daemon restart and paused: it does not start (and spend tokens)
   * until the owner sends RESUME_POOL, or CANCEL_WORK_ITEM drops it.
   */
  held: z.boolean().optional(),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const HandoffKindEnum = z.enum(["boss_to_lead", "lead_to_dev", "dev_to_lead", "dev_to_reviewer"]);
export type HandoffKind = z.infer<typeof HandoffKindEnum>;


export const LeadWaitingReasonEnum = z.enum(["all_devs_busy", "pinned_dev_busy", "no_devs", "none"]);
export type LeadWaitingReason = z.infer<typeof LeadWaitingReasonEnum>;
