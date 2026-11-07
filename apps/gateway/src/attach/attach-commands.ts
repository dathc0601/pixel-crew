import type { Command, GatewayEvent, UserRole } from "@pixel-crew/shared";
import type { AttachManager, ExternalSession } from "./attach-manager.js";

type AttachCommand = Extract<Command, { type: "ATTACH_EXTERNAL" | "DETACH_AGENT" }>;

export interface AttachCommandDeps {
  manager: AttachManager;
  /** External sessions the gateway currently shows */
  external: (agentId: string) => ExternalSession | undefined;
  /** Reply to the calling client only */
  reply: (event: GatewayEvent) => void;
  /** Stop showing the session's own terminal output while it works for the team */
  onAttached?: (agentId: string) => void;
}

export function isAttachCommand(cmd: Command): cmd is AttachCommand {
  return cmd.type === "ATTACH_EXTERNAL" || cmd.type === "DETACH_AGENT";
}

/**
 * ATTACH_EXTERNAL / DETACH_AGENT. Owner sessions only: anyone else gets an ATTACH_RESULT
 * with an error and nothing changes. Success shows up for everyone as AGENT_CREATED
 * (attached member, or external again); the caller also gets ATTACH_RESULT ok.
 */
export function handleAttachCommand(cmd: AttachCommand, meta: { role: UserRole }, deps: AttachCommandDeps): void {
  const action = cmd.type === "ATTACH_EXTERNAL" ? "attach" : "detach";
  const reject = (error: string) => {
    console.log(`[Attach] ${cmd.type} ${cmd.agentId} rejected: ${error}`);
    deps.reply({ type: "ATTACH_RESULT", agentId: cmd.agentId, action, ok: false, error });
  };
  if (meta.role !== "owner") return reject("Only the owner can add sessions to the team or remove them.");

  if (cmd.type === "ATTACH_EXTERNAL") {
    const ext = deps.external(cmd.agentId);
    if (!ext) return reject("That session is not in the office any more (it may have exited).");
    const result = deps.manager.attach(ext, cmd.mode ?? "fork");
    if (!result.ok) return reject(result.error);
    deps.onAttached?.(cmd.agentId);
    deps.reply({ type: "ATTACH_RESULT", agentId: cmd.agentId, action, ok: true });
    return;
  }

  if (!deps.manager.isAttached(cmd.agentId)) return reject("That agent is not an attached session.");
  deps.manager.detach(cmd.agentId);
  deps.reply({ type: "ATTACH_RESULT", agentId: cmd.agentId, action, ok: true });
}
