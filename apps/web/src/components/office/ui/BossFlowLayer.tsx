"use client";

// Everything the Boss flow adds to the office page (P1.5, P1.6, P1.8), mounted with
// one line from app/office/page.tsx: the DEMO badge, the Boss / task-board /
// settings buttons, the "resume queued tasks" prompt, and their dialogs.

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { sendCommand } from "@/lib/connection";
import { heldWorkItems, queuedWorkItems, useBossFlowStore } from "@/store/boss-flow-store";
import { useOfficeStore } from "@/store/office-store";
import type { SceneAdapter, SceneObjectId } from "../scene/SceneAdapter";
import { useBossFlowBridge } from "../bossflow/useBossFlowBridge";
import { useSceneInset } from "../scene/sceneInsets";
import TermButton from "./primitives/TermButton";
import ApprovalsTray from "./ApprovalsTray";
import { TERM_PANEL, TERM_BORDER, TERM_TEXT, TERM_DIM, TERM_SEM_YELLOW } from "./termTheme";

const BossComposer = dynamic(() => import("./BossComposer"), { ssr: false });
const TaskQueueDialog = dynamic(() => import("./TaskQueueDialog"), { ssr: false });
const OfficeSettingsPanel = dynamic(() => import("./OfficeSettingsPanel"), { ssr: false });

const chipStyle: React.CSSProperties = {
  fontSize: 10, padding: "4px 8px", fontFamily: "monospace", letterSpacing: "0.05em",
  border: `1px solid ${TERM_BORDER}`, background: TERM_PANEL, color: TERM_TEXT, cursor: "pointer",
};

export default function BossFlowLayer({ adapter, isOwner }: { adapter: SceneAdapter | null; isOwner: boolean }) {
  useBossFlowBridge(adapter);

  const demo = useBossFlowStore((s) => s.demo);
  const workItems = useBossFlowStore((s) => s.workItems);
  const connected = useOfficeStore((s) => s.connected);
  const queuedCount = useMemo(() => queuedWorkItems(workItems).length, [workItems]);
  const held = useMemo(() => heldWorkItems(workItems), [workItems]);

  const chipsInsetRef = useSceneInset("bottom");
  const [composerOpen, setComposerOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const openComposer = useCallback(() => {
    if (!isOwner) {
      setNotice("Only the owner can give the team work.");
      return;
    }
    setComposerOpen(true);
  }, [isOwner]);

  // Clicks on the Boss and the task board inside the scene
  useEffect(() => {
    if (!adapter?.setObjectClickHandler) return;
    adapter.setObjectClickHandler((id: SceneObjectId) => {
      if (id === "boss") openComposer();
      else setQueueOpen(true);
    });
    return () => adapter.setObjectClickHandler?.(null);
  }, [adapter, openComposer]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <>
      {/* Boss-flow shortcuts: work without opening a side panel */}
      <div ref={chipsInsetRef} className="pc-bossflow-chips" style={{ position: "fixed", bottom: "calc(64px + env(safe-area-inset-bottom))", left: 12, zIndex: 40, display: "flex", gap: 6, alignItems: "flex-start" }}>
        {demo && (
          <div
            role="status"
            title="Demo mode: every agent is a scripted fake. No AI CLI runs and no tokens are spent."
            style={{
              padding: "4px 10px", fontSize: 11, fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.12em",
              color: "#1a0e00", background: TERM_SEM_YELLOW, border: "2px solid #1a0e00", boxShadow: "2px 2px 0 rgba(0,0,0,0.6)",
            }}
            data-testid="demo-badge"
          >
            DEMO · scripted agents, no tokens
          </div>
        )}
        {isOwner && (
          <button type="button" style={{ ...chipStyle, color: TERM_SEM_YELLOW, borderColor: `${TERM_SEM_YELLOW}80` }} onClick={openComposer} disabled={!connected}>
            BOSS: NEW TASK
          </button>
        )}
        <button type="button" style={chipStyle} onClick={() => setQueueOpen(true)} aria-label={`Task board, ${queuedCount} waiting`}>
          TASK BOARD{queuedCount > 0 ? ` (${queuedCount})` : ""}
        </button>
        {isOwner && (
          <button type="button" style={chipStyle} onClick={() => setSettingsOpen(true)}>
            OFFICE SETTINGS
          </button>
        )}
      </div>

      {/* Work restored after a daemon restart waits for the owner (no tokens spent by surprise) */}
      {isOwner && held.length > 0 && (
        <div
          role="alertdialog"
          aria-label="Resume queued tasks"
          style={{
            position: "fixed", top: 48, left: "50%", transform: "translateX(-50%)", zIndex: 61,
            background: TERM_PANEL, border: `1px solid ${TERM_SEM_YELLOW}`, padding: "10px 12px",
            display: "flex", alignItems: "center", gap: 10, maxWidth: "calc(100vw - 32px)", boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          <span style={{ color: TERM_TEXT, fontSize: 12 }}>
            Resume {held.length} queued {held.length === 1 ? "task" : "tasks"} from before the restart?
          </span>
          <TermButton size="sm" variant="primary" onClick={() => sendCommand({ type: "RESUME_POOL" })}>Resume</TermButton>
          <TermButton
            size="sm"
            variant="dim"
            onClick={() => {
              // Cancelling a Boss item also drops its sub-tasks, so only send the rest separately
              const heldIds = new Set(held.map((i) => i.id));
              for (const item of held) {
                if (item.origin === "lead" && item.parentId && heldIds.has(item.parentId)) continue;
                sendCommand({ type: "CANCEL_WORK_ITEM", workItemId: item.id });
              }
            }}
          >
            Discard
          </TermButton>
        </div>
      )}

      <ApprovalsTray isOwner={isOwner} />

      {notice && (
        <div role="status" style={{ position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)", zIndex: 61, background: TERM_PANEL, border: `1px solid ${TERM_BORDER}`, color: TERM_DIM, fontSize: 12, padding: "6px 10px" }}>
          {notice}
        </div>
      )}

      {composerOpen && <BossComposer open={composerOpen} onClose={() => setComposerOpen(false)} />}
      {queueOpen && <TaskQueueDialog open={queueOpen} onClose={() => setQueueOpen(false)} canCancel={isOwner} />}
      {isOwner && settingsOpen && <OfficeSettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
