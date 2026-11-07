// Zod-free constants shared by the daemon and the browser. The web client imports them
// through "@pixel-crew/shared/client" so Zod stays out of its bundle (plan P4.3);
// __tests__ in apps/web check they match the schemas.

import type { OfficeConfig } from "./office-config";

/** Pseudo-agent id of the Boss (the human) in HANDOFF events. */
export const BOSS_AGENT_ID = "boss";

/** Longest hand-off walk the daemon accepts (office.handoff.durationMs). */
export const HANDOFF_MAX_MS = 10_000;

/** The office config with every default applied (equals OfficeConfigSchema.parse({})). */
export const DEFAULT_OFFICE_CONFIG: OfficeConfig = {
  permissionMode: "auto",
  backendPermissions: {},
  lead: { selfWork: "never", subagents: "when_all_devs_busy", waitMs: 120_000 },
  handoff: { durationMs: 2500 },
};

/** Every GatewayEvent type, in GatewayEventSchema order. */
export const GATEWAY_EVENT_TYPES = [
  "AGENTS_SYNC",
  "AGENT_STATUS",
  "TASK_STARTED",
  "LOG_APPEND",
  "APPROVAL_NEEDED",
  "TASK_DONE",
  "TASK_FAILED",
  "TASK_DELEGATED",
  "AGENT_CREATED",
  "AGENT_FIRED",
  "TASK_RESULT_RETURNED",
  "TEAM_CHAT",
  "TASK_QUEUED",
  "TOKEN_UPDATE",
  "TOOL_ACTIVITY",
  "TEAM_PHASE",
  "AGENT_DEFS",
  "SUGGESTION",
  "PROJECT_LIST",
  "PROJECT_DATA",
  "PREVIEW_READY",
  "FOLDER_PICKED",
  "IMAGE_UPLOADED",
  "BACKENDS_AVAILABLE",
  "CONFIG_LOADED",
  "CONFIG_SAVED",
  "WORKTREE_READY",
  "WORKTREE_MERGED",
  "WORKTREE_REVERTED",
  "AUTO_MERGE_UPDATED",
  "SKILL_LIST",
  "CHAT_HISTORY_LOADED",
  "SESSIONS_REVOKED",
  "PAIR_LINK",
  "DEVICES",
  "WORK_ITEM_UPDATED",
  "HANDOFF",
  "LEAD_WAITING",
  "LEAD_SELF_WORK",
  "LEAD_SUBAGENT_STARTED",
  "OFFICE_CONFIG",
  "GATEWAY_INFO",
  "ATTACH_RESULT",
] as const;

export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];
