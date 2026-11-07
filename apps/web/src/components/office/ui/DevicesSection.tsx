"use client";

// Paired devices (P5.4), inside the owner-only office settings panel:
// - "Pair a phone": a one-time QR code + link (128-bit token, 2 minutes, single use);
// - the devices list with per-device Revoke;
// - "Revoke all devices" (P0.1).

import { useEffect, useMemo, useState } from "react";
import type { DeviceInfo, UserRole } from "@pixel-crew/shared/client";
import { sendCommand } from "@/lib/connection";
import { useBossFlowStore } from "@/store/boss-flow-store";
import TermButton from "./primitives/TermButton";
import { TERM_DIM, TERM_TEXT, TERM_SEM_GREEN, TERM_SEM_YELLOW, TERM_SURFACE, TERM_BORDER, TERM_TEXT_BRIGHT } from "./termTheme";

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "owner", label: "Owner: full control (assign, approve, settings)" },
  { value: "collaborator", label: "Collaborator: watch and suggest" },
  { value: "spectator", label: "Spectator: watch only" },
];

const KIND_LABEL: Record<DeviceInfo["kind"], string> = { local: "this computer", qr: "QR code", code: "pair code", share: "share link" };

const selectStyle: React.CSSProperties = {
  width: "100%", padding: "6px 8px", fontSize: 12, fontFamily: "inherit",
  background: TERM_SURFACE, color: TERM_TEXT_BRIGHT, border: `1px solid ${TERM_BORDER}`,
};

/** The QR code as one SVG path (white quiet zone, black modules), scaled to `px`. */
function QrCode({ size, modules, px = 216, label }: { size: number; modules: string; px?: number; label: string }) {
  const quiet = 4;
  const d = useMemo(() => {
    let out = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (modules[r * size + c] === "1") out += `M${c + quiet},${r + quiet}h1v1h-1z`;
    }
    return out;
  }, [size, modules]);
  const dim = size + quiet * 2;
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${dim} ${dim}`} width={px} height={px} shapeRendering="crispEdges" style={{ background: "#fff", display: "block" }} data-testid="pair-qr">
      <path d={d} fill="#000" />
    </svg>
  );
}

function relTime(ts: number, now: number): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export default function DevicesSection() {
  const pairLink = useBossFlowStore((s) => s.pairLink);
  const devices = useBossFlowStore((s) => s.devices);
  const revoked = useBossFlowStore((s) => s.revokedSessions);
  const [role, setRole] = useState<UserRole>("owner");
  const [baseUrl, setBaseUrl] = useState<string | undefined>(undefined);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmDevice, setConfirmDevice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    sendCommand({ type: "LIST_DEVICES" });
    // An old link from an earlier visit is not shown again
    useBossFlowStore.setState({ pairLink: null });
  }, []);

  // Countdown while a link is live
  const live = pairLink && pairLink.expiresAt > now;
  useEffect(() => {
    if (!pairLink) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pairLink]);

  // The link was used: a QR device paired after it was made
  const pairedWith = useMemo(() => {
    if (!pairLink || !devices) return null;
    return devices.find((d) => d.kind === "qr" && d.issuedAt >= pairLink.receivedAt - 5000) ?? null;
  }, [pairLink, devices]);

  const makeLink = () => {
    setCopied(false);
    setNow(Date.now());
    sendCommand({ type: "CREATE_PAIR_LINK", role, ...(baseUrl ? { baseUrl } : {}) });
  };

  const secondsLeft = pairLink ? Math.max(0, Math.floor((pairLink.expiresAt - now) / 1000)) : 0;
  const local = (devices ?? []).filter((d) => d.kind === "local");
  const others = (devices ?? []).filter((d) => d.kind !== "local");

  return (
    <div style={{ borderTop: `1px solid ${TERM_BORDER}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }} data-testid="devices-section">
      <div style={{ color: TERM_TEXT, fontSize: 12 }}>Paired devices</div>

      {/* Pair a phone */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label htmlFor="os-pair-role" style={{ color: TERM_DIM, fontSize: 11 }}>Pair a phone or another browser as</label>
        <select id="os-pair-role" style={selectStyle} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {pairLink && pairLink.urls.length > 1 && (
          <>
            <label htmlFor="os-pair-url" style={{ color: TERM_DIM, fontSize: 11 }}>Address the phone uses</label>
            <select id="os-pair-url" style={selectStyle} value={baseUrl ?? pairLink.urls[0]} onChange={(e) => setBaseUrl(e.target.value)}>
              {pairLink.urls.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </>
        )}
        <div>
          <TermButton variant="primary" onClick={makeLink} data-testid="pair-make-qr">{pairLink ? "New QR code" : "Show QR code"}</TermButton>
        </div>
      </div>

      {pairLink && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }} data-testid="pair-link">
          {live && !pairedWith ? (
            <QrCode size={pairLink.qr.size} modules={pairLink.qr.modules} label={`QR code for a one-time ${pairLink.role} pairing link`} />
          ) : (
            <div style={{ width: 216, height: 216, display: "flex", alignItems: "center", justifyContent: "center", border: `1px dashed ${TERM_BORDER}`, color: pairedWith ? TERM_SEM_GREEN : TERM_DIM, fontSize: 12, textAlign: "center", padding: 12, boxSizing: "border-box" }}>
              {pairedWith ? `Paired: ${pairedWith.name}` : "This code expired. Make a new one."}
            </div>
          )}
          <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ color: TERM_TEXT, fontSize: 12 }}>
              Scan with the phone's camera. Works once, as <b>{pairLink.role}</b>
              {live && !pairedWith ? <>, for {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} more.</> : "."}
            </div>
            <code style={{ color: TERM_DIM, fontSize: 11, wordBreak: "break-all", userSelect: "all" }} data-testid="pair-url">{pairLink.url}</code>
            {live && !pairedWith && (
              <div>
                <TermButton
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(pairLink.url).then(() => setCopied(true), () => setCopied(false));
                  }}
                >
                  {copied ? "Copied" : "Copy link"}
                </TermButton>
              </div>
            )}
            {pairLink.warning && <div role="note" style={{ color: TERM_SEM_YELLOW, fontSize: 11 }}>{pairLink.warning}</div>}
          </div>
        </div>
      )}

      {/* Devices list */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }} data-testid="devices-list">
        {devices === null && <li style={{ color: TERM_DIM, fontSize: 12 }}>Loading devices…</li>}
        {devices !== null && others.length === 0 && <li style={{ color: TERM_DIM, fontSize: 12 }}>No phones or other browsers are paired.</li>}
        {others.map((d) => (
          <li key={d.deviceId} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 8px", border: `1px solid ${TERM_BORDER}`, background: TERM_SURFACE }} data-testid="device-row">
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <div style={{ color: TERM_TEXT_BRIGHT, fontSize: 12 }}>
                {d.name}
                {d.current && <span style={{ color: TERM_SEM_GREEN }}> · this device</span>}
              </div>
              <div style={{ color: TERM_DIM, fontSize: 11 }}>
                {d.role} · {KIND_LABEL[d.kind]} · {d.connected ? <span style={{ color: TERM_SEM_GREEN }}>online</span> : `seen ${relTime(d.lastSeenAt, now)}`} · expires {new Date(d.expiresAt).toLocaleDateString()}
              </div>
            </div>
            {confirmDevice === d.deviceId ? (
              <>
                <TermButton size="sm" variant="danger" onClick={() => { sendCommand({ type: "REVOKE_DEVICE", deviceId: d.deviceId }); setConfirmDevice(null); }}>Yes, revoke</TermButton>
                <TermButton size="sm" variant="dim" onClick={() => setConfirmDevice(null)}>Keep</TermButton>
              </>
            ) : (
              <TermButton size="sm" variant="danger" onClick={() => setConfirmDevice(d.deviceId)} aria-label={`Revoke ${d.name}`}>Revoke</TermButton>
            )}
          </li>
        ))}
        {local.length > 0 && (
          <li style={{ color: TERM_DIM, fontSize: 11 }}>
            This computer: {local.length} local browser {local.length === 1 ? "session" : "sessions"} (renewed on every visit; Revoke all signs them out too).
          </li>
        )}
      </ul>

      {/* Revoke all (P0.1) */}
      <div style={{ color: TERM_DIM, fontSize: 11 }}>Sign out every other browser, phone and share link. This one stays connected.</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
  );
}
