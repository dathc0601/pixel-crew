const CONNECTION_KEY = "office_connection";

export interface ConnectionInfo {
  mode: "ws" | "ably";
  machineId: string;
  gatewayId?: string;
  wsUrl?: string;
  role?: "owner" | "collaborator" | "spectator";
  sessionToken?: string;
  /**
   * Paired from another device (QR link or pair code): the token belongs to this browser
   * and the gateway is reached at wsUrl. Such connections never probe localhost /connect.
   */
  paired?: boolean;
}

export function saveConnection(info: ConnectionInfo) {
  // Use sessionStorage so each tab keeps its own identity (owner vs collaborator vs spectator).
  // Fall back to localStorage for the owner connection so it persists across new tabs.
  sessionStorage.setItem(CONNECTION_KEY, JSON.stringify(info));
  // Paired phones keep any role across restarts: iOS drops sessionStorage with the tab
  if (info.role === "owner" || !info.role || info.paired) {
    localStorage.setItem(CONNECTION_KEY, JSON.stringify(info));
  }
}

export function getConnection(): ConnectionInfo | null {
  // Prefer sessionStorage (tab-specific), fall back to localStorage (owner persisted)
  const raw = sessionStorage.getItem(CONNECTION_KEY) ?? localStorage.getItem(CONNECTION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConnectionInfo;
  } catch {
    return null;
  }
}

export function clearConnection() {
  sessionStorage.removeItem(CONNECTION_KEY);
  localStorage.removeItem(CONNECTION_KEY);
}

/** Derive Gateway HTTP URL from stored wsUrl (ws://host:port → http://host:port) or use current origin */
export function getGatewayHttpUrl(): string {
  const conn = getConnection();
  if (conn?.wsUrl) {
    return conn.wsUrl.replace(/^ws(s?):\/\//, "http$1://");
  }
  return window.location.origin;
}
