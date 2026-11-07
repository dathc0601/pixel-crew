// ---------------------------------------------------------------------------
// Lead policy (plan §0.3, §7.3). Enforced by the daemon; prompts only explain it.
//
// Precedence rule for the per-task BOSS_ASSIGN flags:
//   - A flag can only NARROW what office.lead allows: `false` turns an allowed
//     capability off for that task; `true` never turns on something the config forbids.
//   - Exception: a config value of "urgent_only" allows the capability only for tasks
//     sent with urgent=true AND the matching flag set to true (explicit opt-in).
//
//   selfWork                 effective for a task
//   never                    never
//   urgent_only              urgent && allowLeadSelfWork === true
//   when_no_dev_after_wait   allowLeadSelfWork !== false
//   (self-work also needs waitMs to pass with no idle dev, and never takes pinned items)
//
//   subagents                effective for a Lead run
//   never                    never
//   urgent_only              urgent && allowSubagents === true
//   when_all_devs_busy       allowSubagents !== false && every dev busy && work queued
//   allowed                  allowSubagents !== false
// ---------------------------------------------------------------------------

import type { BossTaskFlags } from "./work-item.js";

export type LeadSelfWorkPolicy = "never" | "urgent_only" | "when_no_dev_after_wait";
export type LeadSubagentPolicy = "never" | "urgent_only" | "when_all_devs_busy" | "allowed";

export interface LeadPolicyConfig {
  selfWork: LeadSelfWorkPolicy;
  subagents: LeadSubagentPolicy;
  /** How long a queued item waits for an idle dev before the Lead may take it (ms) */
  waitMs: number;
}

/** Owner defaults (§0.3); the gateway passes the live office.lead section instead. */
export const DEFAULT_LEAD_POLICY: LeadPolicyConfig = {
  selfWork: "never",
  subagents: "when_all_devs_busy",
  waitMs: 120_000,
};

/** Flags for Lead runs that are not tied to a Boss task (legacy chat, restored teams). */
export const NO_BOSS_FLAGS: BossTaskFlags = { urgent: false };

/**
 * Claude Code's subagent tool. 2.1.x names it "Agent" with the legacy alias "Task"
 * (read from the CLI bundle, not from a live run). Deny both; allow the canonical name.
 */
export const SUBAGENT_TOOL_NAMES: readonly string[] = ["Agent", "Task"];
export const SUBAGENT_TOOLS_ALLOW: readonly string[] = ["Agent"];

export function canLeadSelfWork(cfg: LeadPolicyConfig, flags: BossTaskFlags): boolean {
  switch (cfg.selfWork) {
    case "urgent_only":
      return flags.urgent && flags.allowLeadSelfWork === true;
    case "when_no_dev_after_wait":
      return flags.allowLeadSelfWork !== false;
    case "never":
    default:
      return false;
  }
}

export interface SubagentContext {
  /** At least one dev exists and every dev is busy */
  allDevsBusy: boolean;
  /** Items waiting in the pool */
  queuedCount: number;
}

export function canLeadUseSubagents(cfg: LeadPolicyConfig, flags: BossTaskFlags, ctx: SubagentContext): boolean {
  switch (cfg.subagents) {
    case "urgent_only":
      return flags.urgent && flags.allowSubagents === true;
    case "when_all_devs_busy":
      return flags.allowSubagents !== false && ctx.allDevsBusy && ctx.queuedCount > 0;
    case "allowed":
      return flags.allowSubagents !== false;
    case "never":
    default:
      return false;
  }
}

/** How one Lead run is spawned. Default: no tools at all (`--tools ""`). */
export interface LeadRunPolicy {
  /** The Lead does a queued sub-task itself: full tools, worker prompt, no delegation parsing */
  selfWork: boolean;
  /** The subagent tool is allowed for this run */
  subagents: boolean;
  /** Appended to the prompt to explain the daemon's decision */
  promptNote?: string;
}
