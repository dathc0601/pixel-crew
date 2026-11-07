"use client";

// Pending approvals in one place (P5.3), so the owner can approve from a phone without
// first finding the agent's pane. Owners get Approve / Deny; other roles only see that
// an approval is waiting (APPROVAL_DECISION is owner-only on the daemon).

import { useMemo } from "react";
import { sendCommand } from "@/lib/connection";
import { useOfficeStore } from "@/store/office-store";
import { TERM_PANEL, TERM_TEXT, TERM_DIM, TERM_SEM_YELLOW, TERM_SEM_RED, TERM_SEM_GREEN } from "./termTheme";

const btn: React.CSSProperties = {
  minHeight: 44, minWidth: 88, padding: "0 14px", fontFamily: "monospace", fontSize: 13, fontWeight: 700,
  cursor: "pointer", background: "transparent",
};

export default function ApprovalsTray({ isOwner }: { isOwner: boolean }) {
  const agents = useOfficeStore((s) => s.agents);
  const pending = useMemo(
    () => [...agents.values()].filter((a) => a.pendingApproval).map((a) => ({ agentId: a.agentId, name: a.name, ...a.pendingApproval! })),
    [agents],
  );
  if (pending.length === 0) return null;
  const first = pending[0];
  const risky = first.riskLevel === "high";

  return (
    <div
      role="alertdialog"
      aria-label={`${pending.length} approval${pending.length === 1 ? "" : "s"} waiting`}
      data-testid="approvals-tray"
      style={{
        position: "fixed", top: "calc(8px + env(safe-area-inset-top))", left: "50%", transform: "translateX(-50%)", zIndex: 62,
        width: "min(560px, calc(100vw - 16px))", boxSizing: "border-box",
        background: TERM_PANEL, border: `2px solid ${risky ? TERM_SEM_RED : TERM_SEM_YELLOW}`, padding: "10px 12px",
        boxShadow: "0 6px 20px rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", gap: 8,
      }}
    >
      <div style={{ color: risky ? TERM_SEM_RED : TERM_SEM_YELLOW, fontSize: 12, fontFamily: "monospace", fontWeight: 700 }}>
        ▲ {first.name} needs approval{pending.length > 1 ? ` (+${pending.length - 1} more)` : ""}
      </div>
      <div style={{ color: TERM_TEXT, fontSize: 13 }}>{first.title}</div>
      {first.summary && (
        <div style={{ color: TERM_DIM, fontSize: 12, maxHeight: 96, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{first.summary}</div>
      )}
      {isOwner ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...btn, color: TERM_SEM_GREEN, border: `1px solid ${TERM_SEM_GREEN}` }}
            onClick={() => sendCommand({ type: "APPROVAL_DECISION", approvalId: first.approvalId, decision: "yes" })}
          >
            Approve
          </button>
          <button
            type="button"
            style={{ ...btn, color: TERM_SEM_RED, border: `1px solid ${TERM_SEM_RED}` }}
            onClick={() => sendCommand({ type: "APPROVAL_DECISION", approvalId: first.approvalId, decision: "no" })}
          >
            Deny
          </button>
        </div>
      ) : (
        <div style={{ color: TERM_DIM, fontSize: 12 }}>Waiting for the owner to decide.</div>
      )}
    </div>
  );
}
