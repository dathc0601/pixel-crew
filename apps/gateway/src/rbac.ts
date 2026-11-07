/**
 * Role-based command permissions for paired devices (owner / collaborator / spectator).
 * Owners may send everything; the others get a short read-mostly allowlist. Pairing,
 * devices and office settings commands are therefore owner-only.
 */
import type { UserRole } from "@pixel-crew/shared";

const ALLOWED: Record<UserRole, ReadonlySet<string>> = {
  owner: new Set(["*"]),
  collaborator: new Set(["PING", "SUGGEST", "LIST_PROJECTS", "LOAD_PROJECT"]),
  spectator: new Set(["PING", "LIST_PROJECTS", "LOAD_PROJECT"]),
};

export function isCommandAllowed(role: UserRole, commandType: string): boolean {
  const set = ALLOWED[role];
  return !!set && (set.has("*") || set.has(commandType));
}
