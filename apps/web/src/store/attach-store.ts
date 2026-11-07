// Attached Claude Code sessions (Phase 2a): pending Join/Leave requests and their errors.
// The membership itself arrives as AGENT_CREATED (attached / isExternal) in office-store;
// this store only tracks what the owner just clicked. office-store forwards every event
// here first (handleAttachEvent).
import { create } from "zustand";
import type { AttachMode, GatewayEvent } from "@pixel-crew/shared";
import { sendCommand } from "@/lib/connection";
import { OFFLINE_NOT_SENT, pushNotice } from "./connection-store";

interface AttachState {
  /** agentId → the request in flight */
  pending: Map<string, "attach" | "detach">;
  /** agentId → why the last request was refused */
  errors: Map<string, string>;
}

export const useAttachStore = create<AttachState>(() => ({
  pending: new Map(),
  errors: new Map(),
}));

function patch(agentId: string, pending: "attach" | "detach" | null, error: string | null): void {
  useAttachStore.setState((s) => {
    const p = new Map(s.pending);
    const e = new Map(s.errors);
    if (pending) p.set(agentId, pending); else p.delete(agentId);
    if (error) e.set(agentId, error); else e.delete(agentId);
    return { pending: p, errors: e };
  });
}

export function requestAttach(agentId: string, mode: AttachMode): void {
  patch(agentId, "attach", null);
  if (!sendCommand({ type: "ATTACH_EXTERNAL", agentId, role: "dev", mode })) patch(agentId, null, OFFLINE_NOT_SENT);
}

export function requestDetach(agentId: string): void {
  patch(agentId, "detach", null);
  if (!sendCommand({ type: "DETACH_AGENT", agentId })) patch(agentId, null, OFFLINE_NOT_SENT);
}

/** The gateway refuses ATTACH_EXTERNAL until a team exists ("Hire a team first: …"). */
export function needsTeam(error: string): boolean {
  return /hire a team/i.test(error);
}

/** Returns true when the event was handled here (ATTACH_RESULT). */
export function handleAttachEvent(event: GatewayEvent): boolean {
  if (event.type !== "ATTACH_RESULT") return false;
  const error = event.ok ? null : (event.error ?? "Request refused");
  patch(event.agentId, null, error);
  // Also as a notice: the pane that sent it may be closed or scrolled away by now
  if (error) {
    const what = event.action === "detach" ? "Leave team" : "Join team";
    pushNotice(`${what} refused: ${error}`, { action: needsTeam(error) ? "hire-team" : undefined });
  }
  return true;
}
