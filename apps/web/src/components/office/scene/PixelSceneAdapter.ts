import type { SceneAdapter, AgentInfo, BubbleType, BossInfo, HandoffOptions, SceneObjectId } from "./SceneAdapter";
import type { OfficeState } from "../engine/officeState";
import { BOSS_AGENT_ID, type AgentStatus } from "@pixel-crew/shared";

/** Boss look: palette + hue shift that no hired agent gets by default */
const BOSS_PALETTE = 5;
const BOSS_HUE_SHIFT = 300;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Delegates SceneAdapter methods to the pixel-art OfficeState engine.
 */
export class PixelSceneAdapter implements SceneAdapter {
  private officeState: OfficeState;
  private stopLoop: (() => void) | null;
  private wakeLoop: (() => void) | null;
  private onVisibility = () => {
    // A hidden tab gets no animation frames: finish walks now instead of resuming late
    if (document.visibilityState === "hidden") this.officeState.finishHandoffs();
  };

  constructor(officeState: OfficeState, stopLoop: (() => void) | null, wakeLoop?: (() => void) | null) {
    this.officeState = officeState;
    this.stopLoop = stopLoop;
    this.wakeLoop = wakeLoop ?? null;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Wake the render loop from sleep (call after state mutations) */
  wake(): void {
    this.wakeLoop?.();
  }

  addAgent(agentId: string, info: AgentInfo): void {
    this.officeState.addCharacter(
      agentId, info.name, info.palette, info.isExternal, info.label, info.labelColor,
    );
    this.wake();
  }

  removeAgent(agentId: string): void {
    this.officeState.removeCharacter(agentId);
    this.wake();
  }

  updateAgent(agentId: string, status: AgentStatus, bubble: BubbleType | null, keepSeat?: boolean): void {
    this.officeState.updateCharacterStatus(agentId, status, keepSeat);
    if (bubble) {
      this.officeState.showBubble(agentId, bubble);
    } else {
      this.officeState.clearBubble(agentId);
    }
    this.wake();
  }

  showSpeechBubble(agentId: string, text: string): void {
    this.officeState.showSpeechBubble(agentId, text);
    this.wake();
  }

  selectAgent(agentId: string | null): void {
    this.officeState.selectCharacter(agentId);
    this.wake();
  }

  playHandoff(fromId: string, toId: string, opts: HandoffOptions): Promise<void> {
    const receivedAt = opts.receivedAt ?? performance.now();
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    return new Promise<void>((resolve) => {
      this.officeState.playHandoff({
        fromAgentId: fromId,
        toAgentId: toId,
        bubbleText: opts.label,
        deadline: receivedAt + Math.max(0, opts.durationMs),
        instant: opts.durationMs <= 0 || hidden || prefersReducedMotion(),
        resolve,
      });
      this.wake();
    });
  }

  setBoss(info: BossInfo | null): void {
    this.officeState.setBoss(BOSS_AGENT_ID, info ? { ...info, palette: BOSS_PALETTE, hueShift: BOSS_HUE_SHIFT } : null);
    this.wake();
  }

  setTaskBoard(leadId: string | null, count: number): void {
    this.officeState.setTaskBoard(leadId, count);
    this.wake();
  }

  showSubagent(agentId: string, seconds = 10): void {
    this.officeState.showSubagent(agentId, seconds);
    this.wake();
  }

  snapToSeats(): void {
    this.officeState.snapToSeats();
    this.wake();
  }

  setObjectClickHandler(handler: ((id: SceneObjectId) => void) | null): void {
    this.officeState.onObjectClick = handler;
  }

  dispose(): void {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.officeState.onObjectClick = null;
    this.stopLoop?.();
    this.stopLoop = null;
    this.wakeLoop = null;
  }

  /** Pixel-specific: access the underlying OfficeState for editor operations */
  getOfficeState(): OfficeState {
    return this.officeState;
  }
}
