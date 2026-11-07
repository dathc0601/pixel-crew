import type { AgentStatus } from "@pixel-crew/shared";

/**
 * Visual metadata for an agent entering the scene.
 * Scene-agnostic — each adapter picks what it needs.
 */
export interface AgentInfo {
  name: string;
  label: string;
  labelColor: string;
  isExternal: boolean;
  palette?: number;
}

/** Bubble type shown above an agent's head */
export type BubbleType = "permission" | "working" | "waiting";

/** The Boss (the human user) as a scene character. Its agent id is BOSS_AGENT_ID ("boss"). */
export interface BossInfo {
  label: string;
  labelColor: string;
}

export interface HandoffOptions {
  /** The daemon's hand-off duration: walk + hand-over end together after this long (0 = instant) */
  durationMs: number;
  /** Shown in the giver's speech bubble */
  label: string;
  /** performance.now() when the HANDOFF event arrived (default: now) */
  receivedAt?: number;
}

/** Clickable things in the scene that are not agents */
export type SceneObjectId = "boss" | "task-board";

/**
 * Pluggable scene interface — any scene implementation (pixel office, 3D,
 * isometric, list view) can implement these methods to be swapped in.
 * The Boss-flow methods are cosmetic: the daemon owns all timing (plan §7.7).
 */
export interface SceneAdapter {
  addAgent(agentId: string, info: AgentInfo): void;
  removeAgent(agentId: string): void;
  updateAgent(agentId: string, status: AgentStatus, bubble: BubbleType | null, keepSeat?: boolean): void;
  showSpeechBubble(agentId: string, text: string): void;
  selectAgent(agentId: string | null): void;
  dispose(): void;

  /**
   * Walk a paper from one character to another (ids may be "boss"). Resolves when the
   * hand-over is done (immediately when it cannot be animated). Concurrent hand-offs
   * from the same giver play one after another.
   */
  playHandoff(fromId: string, toId: string, opts: HandoffOptions): Promise<void>;
  /** Show the Boss at its desk, or remove it (null). */
  setBoss(info: BossInfo | null): void;
  /** Queue board next to the Lead with N papers (0 or null hides it). */
  setTaskBoard?(leadId: string | null, count: number): void;
  /** Small "subagent" helper next to an agent for a few seconds. */
  showSubagent?(agentId: string, seconds?: number): void;
  /** Reconnect (§7.7): skip in-flight hand-offs and put everyone on their seat. */
  snapToSeats?(): void;
  /** Clicks on the Boss or the task board. */
  setObjectClickHandler?(handler: ((id: SceneObjectId) => void) | null): void;
}

/**
 * Props every scene component must accept.
 * Selection flows through the adapter (via useSceneBridge), not as a prop.
 */
export interface SceneComponentProps {
  onAdapterReady: (adapter: SceneAdapter) => void;
  onAgentClick: (agentId: string) => void;
}
