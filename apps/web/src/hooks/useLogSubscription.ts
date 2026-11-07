"use client";

// Tell the daemon which agents' logs this tab shows (plan P4.5): full LOG_APPEND streams
// only for open agent panes, one-line previews for the rest (they drive the speech
// bubbles), and on phones no previews at all. Re-sent after every reconnect.

import { useEffect, useMemo } from "react";
import { useOfficeStore } from "@/store/office-store";
import { sendCommand } from "@/lib/connection";

/** Phones: narrow screen with a coarse pointer. They get status events only, plus open panes. */
function isPhone(): boolean {
  try {
    return window.matchMedia("(max-width: 600px) and (pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function useLogSubscription(agentIds: ReadonlyArray<string | null | undefined>): void {
  const connected = useOfficeStore((s) => s.connected);
  const key = useMemo(
    () => [...new Set(agentIds.filter((id): id is string => !!id))].sort().join("\n"),
    [agentIds],
  );
  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(() => {
      sendCommand({ type: "SUBSCRIBE_LOGS", agentIds: key ? key.split("\n") : [], previews: !isPhone() });
    }, 150);
    return () => clearTimeout(timer);
  }, [connected, key]);
}
