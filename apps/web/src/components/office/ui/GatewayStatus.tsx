"use client";

// Offline banner ("Gateway offline · reconnecting in Ns · Retry now") and short notices
// such as "Not sent: the gateway is offline" or a refused Join team. State lives in
// store/connection-store.ts; the WebSocket client and sendCommand feed it.

import { useEffect, useState } from "react";
import { useOfficeStore } from "@/store/office-store";
import { dismissNotice, requestHireTeam, useConnectionStore, type Notice } from "@/store/connection-store";
import { retryConnection } from "@/lib/connection";
import { TERM_FONT, TERM_PANEL, TERM_SEM_RED, TERM_SEM_YELLOW, TERM_TEXT_BRIGHT } from "./termTheme";

const NOTICE_MS = 6000;
// Above dialogs (Radix overlay is 10000): "Not sent" often answers a click inside one
const Z = 10100;
const NOTICE_WITH_ACTION_MS = 12000;

function useSecondsUntil(at: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === null) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [at]);
  return at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

const linkStyle: React.CSSProperties = {
  background: "none", border: "none", padding: "0 2px", cursor: "pointer",
  color: TERM_SEM_YELLOW, textDecoration: "underline", font: "inherit",
};

function OfflineBanner() {
  const connected = useOfficeStore((s) => s.connected);
  const offline = useConnectionStore((s) => s.offline);
  const nextRetryAt = useConnectionStore((s) => s.nextRetryAt);
  const seconds = useSecondsUntil(offline && !connected ? nextRetryAt : null);
  if (connected || !offline) return null;
  return (
    <div role="status" aria-live="polite" data-testid="gateway-offline-banner" style={{
      position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: Z,
      maxWidth: "calc(100vw - 32px)", padding: "6px 12px", fontFamily: TERM_FONT, fontSize: 12,
      background: TERM_PANEL, color: TERM_TEXT_BRIGHT, border: `1px solid ${TERM_SEM_RED}`,
      display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center",
      pointerEvents: "auto",
    }}>
      <span style={{ color: TERM_SEM_RED, fontWeight: 700 }}>Gateway offline</span>
      <span>·</span>
      <span>{seconds === null ? "reconnecting…" : `reconnecting in ${seconds}s`}</span>
      <span>·</span>
      <button type="button" style={linkStyle} onClick={retryConnection}>Retry now</button>
    </div>
  );
}

function NoticeItem({ notice }: { notice: Notice }) {
  useEffect(() => {
    const t = setTimeout(() => dismissNotice(notice.id), notice.action ? NOTICE_WITH_ACTION_MS : NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice.id, notice.action]);
  const color = notice.tone === "error" ? TERM_SEM_RED : TERM_SEM_YELLOW;
  return (
    <div role="alert" data-testid="gateway-notice" style={{
      padding: "8px 12px", fontFamily: TERM_FONT, fontSize: 12, background: TERM_PANEL,
      color: TERM_TEXT_BRIGHT, border: `1px solid ${color}`, borderLeft: `3px solid ${color}`,
      display: "flex", gap: 10, alignItems: "center", pointerEvents: "auto",
    }}>
      <span style={{ flex: 1 }}>{notice.text}</span>
      {notice.action === "hire-team" && (
        <button type="button" style={linkStyle} onClick={() => { dismissNotice(notice.id); requestHireTeam(); }}>
          Hire a team
        </button>
      )}
      <button type="button" aria-label="Dismiss" style={{ ...linkStyle, textDecoration: "none" }} onClick={() => dismissNotice(notice.id)}>
        {"✕"}
      </button>
    </div>
  );
}

export default function GatewayStatus() {
  const notices = useConnectionStore((s) => s.notices);
  return (
    <>
      <OfflineBanner />
      {notices.length > 0 && (
        <div style={{
          position: "fixed", top: 48, left: "50%", transform: "translateX(-50%)", zIndex: Z,
          width: "min(420px, calc(100vw - 32px))", display: "flex", flexDirection: "column", gap: 6,
          pointerEvents: "none",
        }}>
          {notices.map((n) => <NoticeItem key={n.id} notice={n} />)}
        </div>
      )}
    </>
  );
}
