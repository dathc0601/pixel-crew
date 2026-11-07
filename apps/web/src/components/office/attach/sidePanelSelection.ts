// Side panel tab and selection rules around attached sessions (Phase 2a), kept pure so
// they can be tested without React.
//
// Two things move the side panel on their own: the office page picks the first agent of
// the open tab when the selected one is not listed there, and the attach sync follows the
// selected agent to its new tab when it joins or leaves the team. They must never chase
// each other: the sync reacts only to a join/leave of the agent that stays selected, and
// the page's deferred pick checks again, when it runs, that it is still needed.

export type SideSection = "team" | "agents" | "external";

export interface AttachSnapshot {
  agentId: string;
  attached?: boolean;
  isExternal?: boolean;
}

/**
 * The tab to switch to because the selected agent just joined the team (external → team)
 * or left it (team → external), or null to stay. Selecting another agent never moves the
 * tab: before, every external selected while the Team tab was open sent the panel to Ext,
 * and with an attached session first in the team list the page's auto-select sent it back,
 * over and over (the screen flickered after Join team).
 */
export function sectionForAttachChange(
  prev: AttachSnapshot | null,
  cur: AttachSnapshot | null,
  section: SideSection,
): SideSection | null {
  if (!prev || !cur || prev.agentId !== cur.agentId) return null;
  if (!prev.attached && cur.attached && section === "external") return "team";
  if (prev.attached && !cur.attached && cur.isExternal && section === "team") return "external";
  return null;
}

export interface AutoSelectState {
  /** The selected agent is listed in the open tab */
  selectedInTab: boolean;
  /** First agent of the open tab, if any */
  firstId: string | undefined;
}

/**
 * "Select the first agent of the open tab" for the office page, deferred out of render.
 * The pick is decided when the timer runs, from the latest render: a stale pick from an
 * earlier render (for example the one in which an external session became a team member)
 * is dropped instead of overriding the tab switch that happened meanwhile.
 */
export function createAutoSelect(
  latest: () => AutoSelectState,
  select: (agentId: string) => void,
  schedule: (fn: () => void) => void = (fn) => { setTimeout(fn, 0); },
): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      const { selectedInTab, firstId } = latest();
      if (!selectedInTab && firstId) select(firstId);
    });
  };
}
