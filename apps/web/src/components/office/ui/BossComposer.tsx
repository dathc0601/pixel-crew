"use client";

// P1.5: the Boss hands the Team Lead a task (BOSS_ASSIGN). The per-task toggles can
// only narrow the office's Lead policy; see bossflow/policy.ts.

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_OFFICE_CONFIG } from "@pixel-crew/shared";
import { sendCommand } from "@/lib/connection";
import { useBossFlowStore } from "@/store/boss-flow-store";
import { useOfficeStore } from "@/store/office-store";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import { TermTextArea } from "./primitives/TermInput";
import { TERM_DIM, TERM_TEXT, TERM_SEM_YELLOW, TERM_SEM_RED } from "./termTheme";
import {
  defaultToggle,
  describeEffectivePolicy,
  flagFor,
  selfWorkMode,
  subagentsMode,
  toggleEnabled,
  type ToggleMode,
} from "../bossflow/policy";

const DRAFT_KEY = "pixel-crew-boss-draft";

function Toggle({ label, hint, checked, disabled, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: TERM_SEM_YELLOW }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ color: TERM_TEXT, fontSize: 12 }}>{label}</span>
        {hint && <span style={{ color: TERM_DIM, fontSize: 11 }}>{hint}</span>}
      </span>
    </label>
  );
}

function hintFor(mode: ToggleMode, urgent: boolean): string {
  if (mode === "off_by_office") return "Off in office settings.";
  if (mode === "urgent_opt_in") return urgent ? "Office allows this for urgent tasks you opt in." : "Office allows this only for urgent tasks.";
  return "Allowed by office settings; untick to forbid it for this task.";
}

export default function BossComposer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const officeConfig = useBossFlowStore((s) => s.officeConfig) ?? DEFAULT_OFFICE_CONFIG;
  const hasLead = useOfficeStore((s) => [...s.agents.values()].some((a) => a.isTeamLead));
  const connected = useOfficeStore((s) => s.connected);
  const swMode = selfWorkMode(officeConfig);
  const saMode = subagentsMode(officeConfig);

  const [prompt, setPrompt] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [selfWorkOn, setSelfWorkOn] = useState(defaultToggle(swMode));
  const [subagentsOn, setSubagentsOn] = useState(defaultToggle(saMode));

  // Fresh defaults each time it opens (the office policy may have changed); keep the draft text
  useEffect(() => {
    if (!open) return;
    setUrgent(false);
    setSelfWorkOn(defaultToggle(swMode));
    setSubagentsOn(defaultToggle(saMode));
    try { setPrompt(localStorage.getItem(DRAFT_KEY) ?? ""); } catch { /* storage unavailable */ }
  }, [open, swMode, saMode]);

  const policyLine = useMemo(
    () => describeEffectivePolicy(officeConfig, urgent, selfWorkOn, subagentsOn),
    [officeConfig, urgent, selfWorkOn, subagentsOn],
  );

  const canSend = prompt.trim().length > 0 && hasLead && connected;

  const submit = () => {
    if (!canSend) return;
    const allowLeadSelfWork = flagFor(swMode, selfWorkOn, urgent);
    const allowSubagents = flagFor(saMode, subagentsOn, urgent);
    sendCommand({
      type: "BOSS_ASSIGN",
      prompt: prompt.trim(),
      urgent,
      ...(allowLeadSelfWork !== undefined ? { allowLeadSelfWork } : {}),
      ...(allowSubagents !== undefined ? { allowSubagents } : {}),
    });
    setPrompt("");
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
    onClose();
  };

  return (
    <TermModal
      open={open}
      onClose={onClose}
      maxWidth={520}
      zIndex={120}
      title="Give the Lead a task"
      footer={
        <>
          <TermButton variant="primary" onClick={submit} disabled={!canSend} style={{ flex: 1, fontWeight: 700 }}>
            Hand it to the Lead
          </TermButton>
          <TermButton variant="dim" onClick={onClose}>Cancel</TermButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <TermTextArea
          autoFocus
          rows={4}
          value={prompt}
          placeholder="What should the team build?"
          aria-label="Task for the Team Lead"
          onChange={(e) => {
            setPrompt(e.target.value);
            try { localStorage.setItem(DRAFT_KEY, e.target.value); } catch { /* storage unavailable */ }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          style={{ minHeight: 88, resize: "vertical" }}
        />
        {!hasLead && (
          <div style={{ color: TERM_SEM_RED, fontSize: 12 }}>Hire a team first: the Boss hands work to the Team Lead.</div>
        )}
        <Toggle label="Urgent" hint="Goes to the front of the queue." checked={urgent} onChange={setUrgent} />
        <Toggle
          label="Allow Lead to work itself"
          hint={hintFor(swMode, urgent)}
          checked={toggleEnabled(swMode, urgent) && selfWorkOn}
          disabled={!toggleEnabled(swMode, urgent)}
          onChange={setSelfWorkOn}
        />
        <Toggle
          label="Allow subagents"
          hint={hintFor(saMode, urgent)}
          checked={toggleEnabled(saMode, urgent) && subagentsOn}
          disabled={!toggleEnabled(saMode, urgent)}
          onChange={setSubagentsOn}
        />
        <div style={{ color: TERM_DIM, fontSize: 11, borderTop: "1px solid var(--term-border, #2c2618)", paddingTop: 8 }} data-testid="boss-policy-line">
          {policyLine}
        </div>
      </div>
    </TermModal>
  );
}
