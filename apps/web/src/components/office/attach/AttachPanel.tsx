"use client";

// Join team / Leave team for Claude Code sessions the owner started in a terminal
// (Phase 2a, docs/attach-sessions.md). Rendered at the top of the agent pane; nothing
// shows for agents that are neither attachable nor attached.

import { useState } from "react";
import type { AttachMode } from "@pixel-crew/shared";
import { useOfficeStore } from "@/store/office-store";
import { requestAttach, requestDetach, useAttachStore } from "@/store/attach-store";
import TermButton from "../ui/primitives/TermButton";
import { TERM_DIM, TERM_SEM_PURPLE, TERM_SEM_RED, TERM_TEXT } from "../ui/termTheme";
import { ATTACH_MODE_LABEL } from "./attachLabels";

export default function AttachPanel({ agentId, isOwner }: { agentId: string; isOwner: boolean }) {
  const agent = useOfficeStore((s) => s.agents.get(agentId));
  const pending = useAttachStore((s) => s.pending.get(agentId));
  const error = useAttachStore((s) => s.errors.get(agentId));
  const options = agent?.isExternal ? agent.attachOptions ?? [] : [];
  const [picked, setPicked] = useState<AttachMode | null>(null);

  if (!agent) return null;

  if (agent.attached) {
    return (
      <div className="px-3 py-1.5 bg-term-panel shrink-0 flex items-center gap-2 flex-wrap font-mono text-term" data-testid="attach-panel">
        <span
          className="text-[9px] font-bold px-[4px] leading-[15px] rounded-sm shrink-0 uppercase tracking-wide"
          style={{ color: TERM_SEM_PURPLE, border: `1px solid ${TERM_SEM_PURPLE}55` }}
        >attached · {agent.attachMode ?? "fork"}</span>
        <span className="flex-1 min-w-[12rem]" style={{ color: TERM_TEXT, opacity: 0.75 }}>{agent.attachNote}</span>
        {isOwner && (
          <TermButton size="sm" variant="dim" disabled={pending === "detach"} onClick={() => requestDetach(agentId)}>
            {pending === "detach" ? "Leaving…" : "Leave team"}
          </TermButton>
        )}
        {error && <span className="w-full" style={{ color: TERM_SEM_RED }}>{error}</span>}
      </div>
    );
  }

  if (options.length === 0) return null;
  const mode = picked && options.some((o) => o.mode === picked) ? picked : options[0].mode;
  const note = options.find((o) => o.mode === mode)?.note ?? "";

  return (
    <div className="px-3 py-2 bg-term-panel shrink-0 font-mono text-term flex flex-col gap-1.5" data-testid="attach-panel">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="tracking-wide" style={{ color: TERM_DIM }}>TEAM</span>
        {options.length > 1 && (
          <div role="radiogroup" aria-label="How tasks reach this session" className="flex gap-1">
            {options.map((o) => (
              <button
                key={o.mode}
                role="radio"
                aria-checked={o.mode === mode}
                onClick={() => setPicked(o.mode)}
                className="px-2 leading-[22px] rounded-sm"
                style={{
                  color: o.mode === mode ? TERM_SEM_PURPLE : TERM_TEXT,
                  border: `1px solid ${o.mode === mode ? `${TERM_SEM_PURPLE}88` : `${TERM_DIM}55`}`,
                }}
              >{ATTACH_MODE_LABEL[o.mode]}</button>
            ))}
          </div>
        )}
        <span className="flex-1" />
        {isOwner ? (
          <TermButton size="sm" variant="primary" disabled={pending === "attach"} onClick={() => requestAttach(agentId, mode)}>
            {pending === "attach" ? "Joining…" : "Join team"}
          </TermButton>
        ) : (
          <span style={{ color: TERM_DIM }}>Only the owner can add it to the team</span>
        )}
      </div>
      <div style={{ color: TERM_TEXT, opacity: 0.75 }}>{note}</div>
      {error && <div style={{ color: TERM_SEM_RED }}>{error}</div>}
    </div>
  );
}
