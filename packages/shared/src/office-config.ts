import { z } from "zod";

/**
 * The "office" section of ~/.pixel-crew/config.json.
 *
 * permissionMode is the default for every backend:
 *   - "auto": Claude Code runs with --permission-mode auto. Backends without an
 *     auto mode ask the CEO (UI user) to approve before each spawn.
 *   - "ask": every spawn needs CEO approval first.
 * Bypass (e.g. --dangerously-skip-permissions) is never a global default; it is
 * only allowed as an explicit per-backend opt-in in backendPermissions.
 */
export const OfficePermissionModeEnum = z.enum(["auto", "ask"]);
export const BackendPermissionModeEnum = z.enum(["auto", "ask", "bypass"]);
export const LeadSelfWorkEnum = z.enum(["never", "urgent_only", "when_no_dev_after_wait"]);
export const LeadSubagentsEnum = z.enum(["never", "urgent_only", "when_all_devs_busy", "allowed"]);

export const HANDOFF_MAX_MS = 10_000;

export const OfficeConfigSchema = z.object({
  permissionMode: OfficePermissionModeEnum.default("auto"),
  backendPermissions: z.record(z.string(), BackendPermissionModeEnum).default({}),
  lead: z.object({
    selfWork: LeadSelfWorkEnum.default("never"),
    subagents: LeadSubagentsEnum.default("when_all_devs_busy"),
    waitMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).default(120_000),
  }).strict().default({}),
  handoff: z.object({
    durationMs: z.number().int().min(0).max(HANDOFF_MAX_MS).default(2500),
  }).strict().default({}),
}).strict();

export type OfficePermissionMode = z.infer<typeof OfficePermissionModeEnum>;
export type BackendPermissionMode = z.infer<typeof BackendPermissionModeEnum>;
export type OfficeConfig = z.infer<typeof OfficeConfigSchema>;
export type OfficeConfigInput = z.input<typeof OfficeConfigSchema>;

export const DEFAULT_OFFICE_CONFIG: OfficeConfig = OfficeConfigSchema.parse({});

/** Effective permission policy for one backend. */
export function backendPermissionMode(cfg: OfficeConfig, backendId: string): BackendPermissionMode {
  return cfg.backendPermissions[backendId] ?? cfg.permissionMode;
}
