// The Boss composer's per-task toggles (P1.5). They can only NARROW office.lead
// (mirrors packages/orchestrator/src/lead-policy.ts, which enforces it):
//   - capability allowed by the office  → toggle starts on; turning it off sends false
//   - "urgent_only" in the office        → toggle starts off, works only with Urgent; on sends true
//   - "never" in the office              → toggle disabled; nothing is sent
import type { OfficeConfig } from "@pixel-crew/shared";

export type ToggleMode = "off_by_office" | "urgent_opt_in" | "allowed_by_office";

export function selfWorkMode(cfg: OfficeConfig): ToggleMode {
  switch (cfg.lead.selfWork) {
    case "urgent_only": return "urgent_opt_in";
    case "when_no_dev_after_wait": return "allowed_by_office";
    default: return "off_by_office";
  }
}

export function subagentsMode(cfg: OfficeConfig): ToggleMode {
  switch (cfg.lead.subagents) {
    case "urgent_only": return "urgent_opt_in";
    case "when_all_devs_busy":
    case "allowed": return "allowed_by_office";
    default: return "off_by_office";
  }
}

/** Initial toggle value for a mode. */
export function defaultToggle(mode: ToggleMode): boolean {
  return mode === "allowed_by_office";
}

/** Whether the toggle can be changed right now. */
export function toggleEnabled(mode: ToggleMode, urgent: boolean): boolean {
  if (mode === "off_by_office") return false;
  if (mode === "urgent_opt_in") return urgent;
  return true;
}

/** The flag value to send in BOSS_ASSIGN (undefined = leave the office policy as it is). */
export function flagFor(mode: ToggleMode, on: boolean, urgent: boolean): boolean | undefined {
  if (mode === "allowed_by_office") return on ? undefined : false;
  if (mode === "urgent_opt_in") return urgent && on ? true : undefined;
  return undefined;
}

function seconds(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 120 && s % 60 === 0 ? `${s / 60} min` : `${s} s`;
}

/** One line: what the Lead may do for this task, given the office config and the toggles. */
export function describeEffectivePolicy(cfg: OfficeConfig, urgent: boolean, selfWorkOn: boolean, subagentsOn: boolean): string {
  const sw = selfWorkMode(cfg);
  const sa = subagentsMode(cfg);
  const selfWork = toggleEnabled(sw, urgent) && selfWorkOn
    ? `the Lead may take a queued sub-task itself after ${seconds(cfg.lead.waitMs)} with no free dev`
    : "the Lead only delegates";
  let subagents = "no subagents";
  if (toggleEnabled(sa, urgent) && subagentsOn) {
    subagents = cfg.lead.subagents === "when_all_devs_busy"
      ? "subagents only while every dev is busy"
      : "subagents allowed";
  }
  return `Effective for this task: ${selfWork}; ${subagents}.`;
}
