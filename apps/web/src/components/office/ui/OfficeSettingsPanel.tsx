"use client";

// Owner-only office settings (owner decisions §0.3, §0.4): Lead policy, hand-off
// timing and the permission mode. Reads/writes config.json through GET/SET_OFFICE_CONFIG
// and follows OFFICE_CONFIG broadcasts, so hand edits of the file show up live.

import { useEffect, useRef, useState } from "react";
import { DEFAULT_OFFICE_CONFIG, HANDOFF_MAX_MS, type OfficeConfig } from "@pixel-crew/shared/client";
import { sendCommand } from "@/lib/connection";
import { useBossFlowStore } from "@/store/boss-flow-store";
import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";
import { TERM_DIM, TERM_TEXT, TERM_SEM_RED, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SURFACE, TERM_BORDER, TERM_TEXT_BRIGHT } from "./termTheme";

type Patch = Record<string, unknown>;

const SELF_WORK_OPTIONS: Array<{ value: OfficeConfig["lead"]["selfWork"]; label: string }> = [
  { value: "never", label: "Never (delegates only)" },
  { value: "urgent_only", label: "Only urgent tasks the Boss opts in" },
  { value: "when_no_dev_after_wait", label: "When no dev is free after the wait" },
];
const SUBAGENT_OPTIONS: Array<{ value: OfficeConfig["lead"]["subagents"]; label: string }> = [
  { value: "never", label: "Never" },
  { value: "urgent_only", label: "Only urgent tasks the Boss opts in" },
  { value: "when_all_devs_busy", label: "When every dev is busy" },
  { value: "allowed", label: "Always allowed" },
];

function set(patch: Patch) {
  sendCommand({ type: "SET_OFFICE_CONFIG", office: patch });
}

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "6px 8px", fontSize: 12, fontFamily: "inherit",
  background: TERM_SURFACE, color: TERM_TEXT_BRIGHT, border: `1px solid ${TERM_BORDER}`,
};

function Field({ label, htmlFor, onReset, isDefault, children, hint }: {
  label: string;
  htmlFor: string;
  onReset: () => void;
  isDefault: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label htmlFor={htmlFor} style={{ flex: 1, color: TERM_TEXT, fontSize: 12 }}>{label}</label>
        <button
          type="button"
          onClick={onReset}
          disabled={isDefault}
          style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: isDefault ? TERM_DIM : TERM_SEM_YELLOW, cursor: isDefault ? "default" : "pointer", textDecoration: isDefault ? "none" : "underline" }}
        >
          {isDefault ? "default" : "reset to default"}
        </button>
      </div>
      {children}
      {hint && <div style={{ color: TERM_DIM, fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

export default function OfficeSettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useBossFlowStore((s) => s.officeConfig);
  const error = useBossFlowStore((s) => s.officeConfigError);
  const fileError = useBossFlowStore((s) => s.officeConfigFileError);
  const revoked = useBossFlowStore((s) => s.revokedSessions);
  const cfg = config ?? DEFAULT_OFFICE_CONFIG;
  const D = DEFAULT_OFFICE_CONFIG;

  // Slider/number drafts follow the daemon unless the owner is editing them
  const [durationDraft, setDurationDraft] = useState(cfg.handoff.durationMs);
  const [waitDraft, setWaitDraft] = useState(String(Math.round(cfg.lead.waitMs / 1000)));
  const editing = useRef<{ duration: boolean; wait: boolean }>({ duration: false, wait: false });
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  useEffect(() => {
    if (open) {
      sendCommand({ type: "GET_OFFICE_CONFIG" });
      useBossFlowStore.setState({ revokedSessions: null });
    }
  }, [open]);
  useEffect(() => {
    if (!editing.current.duration) setDurationDraft(cfg.handoff.durationMs);
    if (!editing.current.wait) setWaitDraft(String(Math.round(cfg.lead.waitMs / 1000)));
  }, [cfg.handoff.durationMs, cfg.lead.waitMs]);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const sendDuration = (ms: number) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      editing.current.duration = false;
      set({ handoff: { durationMs: ms } });
    }, 250);
  };

  const commitWait = () => {
    editing.current.wait = false;
    const sec = Number(waitDraft);
    if (!Number.isFinite(sec) || sec < 0) {
      setWaitDraft(String(Math.round(cfg.lead.waitMs / 1000)));
      return;
    }
    const ms = Math.round(sec * 1000);
    if (ms !== cfg.lead.waitMs) set({ lead: { waitMs: ms } });
  };

  const durationLabel = durationDraft === 0 ? "instant (no walk)" : `${(durationDraft / 1000).toFixed(1)} s`;
  const overrides = Object.entries(cfg.backendPermissions);

  return (
    <TermModal
      open={open}
      onClose={onClose}
      maxWidth={520}
      zIndex={120}
      title="Office settings"
      footer={
        <>
          <TermButton variant="dim" onClick={() => set({ lead: null, handoff: null, permissionMode: null })}>Reset all to defaults</TermButton>
          <TermButton variant="primary" onClick={onClose} style={{ marginLeft: "auto" }}>Done</TermButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }} data-testid="office-settings">
        {!config && <div style={{ color: TERM_DIM, fontSize: 12 }}>Loading the office settings…</div>}
        {error && <div role="alert" style={{ color: TERM_SEM_RED, fontSize: 12 }}>{error}</div>}
        {fileError && (
          <div role="alert" style={{ color: TERM_SEM_YELLOW, fontSize: 12 }}>
            config.json has errors, so the last valid settings stay in effect: {fileError}
          </div>
        )}

        <Field label="Lead does dev work itself" htmlFor="os-selfwork" isDefault={cfg.lead.selfWork === D.lead.selfWork} onReset={() => set({ lead: { selfWork: null } })}>
          <select id="os-selfwork" style={selectStyle} value={cfg.lead.selfWork} onChange={(e) => set({ lead: { selfWork: e.target.value } })}>
            {SELF_WORK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        <Field label="Lead may use subagents" htmlFor="os-subagents" isDefault={cfg.lead.subagents === D.lead.subagents} onReset={() => set({ lead: { subagents: null } })}>
          <select id="os-subagents" style={selectStyle} value={cfg.lead.subagents} onChange={(e) => set({ lead: { subagents: e.target.value } })}>
            {SUBAGENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>

        <Field
          label="Wait for a free dev before the Lead steps in (seconds)"
          htmlFor="os-wait"
          isDefault={cfg.lead.waitMs === D.lead.waitMs}
          onReset={() => set({ lead: { waitMs: null } })}
          hint="Only matters when the Lead may do dev work itself."
        >
          <input
            id="os-wait"
            type="number"
            min={0}
            max={86400}
            step={1}
            value={waitDraft}
            onFocus={() => { editing.current.wait = true; }}
            onChange={(e) => setWaitDraft(e.target.value)}
            onBlur={commitWait}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ ...selectStyle, width: 140 }}
          />
        </Field>

        <Field
          label={`Hand-off walk: ${durationLabel}`}
          htmlFor="os-handoff"
          isDefault={cfg.handoff.durationMs === D.handoff.durationMs}
          onReset={() => { editing.current.duration = false; set({ handoff: { durationMs: null } }); }}
          hint="Real work starts only after the walk, so longer walks delay the agents. 0 hands work over instantly."
        >
          <input
            id="os-handoff"
            type="range"
            min={0}
            max={HANDOFF_MAX_MS}
            step={100}
            value={durationDraft}
            aria-valuetext={durationLabel}
            onChange={(e) => {
              const ms = Number(e.target.value);
              editing.current.duration = true;
              setDurationDraft(ms);
              sendDuration(ms);
            }}
            style={{ width: "100%", accentColor: TERM_SEM_YELLOW }}
          />
        </Field>

        <Field
          label="Agent permissions"
          htmlFor="os-permission"
          isDefault={cfg.permissionMode === D.permissionMode}
          onReset={() => set({ permissionMode: null })}
          hint={
            cfg.permissionMode === "auto"
              ? "Claude Code runs with --permission-mode auto; backends without an auto mode ask you before each run."
              : "Every agent run waits for your approval first."
          }
        >
          <select id="os-permission" style={selectStyle} value={cfg.permissionMode} onChange={(e) => set({ permissionMode: e.target.value })}>
            <option value="auto">Auto (ask only when a backend has no auto mode)</option>
            <option value="ask">Ask before every run</option>
          </select>
          {overrides.length > 0 && (
            <div style={{ color: TERM_DIM, fontSize: 11 }}>
              Per-backend overrides (edit config.json): {overrides.map(([id, mode]) => `${id}: ${mode}`).join(", ")}
            </div>
          )}
        </Field>

        <div style={{ borderTop: `1px solid ${TERM_BORDER}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: TERM_TEXT, fontSize: 12 }}>Paired devices</div>
          <div style={{ color: TERM_DIM, fontSize: 11 }}>Sign out every other browser, phone and share link. This one stays connected.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {confirmRevoke ? (
              <>
                <TermButton variant="danger" onClick={() => { sendCommand({ type: "REVOKE_SESSIONS" }); setConfirmRevoke(false); }}>Yes, revoke all</TermButton>
                <TermButton variant="dim" onClick={() => setConfirmRevoke(false)}>Keep them</TermButton>
              </>
            ) : (
              <TermButton variant="danger" onClick={() => setConfirmRevoke(true)}>Revoke all devices</TermButton>
            )}
            {revoked !== null && (
              <span role="status" style={{ color: TERM_SEM_GREEN, fontSize: 11 }}>
                Revoked {revoked} {revoked === 1 ? "session" : "sessions"}.
              </span>
            )}
          </div>
        </div>
      </div>
    </TermModal>
  );
}
