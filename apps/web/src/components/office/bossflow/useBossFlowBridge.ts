"use client";

// Bridges the Boss-flow store to the scene (P1.4–P1.6): Boss character, hand-off
// walks, the Lead's queue board, self-work / subagent cues, and the reconnect snap.

import { useEffect } from "react";
import { useOfficeStore } from "@/store/office-store";
import { onBossFlowCue, queuedWorkItems, useBossFlowStore } from "@/store/boss-flow-store";
import { sendCommand } from "@/lib/connection";
import type { SceneAdapter } from "../scene/SceneAdapter";

const BOSS_LABEL_COLOR = "#b8860b";

function leadIdFromStore(): string | null {
  for (const a of useOfficeStore.getState().agents.values()) if (a.isTeamLead) return a.agentId;
  return null;
}

export function useBossFlowBridge(adapter: SceneAdapter | null): void {
  // The Boss sits in the scene for as long as the scene exists
  useEffect(() => {
    if (!adapter) return;
    adapter.setBoss({ label: "BOSS", labelColor: BOSS_LABEL_COLOR });
    return () => adapter.setBoss(null);
  }, [adapter]);

  // One-shot cues: walks and Lead activity
  useEffect(() => {
    if (!adapter) return;
    return onBossFlowCue((cue) => {
      switch (cue.type) {
        case "HANDOFF":
          void adapter.playHandoff(cue.fromId, cue.toId, { durationMs: cue.durationMs, label: cue.label, receivedAt: cue.receivedAt });
          break;
        case "LEAD_SELF_WORK": {
          const item = useBossFlowStore.getState().workItems.get(cue.workItemId);
          adapter.showSpeechBubble(cue.leadId, item ? `I'll do it: ${item.title}` : "I'll do this one myself");
          break;
        }
        case "LEAD_SUBAGENT_STARTED":
          adapter.showSubagent?.(cue.leadId);
          adapter.showSpeechBubble(cue.leadId, `Subagent: ${cue.description}`);
          break;
      }
    });
  }, [adapter]);

  // Queue board next to the Lead: one paper per sub-task waiting for a dev
  useEffect(() => {
    if (!adapter?.setTaskBoard) return;
    const sync = () => {
      const { workItems, leadWaiting } = useBossFlowStore.getState();
      const count = queuedWorkItems(workItems).length;
      adapter.setTaskBoard!(leadWaiting?.leadId ?? leadIdFromStore(), count);
    };
    sync();
    const unsubFlow = useBossFlowStore.subscribe(sync);
    // The Lead may join after the items arrive
    const unsubOffice = useOfficeStore.subscribe((s, prev) => { if (s.agents !== prev.agents) sync(); });
    return () => { unsubFlow(); unsubOffice(); };
  }, [adapter]);

  // Reconnect (§7.7): skip in-flight walks and put everyone back on their seat.
  // Owners also (re)load the office settings.
  useEffect(() => {
    let wasConnected = useOfficeStore.getState().connected;
    let everConnected = wasConnected;
    const onConnect = () => {
      if (useOfficeStore.getState().role === "owner") sendCommand({ type: "GET_OFFICE_CONFIG" });
    };
    if (wasConnected) onConnect();
    return useOfficeStore.subscribe((s) => {
      if (s.connected === wasConnected) return;
      wasConnected = s.connected;
      if (!s.connected) return;
      if (everConnected) adapter?.snapToSeats?.();
      everConnected = true;
      onConnect();
    });
  }, [adapter]);
}
