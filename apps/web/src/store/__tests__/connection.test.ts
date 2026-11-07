// While the gateway is offline nothing is dropped silently: commands report "Not sent",
// refused attaches surface as notices, and nothing is queued for a later replay.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });

type ConnStore = typeof import("../connection-store");
let conn: ConnStore;
let sendCommand: typeof import("../../lib/connection")["sendCommand"];
let attach: typeof import("../attach-store");
let useOfficeStore: typeof import("../office-store")["useOfficeStore"];

before(async () => {
  conn = await import("../connection-store");
  ({ sendCommand } = await import("../../lib/connection"));
  attach = await import("../attach-store");
  ({ useOfficeStore } = await import("../office-store"));
});

beforeEach(() => {
  conn.useConnectionStore.setState({ notices: [], offline: false, nextRetryAt: null });
});

describe("offline commands", () => {
  it("returns false and shows one 'Not sent' notice, never stacked", () => {
    assert.equal(sendCommand({ type: "CREATE_TEAM", leadId: "l", memberIds: [], backends: {} }), false);
    assert.equal(sendCommand({ type: "PICK_FOLDER", requestId: "r" }), false);
    const notices = conn.useConnectionStore.getState().notices;
    assert.equal(notices.length, 1);
    assert.equal(notices[0].text, conn.OFFLINE_NOT_SENT);
  });

  it("background commands fail quietly", () => {
    assert.equal(sendCommand({ type: "PING" }), false);
    assert.equal(sendCommand({ type: "SUBSCRIBE_LOGS", agentIds: [] }), false);
    assert.equal(conn.useConnectionStore.getState().notices.length, 0);
  });

  it("a Join team click that cannot be sent does not stay 'Joining…'", () => {
    attach.requestAttach("ext-1", "fork");
    assert.equal(attach.useAttachStore.getState().pending.get("ext-1"), undefined);
    assert.equal(attach.useAttachStore.getState().errors.get("ext-1"), conn.OFFLINE_NOT_SENT);
  });

  it("caps notices at three", () => {
    for (const t of ["a", "b", "c", "d"]) conn.pushNotice(t);
    assert.deepEqual(conn.useConnectionStore.getState().notices.map((n) => n.text), ["b", "c", "d"]);
  });
});

describe("refused attach", () => {
  it("shows a notice with a Hire a team action", () => {
    useOfficeStore.getState().handleEvent({ type: "ATTACH_RESULT", agentId: "ext-2", action: "attach", ok: false, error: "Hire a team first: an attached session joins the team as a developer." } as never);
    const [n] = conn.useConnectionStore.getState().notices;
    assert.match(n.text, /^Join team refused: Hire a team first/);
    assert.equal(n.action, "hire-team");
  });

  it("other refusals get a notice without the action", () => {
    useOfficeStore.getState().handleEvent({ type: "ATTACH_RESULT", agentId: "ext-2", action: "detach", ok: false, error: "Not attached" } as never);
    const [n] = conn.useConnectionStore.getState().notices;
    assert.equal(n.text, "Leave team refused: Not attached");
    assert.equal(n.action, undefined);
  });
});
