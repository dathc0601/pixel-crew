// Browser entry ("@pixel-crew/shared/client"): constants, presets and types only, no Zod.
// The daemon validates what it sends; the client only drops event types it does not know
// (an older client talking to a newer daemon), as parseGatewayEvent did (plan P4.3).

import { GATEWAY_EVENT_TYPES } from "./constants";
import type { GatewayEvent } from "./events";

export * from "./constants";
export * from "./presets";
export type * from "./types";
export type * from "./commands";
export type * from "./events";
export type * from "./agent-defs";
export type * from "./office-config";

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set(GATEWAY_EVENT_TYPES);

/** A daemon event of a known type, or null (unknown type or not an event object). */
export function parseGatewayEventLite(raw: unknown): GatewayEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const type = (raw as { type?: unknown }).type;
  return typeof type === "string" && KNOWN_EVENT_TYPES.has(type) ? (raw as GatewayEvent) : null;
}
