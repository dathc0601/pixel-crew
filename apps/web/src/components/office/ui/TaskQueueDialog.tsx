"use client";

// P1.6: what is on the Lead's task board. Queued sub-tasks wait for a free dev;
// the list below shows who is working on what right now.

import { useMemo } from "react";
import type { WorkItem } from "@pixel-crew/shared";
import { sendCommand } from "@/lib/connection";
import { queuedWorkItems, useBossFlowStore } from "@/store/boss-flow-store";
import { useOfficeStore } from "@/store/office-store";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import { TERM_DIM, TERM_TEXT, TERM_TEXT_BRIGHT, TERM_SEM_RED, TERM_SEM_YELLOW, TERM_SEM_BLUE, TERM_BORDER } from "./termTheme";

const REASON_TEXT: Record<string, string> = {
  all_devs_busy: "Every dev is busy.",
  pinned_dev_busy: "Waiting for a specific dev.",
  no_devs: "There are no devs on the team.",
};

const ACTIVE = new Set(["assigned", "handing_off", "running"]);

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Row({ item, right }: { item: WorkItem; right?: React.ReactNode }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${TERM_BORDER}` }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ color: TERM_TEXT_BRIGHT, fontSize: 12, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.prompt}>
          {item.priority === "urgent" && <span style={{ color: TERM_SEM_RED, marginRight: 6 }}>URGENT</span>}
          {item.title}
        </span>
        {item.error && <span style={{ color: TERM_DIM, fontSize: 11 }}>{item.error}</span>}
      </span>
      {right}
    </li>
  );
}

export default function TaskQueueDialog({ open, onClose, canCancel }: { open: boolean; onClose: () => void; canCancel: boolean }) {
  const workItems = useBossFlowStore((s) => s.workItems);
  const leadWaiting = useBossFlowStore((s) => s.leadWaiting);
  const agents = useOfficeStore((s) => s.agents);
  const nameOf = (id: string | null) => (id ? agents.get(id)?.name ?? id : "");

  const queued = useMemo(() => queuedWorkItems(workItems), [workItems]);
  const active = useMemo(
    () => [...workItems.values()].filter((i) => i.origin === "lead" && ACTIVE.has(i.state)),
    [workItems],
  );

  return (
    <TermModal open={open} onClose={onClose} maxWidth={520} zIndex={120} title={`Task board (${queued.length} waiting)`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <section>
          <div style={{ color: TERM_SEM_YELLOW, fontSize: 11, letterSpacing: "0.06em", marginBottom: 4 }}>WAITING FOR A DEV</div>
          {queued.length === 0 ? (
            <div style={{ color: TERM_DIM, fontSize: 12 }}>Nothing is waiting.</div>
          ) : (
            <>
              {leadWaiting && leadWaiting.reason !== "none" && (
                <div style={{ color: TERM_DIM, fontSize: 11, marginBottom: 4 }}>{REASON_TEXT[leadWaiting.reason] ?? ""}</div>
              )}
              <ol style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="task-queue-list">
                {queued.map((item) => (
                  <Row
                    key={item.id}
                    item={item}
                    right={
                      <>
                        {item.preferredAgentId && (
                          <span style={{ color: TERM_SEM_BLUE, fontSize: 11 }}>{item.pinned ? "only " : "prefers "}{nameOf(item.preferredAgentId)}</span>
                        )}
                        <span style={{ color: TERM_DIM, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{ago(item.createdAt)}</span>
                        {canCancel && (
                          <TermButton size="sm" variant="dim" onClick={() => sendCommand({ type: "CANCEL_WORK_ITEM", workItemId: item.id })} aria-label={`Cancel ${item.title}`}>
                            cancel
                          </TermButton>
                        )}
                      </>
                    }
                  />
                ))}
              </ol>
            </>
          )}
        </section>
        <section>
          <div style={{ color: TERM_SEM_YELLOW, fontSize: 11, letterSpacing: "0.06em", marginBottom: 4 }}>IN PROGRESS</div>
          {active.length === 0 ? (
            <div style={{ color: TERM_DIM, fontSize: 12 }}>No dev is working on a sub-task.</div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {active.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  right={<span style={{ color: TERM_TEXT, fontSize: 11 }}>{item.selfWork ? "Lead (self)" : nameOf(item.assigneeId)}{item.state === "handing_off" ? " (being handed over)" : ""}</span>}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </TermModal>
  );
}
