import type { Command, GatewayEvent, OfficeConfig, UserRole } from "@pixel-crew/shared";
import type { OfficeConfigManager } from "./office-config.js";

type OfficeConfigCommand = Extract<Command, { type: "GET_OFFICE_CONFIG" | "SET_OFFICE_CONFIG" }>;

export interface OfficeConfigCommandDeps {
  manager: OfficeConfigManager;
  /** Send to every connected client */
  broadcast: (event: GatewayEvent) => void;
  /** Send to the calling client only */
  reply: (event: GatewayEvent) => void;
}

export function isOfficeConfigCommand(cmd: Command): cmd is OfficeConfigCommand {
  return cmd.type === "GET_OFFICE_CONFIG" || cmd.type === "SET_OFFICE_CONFIG";
}

export function officeConfigEvent(manager: OfficeConfigManager, error?: string): GatewayEvent {
  const config: OfficeConfig = manager.get();
  return {
    type: "OFFICE_CONFIG",
    config,
    ...(error ? { error } : {}),
    ...(manager.error ? { fileError: manager.error } : {}),
  };
}

/**
 * GET_OFFICE_CONFIG / SET_OFFICE_CONFIG. Owner sessions only: anyone else gets an
 * OFFICE_CONFIG reply with `error` and nothing is read back or written.
 * A successful change is broadcast to every client through the manager's "change"
 * event (wired in index.ts), which also covers manual edits of config.json.
 */
export function handleOfficeConfigCommand(cmd: OfficeConfigCommand, meta: { role: UserRole }, deps: OfficeConfigCommandDeps): void {
  const { manager } = deps;
  if (meta.role !== "owner") {
    console.log(`[Config] Rejected ${cmd.type} from a ${meta.role} session`);
    deps.reply({ type: "OFFICE_CONFIG", config: manager.get(), error: "Only the owner can read or change office settings" });
    return;
  }
  if (cmd.type === "GET_OFFICE_CONFIG") {
    deps.reply(officeConfigEvent(manager));
    return;
  }
  const result = manager.update(cmd.office);
  if (!result.ok) {
    console.log(`[Config] SET_OFFICE_CONFIG rejected: ${result.error}`);
    deps.reply(officeConfigEvent(manager, result.error));
    return;
  }
  console.log(`[Config] Office config updated by the owner${result.changed ? "" : " (no change)"}`);
  // A real change is broadcast via the "change" listener; still answer the caller otherwise
  if (!result.changed) deps.reply(officeConfigEvent(manager));
}

/** Broadcast every effective change (UI edit or hand edit picked up by the watcher). */
export function broadcastOfficeConfigChanges(manager: OfficeConfigManager, broadcast: (event: GatewayEvent) => void): () => void {
  const onChange = () => broadcast(officeConfigEvent(manager));
  manager.on("change", onChange);
  return () => manager.off("change", onChange);
}
