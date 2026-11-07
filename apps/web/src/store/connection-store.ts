// Gateway link state the UI shows while the gateway is unreachable: the offline banner
// (retry countdown) and short notices such as "Not sent: the gateway is offline".
// office-store keeps the plain `connected` flag; this store only adds what the banner
// and the notices need.
import { create } from "zustand";

export type NoticeAction = "hire-team";

export interface Notice {
  id: number;
  text: string;
  tone: "error" | "info";
  action?: NoticeAction;
}

interface ConnectionState {
  /** True after a connection attempt failed or an open socket closed. */
  offline: boolean;
  /** When the next automatic reconnect fires (ms epoch), null while connecting. */
  nextRetryAt: number | null;
  notices: Notice[];
}

export const useConnectionStore = create<ConnectionState>(() => ({
  offline: false,
  nextRetryAt: null,
  notices: [],
}));

export const OFFLINE_NOT_SENT = "Not sent: the gateway is offline";
const MAX_NOTICES = 3;
let nextId = 1;

export function setLinkState(offline: boolean, nextRetryAt: number | null): void {
  useConnectionStore.setState({ offline, nextRetryAt });
}

/** Shows a notice; the same text is not stacked twice. Returns the notice id. */
export function pushNotice(text: string, opts: { tone?: Notice["tone"]; action?: NoticeAction } = {}): number {
  const existing = useConnectionStore.getState().notices.find((n) => n.text === text);
  if (existing) return existing.id;
  const notice: Notice = { id: nextId++, text, tone: opts.tone ?? "error", action: opts.action };
  useConnectionStore.setState((s) => ({ notices: [...s.notices, notice].slice(-MAX_NOTICES) }));
  return notice.id;
}

export function dismissNotice(id: number): void {
  useConnectionStore.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

/** Background commands the UI sends on its own; dropping them while offline needs no notice. */
const QUIET_COMMANDS = new Set(["PING", "AUTH", "LOAD_CHAT_HISTORY", "SYNC_CHAT_HISTORY", "SUBSCRIBE_LOGS"]);

export function isQuietCommand(type: unknown): boolean {
  return typeof type === "string" && QUIET_COMMANDS.has(type);
}

/** Asks the office page to open the Hire Team dialog (it listens for this event). */
export const HIRE_TEAM_EVENT = "pixel-crew:hire-team";

export function requestHireTeam(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HIRE_TEAM_EVENT));
}
