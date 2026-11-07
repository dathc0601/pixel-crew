// Regression: the screen flickered without end after "Join team". The side panel's tab
// and selection had two writers (the attach sync and the page's deferred auto-select)
// that undid each other whenever an attached session came first in the team list.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAutoSelect, sectionForAttachChange, type AttachSnapshot, type AutoSelectState, type SideSection } from "../sidePanelSelection";

interface Agent { agentId: string; teamId?: string; isExternal?: boolean; attached?: boolean }

/**
 * The office page in miniature: each render runs the attach sync (render phase, as
 * useAttachSectionSync does), then asks for an auto-select when the selected agent is not
 * listed in the open tab. Timers run one at a time, like setTimeout(0).
 */
class SidePanel {
  renders = 0;
  private timers: Array<() => void> = [];
  private seen: AttachSnapshot | null;
  private latest: AutoSelectState = { selectedInTab: true, firstId: undefined };
  private autoSelect = createAutoSelect(
    () => this.latest,
    (id) => { this.selected = id; this.render(); },
    (fn) => { this.timers.push(fn); },
  );

  constructor(public agents: Agent[], public section: SideSection, public selected: string | null) {
    this.seen = this.snapshot();
  }

  list(section: SideSection): Agent[] {
    if (section === "team") return this.agents.filter((a) => !!a.teamId);
    if (section === "external") return this.agents.filter((a) => !!a.isExternal);
    return this.agents.filter((a) => !a.teamId && !a.isExternal);
  }

  private snapshot(): AttachSnapshot | null {
    const a = this.agents.find((x) => x.agentId === this.selected);
    return this.selected ? { agentId: this.selected, attached: a?.attached, isExternal: a?.isExternal } : null;
  }

  render(): void {
    this.renders++;
    const cur = this.snapshot();
    if (cur?.agentId !== this.seen?.agentId || cur?.attached !== this.seen?.attached || cur?.isExternal !== this.seen?.isExternal) {
      const next = sectionForAttachChange(this.seen, cur, this.section);
      this.seen = cur;
      if (next) this.section = next;
    }
    const tab = this.list(this.section);
    const selectedInTab = tab.some((a) => a.agentId === this.selected);
    this.latest = { selectedInTab, firstId: tab[0]?.agentId };
    if (!selectedInTab && tab.length > 0) this.autoSelect();
  }

  /** Run timers until nothing is pending; returns false when they never stop. */
  settle(maxTimers = 50): boolean {
    for (let i = 0; i < maxTimers; i++) {
      const t = this.timers.shift();
      if (!t) return true;
      t();
    }
    return this.timers.length === 0;
  }

  update(agentId: string, patch: Partial<Agent>): void {
    this.agents = this.agents.map((a) => (a.agentId === agentId ? { ...a, ...patch } : a));
    this.render();
  }
}

const TEAM = "team-1";
const join = { teamId: TEAM, isExternal: false, attached: true };
const leave = { teamId: undefined, isExternal: true, attached: false };

/**
 * The owner's office: the terminal sessions were in the office before the team was hired,
 * so the attached ones come first in the agent map and lead the team list.
 */
function ownersOffice(): Agent[] {
  return [
    { agentId: "agent-solo-rex" },
    { agentId: "ext-claude-26670", isExternal: true, attached: false },
    { agentId: "ext-claude-78118", ...join },
    { agentId: "ext-claude-73697", isExternal: true, attached: false },
    { agentId: "ext-claude-75588", isExternal: true, attached: false },
    { agentId: "agent-marcus", teamId: TEAM },
    { agentId: "agent-rex", teamId: TEAM },
    { agentId: "agent-sophie", teamId: TEAM },
  ];
}

describe("side panel around attached sessions", () => {
  it("Join team with an attached session first in the team list settles on the joined agent", () => {
    const panel = new SidePanel(ownersOffice(), "external", "ext-claude-26670");
    panel.render();
    panel.update("ext-claude-26670", join);
    assert.ok(panel.settle(), "the tab and selection keep changing (flicker loop)");
    assert.ok(panel.renders <= 4, `renders stay bounded (got ${panel.renders})`);
    assert.equal(panel.section, "team");
    assert.equal(panel.selected, "ext-claude-26670");
  });

  it("an external selected while the Team tab is open does not bounce between tabs", () => {
    const panel = new SidePanel(ownersOffice(), "team", "ext-claude-73697");
    panel.render();
    assert.ok(panel.settle(), "the tab and selection keep changing (flicker loop)");
    assert.ok(panel.renders <= 3, `renders stay bounded (got ${panel.renders})`);
    assert.equal(panel.section, "team");
    assert.equal(panel.selected, "ext-claude-78118", "the first team member is picked once");
  });

  it("Leave team follows the agent back to the Ext tab", () => {
    const panel = new SidePanel(ownersOffice(), "team", "ext-claude-78118");
    panel.render();
    panel.update("ext-claude-78118", leave);
    assert.ok(panel.settle());
    assert.equal(panel.section, "external");
    assert.equal(panel.selected, "ext-claude-78118");
  });

  it("only a join or leave of the same agent moves the tab", () => {
    const ext = { agentId: "a", isExternal: true, attached: false };
    const member = { agentId: "a", isExternal: false, attached: true };
    assert.equal(sectionForAttachChange(ext, member, "external"), "team");
    assert.equal(sectionForAttachChange(member, ext, "team"), "external");
    assert.equal(sectionForAttachChange(member, { ...ext, agentId: "b" }, "team"), null, "picking another agent");
    assert.equal(sectionForAttachChange({ ...member, agentId: "b" }, member, "external"), null, "picking another agent");
    assert.equal(sectionForAttachChange(null, member, "external"), null);
    assert.equal(sectionForAttachChange(ext, member, "team"), null, "already on the Team tab");
  });

  it("a deferred auto-select that is no longer needed does nothing", () => {
    let state: AutoSelectState = { selectedInTab: false, firstId: "x" };
    const picked: string[] = [];
    const timers: Array<() => void> = [];
    const request = createAutoSelect(() => state, (id) => picked.push(id), (fn) => { timers.push(fn); });
    request();
    request();
    assert.equal(timers.length, 1, "one pick per pending request");
    state = { selectedInTab: true, firstId: "x" };
    timers.shift()!();
    assert.deepEqual(picked, []);
    state = { selectedInTab: false, firstId: "y" };
    request();
    timers.shift()!();
    assert.deepEqual(picked, ["y"], "the pick comes from the latest render");
  });
});
