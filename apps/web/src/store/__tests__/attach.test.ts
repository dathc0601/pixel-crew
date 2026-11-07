// Phase 2a on the client: an external Claude session joins the team and leaves it again.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });

let useOfficeStore: typeof import("../office-store")["useOfficeStore"];
let useAttachStore: typeof import("../attach-store")["useAttachStore"];

before(async () => {
  ({ useOfficeStore } = await import("../office-store"));
  ({ useAttachStore } = await import("../attach-store"));
});

const ev = (e: Record<string, unknown>) => useOfficeStore.getState().handleEvent(e as never);
const agent = (id: string) => useOfficeStore.getState().agents.get(id)!;

describe("attached sessions in the store", () => {
  it("external → attached member → external again", () => {
    const opts = [{ mode: "fork", note: "Work runs in a fork of this session; your terminal is not touched." }];
    ev({ type: "AGENT_CREATED", agentId: "ext-claude-7", name: "Claude (7)", role: "shop", isExternal: true, pid: 7, attachOptions: opts });
    assert.deepEqual(agent("ext-claude-7").attachOptions, opts);

    ev({ type: "AGENT_CREATED", agentId: "ext-claude-7", name: "Shop", role: "Developer — attached Claude Code session (shop)", teamId: "team-1", isExternal: false, attached: true, attachMode: "fork", attachNote: opts[0].note });
    const joined = agent("ext-claude-7");
    assert.equal(joined.isExternal, false);
    assert.equal(joined.attached, true);
    assert.equal(joined.teamId, "team-1");
    assert.equal(joined.attachMode, "fork");
    assert.equal(joined.attachOptions, undefined);

    ev({ type: "AGENT_CREATED", agentId: "ext-claude-7", name: "Claude (7)", role: "shop", isExternal: true, attached: false, pid: 7, attachOptions: opts });
    const left = agent("ext-claude-7");
    assert.equal(left.isExternal, true);
    assert.equal(left.attached, false);
    assert.equal(left.teamId, undefined, "no team once it left");
    assert.equal(left.attachMode, undefined);
    assert.deepEqual(left.attachOptions, opts);
  });

  it("ATTACH_RESULT errors are kept for the pane and never reach the agent list", () => {
    ev({ type: "ATTACH_RESULT", agentId: "ext-claude-7", action: "attach", ok: false, error: "Hire a team first" });
    assert.equal(useAttachStore.getState().errors.get("ext-claude-7"), "Hire a team first");
    ev({ type: "ATTACH_RESULT", agentId: "ext-claude-7", action: "attach", ok: true });
    assert.equal(useAttachStore.getState().errors.get("ext-claude-7"), undefined);
  });
});
