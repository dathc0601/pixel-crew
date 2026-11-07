// Attached Claude Code sessions (Phase 2a): pending Join/Leave requests and their errors.
// The membership itself arrives as AGENT_CREATED (attached / isExternal) in office-store;
// this store only tracks what the owner just clicked. office-store forwards every event
// here first (handleAttachEvent).
import { create } from "zustand";
import type { AttachMode, GatewayEvent } from "@pixel-crew/shared";
import { sendCommand } from "@/lib/connection";

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
  sendCommand({ type: "ATTACH_EXTERNAL", agentId, role: "dev", mode });
}

export function requestDetach(agentId: string): void {
  patch(agentId, "detach", null);
  sendCommand({ type: "DETACH_AGENT", agentId });
}

/** Returns true when the event was handled here (ATTACH_RESULT). */
export function handleAttachEvent(event: GatewayEvent): boolean {
  if (event.type !== "ATTACH_RESULT") return false;
  patch(event.agentId, null, event.ok ? null : (event.error ?? "Request refused"));
  return true;
}
