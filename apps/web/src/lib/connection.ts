import type { ConnectionInfo } from "./storage";
import { connectToWs, sendWsCommand, disconnectWs, retryWsNow } from "./ws-client";
import { isQuietCommand, OFFLINE_NOT_SENT, pushNotice } from "@/store/connection-store";

// Ably transport is registered lazily at runtime (see useAblyLoader hook)
// to prevent SSR from pulling in ably-node.js and its unresolvable dependencies.
interface AblyTransport {
  connect(machineId: string, sessionToken?: string): Promise<void>;
  send(command: Record<string, unknown>): void;
  disconnect(): void;
}
let ablyTransport: AblyTransport | null = null;

export function registerAblyTransport(transport: AblyTransport) {
  ablyTransport = transport;
}

let activeMode: "ws" | "ably" | null = null;
let connectionId = 0;

export function connect(info: ConnectionInfo) {
  disconnect();
  const id = ++connectionId;

  if (info.mode === "ws" && info.wsUrl) {
    activeMode = "ws";
    connectToWs(info.wsUrl, info.sessionToken);
  } else if (info.mode === "ably") {
    activeMode = "ably";
    if (ablyTransport) {
      ablyTransport.connect(info.machineId, info.sessionToken).catch(console.error);
    } else {
      console.error("[Connection] Ably transport not registered");
    }
  }

  // Return a scoped disconnect — only disconnects if this connection is still active
  return () => {
    if (connectionId === id) {
      disconnect();
    }
  };
}

/**
 * Sends a command to the gateway. Returns false when it could not be sent; the user then
 * sees "Not sent: the gateway is offline". Nothing is queued, so a click never replays
 * later (no double CREATE_TEAM, no late spawn or kill).
 */
export function sendCommand(command: Record<string, unknown>): boolean {
  let sent = false;
  if (activeMode === "ably") {
    try {
      ablyTransport?.send(command);
      sent = !!ablyTransport;
    } catch {
      sent = false;
    }
  } else {
    // "ws", or no transport yet: ws-client checks readyState itself
    sent = sendWsCommand(command);
  }
  if (!sent && !isQuietCommand(command.type)) pushNotice(OFFLINE_NOT_SENT);
  return sent;
}

/** "Retry now" in the offline banner. */
export function retryConnection() {
  if (activeMode === "ws") retryWsNow();
}

export function disconnect() {
  if (activeMode === "ws") {
    disconnectWs();
  } else if (activeMode === "ably") {
    ablyTransport?.disconnect();
  }
  activeMode = null;
}
