import type { AIBackend } from "./ai-backend.js";

/**
 * Permission policy for one backend, from the office config:
 *   auto   - use the backend's auto mode; backends without one need CEO approval first
 *   ask    - always need CEO approval before spawning
 *   bypass - explicit per-backend opt-in to the backend's "skip all permissions" flags
 */
export type PermissionPolicy = "auto" | "ask" | "bypass";

/** How the CLI is launched: auto mode, bypass flags, or the CLI's own default (no permission flags). */
export type SpawnPermissionMode = "auto" | "bypass" | "default";

export interface SpawnPermission {
  mode: SpawnPermissionMode;
  /** The CEO must approve before the process is spawned */
  requiresApproval: boolean;
  /** Human-readable explanation for logs and the approval prompt */
  reason: string;
}

/**
 * Decide how to spawn an agent CLI. Never falls back to bypass: bypass only
 * happens when the policy for this backend is explicitly "bypass".
 */
export function resolveSpawnPermission(backend: Pick<AIBackend, "id" | "name" | "supportsAutoPermission">, policy: PermissionPolicy): SpawnPermission {
  const hasAuto = backend.supportsAutoPermission === true;
  switch (policy) {
    case "bypass":
      return { mode: "bypass", requiresApproval: false, reason: `${backend.name}: bypass explicitly enabled for this backend` };
    case "ask":
      return {
        mode: hasAuto ? "auto" : "default",
        requiresApproval: true,
        reason: `${backend.name}: permission mode "ask" requires approval before every run`,
      };
    case "auto":
    default:
      return hasAuto
        ? { mode: "auto", requiresApproval: false, reason: `${backend.name}: auto permission mode` }
        : {
          mode: "default",
          requiresApproval: true,
          reason: `${backend.name} has no auto permission mode, so each run needs approval`,
        };
  }
}
