// Boss → Lead → Dev flow state (plan P1.4–P1.6, P1.8): work items, the Lead's queue,
// office settings and demo mode. Kept out of office-store.ts on purpose; the office
// store forwards every event here first (handleBossFlowEvent).
//
// Persistent state lives in the zustand store. One-shot scene cues (HANDOFF, LEAD_*)
// go to listeners registered with onBossFlowCue, so a late subscriber never replays
// old walks (§7.7: in-flight hand-offs are skipped on reconnect).

import { create } from "zustand";
import type {
  GatewayEvent,
  HandoffEvent,
  LeadSelfWorkEvent,
  LeadSubagentStartedEvent,
  LeadWaitingEvent,
  OfficeConfig,
  WorkItem,
} from "@pixel-crew/shared";

export type BossFlowCue =
  | (HandoffEvent & { receivedAt: number })
  | LeadSelfWorkEvent
  | LeadSubagentStartedEvent;

interface BossFlowState {
  /** Every work item the daemon reported (rebuilt from the PING replay on reconnect) */
  workItems: Map<string, WorkItem>;
  /** Last LEAD_WAITING (reason "none" = nothing waits) */
  leadWaiting: Omit<LeadWaitingEvent, "type"> | null;
  /** Effective office config (owner sessions only) */
  officeConfig: OfficeConfig | null;
  /** Why the last GET/SET_OFFICE_CONFIG was rejected */
  officeConfigError: string | null;
  /** config.json currently fails validation (last valid values stay in effect) */
  officeConfigFileError: string | null;
  /** The daemon runs scripted fake agents (GATEWAY_INFO.demo) */
  demo: boolean;
  /** Result of the last REVOKE_SESSIONS */
  revokedSessions: number | null;
}

export const useBossFlowStore = create<BossFlowState>(() => ({
  workItems: new Map(),
  leadWaiting: null,
  officeConfig: null,
  officeConfigError: null,
  officeConfigFileError: null,
  demo: false,
  revokedSessions: null,
}));

type CueListener = (cue: BossFlowCue) => void;
const cueListeners = new Set<CueListener>();

/** Subscribe to one-shot scene cues. Returns the unsubscribe function. */
export function onBossFlowCue(listener: CueListener): () => void {
  cueListeners.add(listener);
  return () => cueListeners.delete(listener);
}

function emitCue(cue: BossFlowCue): void {
  for (const l of cueListeners) {
    try {
      l(cue);
    } catch (err) {
      console.error("[BossFlow] cue listener failed:", err);
    }
  }
}

/**
 * Handle the Boss-flow events. Returns true when the event belongs only to this
 * store; false lets the office store handle it too (e.g. AGENTS_SYNC).
 */
export function handleBossFlowEvent(event: GatewayEvent): boolean {
  const set = useBossFlowStore.setState;
  switch (event.type) {
    case "AGENTS_SYNC":
      // First event of a PING replay: forget items, the replay re-sends the live pool
      set({ workItems: new Map() });
      return false;
    case "WORK_ITEM_UPDATED": {
      const workItems = new Map(useBossFlowStore.getState().workItems);
      workItems.set(event.item.id, event.item);
      set({ workItems });
      return true;
    }
    case "LEAD_WAITING":
      set({ leadWaiting: { leadId: event.leadId, queueLength: event.queueLength, reason: event.reason } });
      return true;
    case "HANDOFF":
      emitCue({ ...event, receivedAt: typeof performance !== "undefined" ? performance.now() : Date.now() });
      return true;
    case "LEAD_SELF_WORK":
    case "LEAD_SUBAGENT_STARTED":
      emitCue(event);
      return true;
    case "OFFICE_CONFIG":
      set({
        officeConfig: event.config,
        officeConfigError: event.error ?? null,
        officeConfigFileError: event.fileError ?? null,
      });
      return true;
    case "GATEWAY_INFO":
      set({ demo: event.demo });
      return true;
    case "SESSIONS_REVOKED":
      set({ revokedSessions: event.revoked });
      return true;
    default:
      return false;
  }
}

// ── Derived views ──────────────────────────────────────────────

const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** Sub-tasks waiting in the shared pool for a free dev (excludes items held after a restart). */
export function queuedWorkItems(items: Map<string, WorkItem>): WorkItem[] {
  return [...items.values()]
    .filter((i) => i.origin === "lead" && i.state === "queued" && !i.held)
    .sort((a, b) => (a.priority === b.priority ? a.createdAt - b.createdAt : a.priority === "urgent" ? -1 : 1));
}

/** Items restored after a daemon restart that wait for RESUME_POOL. */
export function heldWorkItems(items: Map<string, WorkItem>): WorkItem[] {
  return [...items.values()].filter((i) => i.held && !TERMINAL.has(i.state));
}
