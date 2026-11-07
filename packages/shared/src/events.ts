import { z } from "zod";
import { AgentStatusEnum, RiskLevelEnum, TeamPhaseEnum, WorkItemSchema, HandoffKindEnum, LeadWaitingReasonEnum, UserRoleEnum } from "./types";
import { OfficeConfigSchema } from "./office-config";

export const AgentStatusEvent = z.object({
  type: z.literal("AGENT_STATUS"),
  agentId: z.string(),
  status: AgentStatusEnum,
  details: z.string().optional(),
});

export const TaskStartedEvent = z.object({
  type: z.literal("TASK_STARTED"),
  agentId: z.string(),
  taskId: z.string(),
  prompt: z.string(),
});

export const LogAppendEvent = z.object({
  type: z.literal("LOG_APPEND"),
  agentId: z.string(),
  taskId: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  /** One or more output lines; the daemon joins chunks of ~100 ms with "\n" (P4.5) */
  chunk: z.string(),
  /** The whole output of the task so far: replace what the client has instead of appending */
  replace: z.boolean().optional(),
  /** Last line only, for an agent whose pane is not open: a status line, not chat text */
  preview: z.boolean().optional(),
});

export const ApprovalNeededEvent = z.object({
  type: z.literal("APPROVAL_NEEDED"),
  approvalId: z.string(),
  agentId: z.string(),
  taskId: z.string(),
  title: z.string(),
  summary: z.string(),
  riskLevel: RiskLevelEnum,
});

export const TokenUsage = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const TaskResultPayload = z.object({
  summary: z.string(),
  fullOutput: z.string().optional(),
  changedFiles: z.array(z.string()),
  diffStat: z.string(),
  testResult: z.enum(["passed", "failed", "unknown"]),
  nextSuggestion: z.string().optional(),
  previewUrl: z.string().optional(),
  previewPath: z.string().optional(),
  entryFile: z.string().optional(),
  projectDir: z.string().optional(),
  previewCmd: z.string().optional(),
  previewPort: z.number().optional(),
  tokenUsage: TokenUsage.optional(),
});

export const TaskDoneEvent = z.object({
  type: z.literal("TASK_DONE"),
  agentId: z.string(),
  taskId: z.string(),
  result: TaskResultPayload,
  isFinalResult: z.boolean().optional(),
});

export const TaskFailedEvent = z.object({
  type: z.literal("TASK_FAILED"),
  agentId: z.string(),
  taskId: z.string(),
  error: z.string(),
});

export const TaskDelegatedEvent = z.object({
  type: z.literal("TASK_DELEGATED"),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  taskId: z.string(),
  prompt: z.string(),
});

export const AgentCreatedEvent = z.object({
  type: z.literal("AGENT_CREATED"),
  agentId: z.string(),
  name: z.string(),
  role: z.string(),
  palette: z.number().optional(),
  personality: z.string().optional(),
  backend: z.string().optional(),
  isTeamLead: z.boolean().optional(),
  teamId: z.string().optional(),
  isExternal: z.boolean().optional(),
  pid: z.number().optional(),
  cwd: z.string().optional(),
  workDir: z.string().optional(),
  startedAt: z.number().optional(),
  autoMerge: z.boolean().optional(),
  pendingMerge: z.boolean().optional(),
  lastMergeCommit: z.string().nullable().optional(),
  lastMergeMessage: z.string().nullable().optional(),
  undoCount: z.number().optional(),
  /** A Claude Code session the owner started elsewhere that joined the team (ATTACH_EXTERNAL) */
  attached: z.boolean().optional(),
  attachMode: z.enum(["fork", "live", "tmux"]).optional(),
  /** One line for the UI: how this member's work runs */
  attachNote: z.string().optional(),
  /** External agents only: the ways it can join the team (absent = it cannot join) */
  attachOptions: z.array(z.object({ mode: z.enum(["fork", "live", "tmux"]), note: z.string() })).optional(),
});

export const AgentFiredEvent = z.object({
  type: z.literal("AGENT_FIRED"),
  agentId: z.string(),
});

export const TaskResultReturnedEvent = z.object({
  type: z.literal("TASK_RESULT_RETURNED"),
  fromAgentId: z.string(),
  toAgentId: z.string(),
  taskId: z.string(),
  summary: z.string(),
  success: z.boolean(),
});

export const TeamChatEvent = z.object({
  type: z.literal("TEAM_CHAT"),
  fromAgentId: z.string(),
  toAgentId: z.string().optional(),
  message: z.string(),
  messageType: z.enum(["delegation", "result", "status", "warning"]),
  taskId: z.string().optional(),
  timestamp: z.number(),
});

export const TaskQueuedEvent = z.object({
  type: z.literal("TASK_QUEUED"),
  agentId: z.string(),
  taskId: z.string(),
  prompt: z.string(),
  position: z.number(),
});

export const TokenUpdateEvent = z.object({
  type: z.literal("TOKEN_UPDATE"),
  agentId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});

export const ToolActivityEvent = z.object({
  type: z.literal("TOOL_ACTIVITY"),
  agentId: z.string(),
  text: z.string(),
});

export const TeamPhaseEvent = z.object({
  type: z.literal("TEAM_PHASE"),
  teamId: z.string(),
  phase: TeamPhaseEnum,
  leadAgentId: z.string(),
});

export const SuggestionEvent = z.object({
  type: z.literal("SUGGESTION"),
  text: z.string(),
  author: z.string(),
  timestamp: z.number(),
});

export const AgentDefsEvent = z.object({
  type: z.literal("AGENT_DEFS"),
  agents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    skills: z.string(),
    personality: z.string(),
    palette: z.number(),
    isBuiltin: z.boolean(),
    teamRole: z.enum(["dev", "reviewer", "leader"]),
    skillFiles: z.array(z.string()).optional(),
  })),
});

export const SkillListEvent = z.object({
  type: z.literal("SKILL_LIST"),
  skills: z.array(z.object({
    name: z.string(),
    title: z.string(),
    isFolder: z.boolean(),
  })),
});

export const AgentsSyncEvent = z.object({
  type: z.literal("AGENTS_SYNC"),
  agentIds: z.array(z.string()),
});

const ProjectPreviewSchema = z.object({
  entryFile: z.string().optional(),
  projectDir: z.string().optional(),
  previewCmd: z.string().optional(),
  previewPort: z.number().optional(),
}).optional();

export const ProjectListEvent = z.object({
  type: z.literal("PROJECT_LIST"),
  projects: z.array(z.object({
    id: z.string(),
    name: z.string(),
    startedAt: z.number(),
    endedAt: z.number(),
    agentNames: z.array(z.string()),
    eventCount: z.number(),
    preview: ProjectPreviewSchema,
    tokenUsage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional(),
    ratings: z.record(z.string(), z.number()).optional(),
  })),
});

export const ProjectDataEvent = z.object({
  type: z.literal("PROJECT_DATA"),
  projectId: z.string(),
  name: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  events: z.array(z.any()),
});

export const PreviewReadyEvent = z.object({
  type: z.literal("PREVIEW_READY"),
  url: z.string(),
});

export const FolderPickedEvent = z.object({
  type: z.literal("FOLDER_PICKED"),
  requestId: z.string(),
  path: z.string(),
});

export const ImageUploadedEvent = z.object({
  type: z.literal("IMAGE_UPLOADED"),
  requestId: z.string(),
  path: z.string(),
});


export const WorktreeReadyEvent = z.object({
  type: z.literal("WORKTREE_READY"),
  agentId: z.string(),
  taskId: z.string(),
  branch: z.string(),
});

export const WorktreeMergedEvent = z.object({
  type: z.literal("WORKTREE_MERGED"),
  agentId: z.string(),
  branch: z.string(),
  success: z.boolean(),
  commitHash: z.string().optional(),
  commitMessage: z.string().optional(),
  undoCount: z.number().optional(),
});

export const WorktreeRevertedEvent = z.object({
  type: z.literal("WORKTREE_REVERTED"),
  agentId: z.string(),
  success: z.boolean(),
  commitId: z.string().optional(),
  commitsAhead: z.number(),
  message: z.string().optional(),
});

export const AutoMergeUpdatedEvent = z.object({
  type: z.literal("AUTO_MERGE_UPDATED"),
  agentId: z.string(),
  autoMerge: z.boolean(),
  lastMergeCommit: z.string().nullable().optional(),
  lastMergeMessage: z.string().nullable().optional(),
  undoCount: z.number().optional(),
});

export const BackendsAvailableEvent = z.object({
  type: z.literal("BACKENDS_AVAILABLE"),
  backends: z.array(z.string()),
});

export const ConfigLoadedEvent = z.object({
  type: z.literal("CONFIG_LOADED"),
  telegramBotToken: z.string().optional(),
  telegramAllowedUsers: z.array(z.string()).optional(),
  telegramConnected: z.boolean().optional(),
  worktreeEnabled: z.boolean().optional(),
  autoMergeEnabled: z.boolean().optional(),
  tunnelBaseUrl: z.string().optional(),
  tunnelToken: z.string().optional(),
  tunnelRunning: z.boolean().optional(),
});

export const ConfigSavedEvent = z.object({
  type: z.literal("CONFIG_SAVED"),
  success: z.boolean(),
  message: z.string(),
  telegramConnected: z.boolean().optional(),
  tunnelRunning: z.boolean().optional(),
});

export const ChatHistoryLoadedEvent = z.object({
  type: z.literal("CHAT_HISTORY_LOADED"),
  /** Serialized PersistedAgent[] — same format as localStorage */
  data: z.string(),
});

export const SessionsRevokedEvent = z.object({
  type: z.literal("SESSIONS_REVOKED"),
  revoked: z.number(),
});

/**
 * Reply to CREATE_PAIR_LINK (sent only to the owner who asked). `qr` is the QR code of
 * `url` as a size×size grid of "1" (dark) / "0" (light) modules, row by row, so the UI
 * draws it without a QR library. `urls` are the base addresses the gateway can offer.
 */
export const PairLinkEvent = z.object({
  type: z.literal("PAIR_LINK"),
  url: z.string(),
  role: UserRoleEnum,
  expiresAt: z.number(),
  qr: z.object({ size: z.number().int().positive(), modules: z.string() }),
  urls: z.array(z.string()),
  /** Why phones may not reach `url` (e.g. loopback only without --lan) */
  warning: z.string().optional(),
});

export const DeviceInfoSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  role: UserRoleEnum,
  kind: z.enum(["local", "qr", "code", "share"]),
  issuedAt: z.number(),
  lastSeenAt: z.number(),
  expiresAt: z.number(),
  /** Has an open WebSocket right now */
  connected: z.boolean(),
  /** The device receiving this event */
  current: z.boolean(),
});

/** Paired devices (owner only). Sent on LIST_DEVICES and after a device pairs or is revoked. */
export const DevicesEvent = z.object({
  type: z.literal("DEVICES"),
  devices: z.array(DeviceInfoSchema),
});

// ---------------------------------------------------------------------------
// Phase 1: Boss → Lead → Dev choreography. Cosmetic for the scene; the daemon owns the state.
// ---------------------------------------------------------------------------

export const WorkItemUpdatedEvent = z.object({
  type: z.literal("WORK_ITEM_UPDATED"),
  item: WorkItemSchema,
});

/**
 * Someone walks a paper over. Real work on the receiving side starts after durationMs
 * (office.handoff.durationMs; 0 = instant). The daemon never waits for the client.
 */
export const HandoffEvent = z.object({
  type: z.literal("HANDOFF"),
  handoffId: z.string(),
  /** Agent id, or "boss" for the Boss */
  fromId: z.string(),
  toId: z.string(),
  workItemId: z.string(),
  kind: HandoffKindEnum,
  label: z.string(),
  durationMs: z.number().int().min(0),
});

/** Work is queued and no suitable dev is idle (queueLength 0 + reason "none" = waiting is over). */
export const LeadWaitingEvent = z.object({
  type: z.literal("LEAD_WAITING"),
  leadId: z.string().nullable(),
  queueLength: z.number().int().min(0),
  reason: LeadWaitingReasonEnum,
});

/** The Lead starts doing a queued sub-task itself (lead.selfWork policy allowed it). */
export const LeadSelfWorkEvent = z.object({
  type: z.literal("LEAD_SELF_WORK"),
  leadId: z.string(),
  workItemId: z.string(),
});

/** The Lead called Claude's subagent tool (Agent, formerly Task). */
export const LeadSubagentStartedEvent = z.object({
  type: z.literal("LEAD_SUBAGENT_STARTED"),
  leadId: z.string(),
  /** The Boss item the Lead was working on, if any */
  workItemId: z.string().nullable(),
  description: z.string(),
  subagentType: z.string().optional(),
});

/**
 * The effective office config. Broadcast after every change (SET_OFFICE_CONFIG or a manual
 * file edit); sent only to the caller for GET_OFFICE_CONFIG and for rejected requests.
 */
export const OfficeConfigEvent = z.object({
  type: z.literal("OFFICE_CONFIG"),
  config: OfficeConfigSchema,
  /** Why this caller's request was rejected (not owner, invalid values, write failure) */
  error: z.string().optional(),
  /** config.json currently fails validation; the last valid values stay in effect */
  fileError: z.string().optional(),
});

/**
 * How the daemon runs (sent on PING). demo = every agent is the scripted fake backend
 * (PIXEL_CREW_DEMO=1 or --demo): no AI CLI runs and no tokens are spent.
 */
export const GatewayInfoEvent = z.object({
  type: z.literal("GATEWAY_INFO"),
  demo: z.boolean(),
});

/** Reply to the caller of ATTACH_EXTERNAL / DETACH_AGENT (success is also visible as AGENT_CREATED). */
export const AttachResultEvent = z.object({
  type: z.literal("ATTACH_RESULT"),
  agentId: z.string(),
  action: z.enum(["attach", "detach"]),
  ok: z.boolean(),
  error: z.string().optional(),
});

export const GatewayEventSchema = z.discriminatedUnion("type", [
  AgentsSyncEvent,
  AgentStatusEvent,
  TaskStartedEvent,
  LogAppendEvent,
  ApprovalNeededEvent,
  TaskDoneEvent,
  TaskFailedEvent,
  TaskDelegatedEvent,
  AgentCreatedEvent,
  AgentFiredEvent,
  TaskResultReturnedEvent,
  TeamChatEvent,
  TaskQueuedEvent,
  TokenUpdateEvent,
  ToolActivityEvent,
  TeamPhaseEvent,
  AgentDefsEvent,
  SuggestionEvent,
  ProjectListEvent,
  ProjectDataEvent,
  PreviewReadyEvent,
  FolderPickedEvent,
  ImageUploadedEvent,
  BackendsAvailableEvent,
  ConfigLoadedEvent,
  ConfigSavedEvent,
  WorktreeReadyEvent,
  WorktreeMergedEvent,
  WorktreeRevertedEvent,
  AutoMergeUpdatedEvent,
  SkillListEvent,
  ChatHistoryLoadedEvent,
  SessionsRevokedEvent,
  PairLinkEvent,
  DevicesEvent,
  WorkItemUpdatedEvent,
  HandoffEvent,
  LeadWaitingEvent,
  LeadSelfWorkEvent,
  LeadSubagentStartedEvent,
  OfficeConfigEvent,
  GatewayInfoEvent,
  AttachResultEvent,
]);

export type TokenUsage = z.infer<typeof TokenUsage>;
export type AgentStatusEvent = z.infer<typeof AgentStatusEvent>;
export type TaskStartedEvent = z.infer<typeof TaskStartedEvent>;
export type LogAppendEvent = z.infer<typeof LogAppendEvent>;
export type ApprovalNeededEvent = z.infer<typeof ApprovalNeededEvent>;
export type TaskResultPayload = z.infer<typeof TaskResultPayload>;
export type TaskDoneEvent = z.infer<typeof TaskDoneEvent>;
export type PairLinkEvent = z.infer<typeof PairLinkEvent>;
export type DevicesEvent = z.infer<typeof DevicesEvent>;
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;
export type TaskFailedEvent = z.infer<typeof TaskFailedEvent>;
export type TaskDelegatedEvent = z.infer<typeof TaskDelegatedEvent>;
export type AgentCreatedEvent = z.infer<typeof AgentCreatedEvent>;
export type AgentFiredEvent = z.infer<typeof AgentFiredEvent>;
export type TaskResultReturnedEvent = z.infer<typeof TaskResultReturnedEvent>;
export type TeamChatEvent = z.infer<typeof TeamChatEvent>;
export type TaskQueuedEvent = z.infer<typeof TaskQueuedEvent>;
export type TokenUpdateEvent = z.infer<typeof TokenUpdateEvent>;
export type ToolActivityEvent = z.infer<typeof ToolActivityEvent>;
export type TeamPhaseEvent = z.infer<typeof TeamPhaseEvent>;
export type AgentDefsEvent = z.infer<typeof AgentDefsEvent>;
export type SuggestionEvent = z.infer<typeof SuggestionEvent>;
export type AgentsSyncEvent = z.infer<typeof AgentsSyncEvent>;
export type ProjectListEvent = z.infer<typeof ProjectListEvent>;
export type ProjectDataEvent = z.infer<typeof ProjectDataEvent>;
export type PreviewReadyEvent = z.infer<typeof PreviewReadyEvent>;
export type FolderPickedEvent = z.infer<typeof FolderPickedEvent>;
export type ImageUploadedEvent = z.infer<typeof ImageUploadedEvent>;
export type BackendsAvailableEvent = z.infer<typeof BackendsAvailableEvent>;
export type ConfigLoadedEvent = z.infer<typeof ConfigLoadedEvent>;
export type ConfigSavedEvent = z.infer<typeof ConfigSavedEvent>;
export type WorktreeReadyEvent = z.infer<typeof WorktreeReadyEvent>;
export type WorktreeMergedEvent = z.infer<typeof WorktreeMergedEvent>;
export type WorktreeRevertedEvent = z.infer<typeof WorktreeRevertedEvent>;
export type AutoMergeUpdatedEvent = z.infer<typeof AutoMergeUpdatedEvent>;
export type SkillListEvent = z.infer<typeof SkillListEvent>;
export type SessionsRevokedEvent = z.infer<typeof SessionsRevokedEvent>;
export type WorkItemUpdatedEvent = z.infer<typeof WorkItemUpdatedEvent>;
export type HandoffEvent = z.infer<typeof HandoffEvent>;
export type LeadWaitingEvent = z.infer<typeof LeadWaitingEvent>;
export type LeadSelfWorkEvent = z.infer<typeof LeadSelfWorkEvent>;
export type LeadSubagentStartedEvent = z.infer<typeof LeadSubagentStartedEvent>;
export type OfficeConfigEvent = z.infer<typeof OfficeConfigEvent>;
export type GatewayInfoEvent = z.infer<typeof GatewayInfoEvent>;
export type AttachResultEvent = z.infer<typeof AttachResultEvent>;
export type GatewayEvent = z.infer<typeof GatewayEventSchema>;

/**
 * Validate an incoming event. Returns null for unknown event types (a newer daemon)
 * or malformed payloads, so clients can drop them instead of throwing.
 */
export function parseGatewayEvent(raw: unknown): GatewayEvent | null {
  const result = GatewayEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}
