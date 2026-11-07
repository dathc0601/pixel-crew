// P1.1 / P1.2 / §0.4: Dispatcher unit tests with a fake host and fake timers.
// No agent process is started here; see boss-flow.test.ts for the fake-backend runs.
import "./helpers/env.js";
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Dispatcher, type DispatchDev, type DispatcherHost } from "../dispatcher.js";
import { DEFAULT_LEAD_POLICY, type LeadPolicyConfig } from "../lead-policy.js";
import type { WorkItem } from "../work-item.js";
import type { HandoffEvent, LeadSelfWorkEvent, LeadWaitingEvent, OrchestratorEvent } from "../types.js";

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

interface FakeHost extends DispatcherHost {
  devList: DispatchDev[];
  started: Array<{ itemId: string; agentId: string; at: number }>;
  selfWork: Array<{ itemId: string; leadId: string }>;
  events: OrchestratorEvent[];
  aborts: string[];
  abortResult: "aborted" | "waiting" | "gone";
  failures: string[];
}

function makeHost(devs: string[], opts: { reviewer?: boolean } = {}): FakeHost {
  const host: FakeHost = {
    devList: devs.map((name) => ({ agentId: name.toLowerCase(), name, role: "Developer", busy: false })),
    started: [],
    selfWork: [],
    events: [],
    aborts: [],
    abortResult: "aborted",
    failures: [],
    devs: () => host.devList,
    leadId: () => "lead",
    hasReviewer: () => !!opts.reviewer,
    startOnDev: (item, agentId) => host.started.push({ itemId: item.id, agentId, at: Date.now() }),
    startOnLead: (item, leadId) => host.selfWork.push({ itemId: item.id, leadId }),
    abortRun: (agentId) => { host.aborts.push(agentId); return host.abortResult; },
    forwardFailure: (item) => host.failures.push(item.id),
    emit: (e) => host.events.push(e),
  };
  return host;
}

function handoffs(host: FakeHost): HandoffEvent[] {
  return host.events.filter((e): e is HandoffEvent => e.type === "handoff");
}

function stateOf(d: Dispatcher, id: string): string | undefined {
  return d.get(id)?.state;
}

/** A saved sub-task as it would come out of team-state.json */
function enqueueSpecItem(id: string): WorkItem {
  return {
    id, parentId: null, origin: "lead", title: id, prompt: `do ${id}`, priority: "normal", preferredAgentId: null, pinned: false,
    state: "queued", assigneeId: null, attempts: 1, createdAt: 0, updatedAt: 0, heartbeatAt: null, fromAgentId: "lead",
  };
}

function enqueue(d: Dispatcher, id: string, extra: Partial<Parameters<Dispatcher["enqueue"]>[0]> = {}) {
  return d.enqueue({ id, parentId: null, prompt: `do ${id}`, fromAgentId: "lead", ...extra });
}

describe("Dispatcher: pool and assignment", () => {
  let d: Dispatcher | null = null;
  afterEach(() => { d?.destroy(); d = null; });

  it("3 sub-tasks with 2 idle devs: two start, the third waits for the first free dev", async () => {
    const host = makeHost(["Ann", "Bob"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1"); enqueue(d, "t2"); enqueue(d, "t3");
    await flush();
    assert.deepEqual(host.started.map((s) => `${s.itemId}@${s.agentId}`), ["t1@ann", "t2@bob"]);
    assert.equal(stateOf(d, "t3"), "queued");
    const waiting = host.events.filter((e): e is LeadWaitingEvent => e.type === "lead:waiting");
    assert.deepEqual(waiting.at(-1), { type: "lead:waiting", leadId: "lead", queueLength: 1, reason: "all_devs_busy" });

    assert.equal(d.onRunEnded("bob", "t2", { success: true, reason: "result", summary: "ok" }).action, "done");
    await flush();
    assert.deepEqual(host.started.map((s) => `${s.itemId}@${s.agentId}`), ["t1@ann", "t2@bob", "t3@bob"]);
    assert.equal(stateOf(d, "t2"), "done");
    assert.equal(stateOf(d, "t3"), "running");
    assert.deepEqual(host.events.filter((e): e is LeadWaitingEvent => e.type === "lead:waiting").at(-1)?.reason, "none");
  });

  it("urgent items jump the queue, otherwise FIFO", async () => {
    const host = makeHost(["Ann"]);
    host.devList[0].busy = true;
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "n1"); enqueue(d, "n2"); enqueue(d, "u1", { priority: "urgent" });
    host.devList[0].busy = false;
    d.pump(); await flush();
    assert.equal(host.started[0].itemId, "u1");
    d.onRunEnded("ann", "u1", { success: true, reason: "result", summary: "" }); await flush();
    d.onRunEnded("ann", "n1", { success: true, reason: "result", summary: "" }); await flush();
    assert.deepEqual(host.started.map((s) => s.itemId), ["u1", "n1", "n2"]);
  });

  it("a busy preferred dev: the work goes to an idle peer", async () => {
    const host = makeHost(["Ann", "Bob"]);
    host.devList[0].busy = true; // Ann is on something else
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1", { preferredAgentId: "ann" });
    await flush();
    assert.deepEqual(host.started.map((s) => s.agentId), ["bob"]);
  });

  it("an idle preferred dev gets the work", async () => {
    const host = makeHost(["Ann", "Bob"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1", { preferredAgentId: "bob" });
    await flush();
    assert.deepEqual(host.started.map((s) => s.agentId), ["bob"]);
  });

  it("a pin (@Name!) waits for that dev even when a peer is idle", async () => {
    const host = makeHost(["Ann", "Bob"]);
    host.devList[0].busy = true;
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1", { preferredAgentId: "ann", pinned: true });
    await flush();
    assert.equal(host.started.length, 0);
    assert.equal(stateOf(d, "t1"), "queued");
    assert.equal(host.events.filter((e): e is LeadWaitingEvent => e.type === "lead:waiting").at(-1)?.reason, "pinned_dev_busy");
    host.devList[0].busy = false;
    d.poke(); await flush();
    assert.deepEqual(host.started.map((s) => s.agentId), ["ann"]);
  });

  it("scores skill match first, then least recently busy", async () => {
    const host = makeHost(["Ann", "Bob", "Cat"]);
    host.devList[2].role = "Developer — CSS, Canvas";
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "css", { requiredSkills: ["css"] });
    await flush();
    assert.equal(host.started[0].agentId, "cat", "skill match wins over roster order");
    // Ann works and finishes; Bob never worked → Bob is least recently busy
    enqueue(d, "a"); await flush();
    assert.equal(host.started[1].agentId, "ann");
    d.onRunEnded("ann", "a", { success: true, reason: "result", summary: "" }); await flush();
    enqueue(d, "b"); await flush();
    assert.equal(host.started[2].agentId, "bob");
  });

  it("delivered items wait in_review when the team has a reviewer, then PASS accepts them", async () => {
    const host = makeHost(["Ann"], { reviewer: true });
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1"); await flush();
    assert.equal(d.onRunEnded("ann", "t1", { success: true, reason: "result", summary: "" }).action, "in_review");
    d.fixStarted("ann", "fix-1");
    assert.equal(stateOf(d, "t1"), "running");
    d.onRunEnded("ann", "fix-1", { success: true, reason: "result", summary: "" });
    assert.equal(stateOf(d, "t1"), "in_review");
    d.reviewPassed("ann");
    assert.equal(stateOf(d, "t1"), "done");
    const states = host.events.filter((e) => e.type === "work:updated" && e.item.id === "t1").map((e) => (e as { item: WorkItem }).item.state);
    assert.deepEqual(states, ["queued", "assigned", "handing_off", "running", "in_review", "running", "in_review", "done"]);
  });
});

describe("Dispatcher: zombie re-queue", () => {
  let d: Dispatcher | null = null;
  afterEach(() => { d?.destroy(); d = null; mock.timers.reset(); });

  it("re-queues a run that exited without a result, then fails at maxAttempts and escalates", async () => {
    const host = makeHost(["Ann"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 0, maxAttempts: 2 });
    enqueue(d, "t1"); await flush();
    assert.equal(d.get("t1")?.attempts, 1);
    assert.equal(d.onRunEnded("ann", "t1", { success: false, reason: "exit_no_result", summary: "killed" }).action, "requeued");
    await flush();
    assert.equal(host.started.length, 2, "picked up again");
    assert.equal(d.get("t1")?.attempts, 2);
    const final = d.onRunEnded("ann", "t1", { success: false, reason: "exit_no_result", summary: "killed" });
    assert.equal(final.action, "failed");
    assert.match(final.summary!, /failed after 2 attempts/);
    assert.equal(stateOf(d, "t1"), "failed");
  });

  it("a real failure (the run reported a result) is not re-queued; a user cancel cancels", async () => {
    const host = makeHost(["Ann", "Bob"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1"); enqueue(d, "t2"); await flush();
    assert.equal(d.onRunEnded("ann", "t1", { success: false, reason: "result", summary: "tests fail" }).action, "failed");
    assert.equal(d.onRunEnded("bob", "t2", { success: false, reason: "cancelled", summary: "" }).action, "cancelled");
    assert.equal(d.onRunEnded("bob", "unknown", { success: true, reason: "result", summary: "" }).action, "untracked");
  });

  it("a heartbeat timeout kills the run; a run that is gone is re-queued directly", async () => {
    mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 });
    const host = makeHost(["Ann"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 0, heartbeatTimeoutMs: 1000 });
    enqueue(d, "t1"); await flush();
    mock.timers.tick(600);
    d.heartbeat("ann"); // output keeps it alive
    mock.timers.tick(900);
    assert.deepEqual(host.aborts, []);
    mock.timers.tick(500);
    assert.deepEqual(host.aborts, ["ann"], "killed after 1 s without output");
    // The kill ends the run without a result → back in the queue
    assert.equal(d.onRunEnded("ann", "t1", { success: false, reason: "heartbeat_timeout", summary: "" }).action, "requeued");
    await flush();
    assert.equal(stateOf(d, "t1"), "running");
    host.abortResult = "gone";
    mock.timers.tick(1500);
    await flush();
    assert.equal(stateOf(d, "t1"), "failed", "second zombie hits maxAttempts");
    assert.deepEqual(host.failures, ["t1"], "the failure is forwarded to the Lead");
  });

  it("a fired dev's item goes back to the pool", async () => {
    const host = makeHost(["Ann", "Bob"]);
    host.devList[1].busy = true;
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1", { preferredAgentId: "ann", pinned: true }); await flush();
    host.devList = host.devList.filter((x) => x.agentId !== "ann");
    host.devList[0].busy = false;
    d.releaseAgent("ann");
    assert.equal(d.get("t1")?.pinned, false, "the pin to a fired dev is dropped");
    // A late "cancelled" end from the fired dev is ignored
    assert.equal(d.onRunEnded("ann", "t1", { success: false, reason: "cancelled", summary: "" }).action, "ignored");
    await flush();
    assert.equal(host.started.at(-1)?.agentId, "bob");
  });

  it("restore: running items become queued and are dispatched again", async () => {
    const host = makeHost(["Ann"]);
    const d1 = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d1, "t1"); enqueue(d1, "t2"); await flush();
    const saved = d1.snapshot();
    d1.destroy();
    assert.deepEqual(saved.map((i) => i.state), ["running", "queued"]);

    const host2 = makeHost(["Ann"]);
    d = new Dispatcher(host2, { handoffDurationMs: () => 0 });
    assert.equal(d.restore(saved).held, 2);
    assert.equal(stateOf(d, "t1"), "queued");
    assert.equal(d.get("t1")?.attempts, 1, "the interrupted attempt still counts");
    d.pump(); await flush();
    assert.equal(host2.started.length, 0, "held items never start");
    assert.equal(d.queuedCount(), 0);
    assert.equal(d.hasActiveItems(), false);
    assert.equal(d.releaseHeld().released.length, 2);
    d.pump(); await flush();
    assert.deepEqual(host2.started.map((s) => s.itemId), ["t1"]);
  });

  it("restore with hold: false dispatches at once", async () => {
    const host = makeHost(["Ann"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    const saved = [{ ...enqueueSpecItem("t1"), state: "running" as const, assigneeId: "ann" }];
    assert.equal(d.restore(saved, { hold: false }).held, 0);
    d.pump(); await flush();
    assert.deepEqual(host.started.map((s) => s.itemId), ["t1"]);
  });

  it("cancelPending: queued or handing-off items only; a Boss item takes its unstarted sub-tasks along", async () => {
    const host = makeHost(["Ann"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 10_000 });
    const root = d.assignToLead({ prompt: "boss", flags: { urgent: false }, leadId: "lead" }, () => {});
    enqueue(d, "t1", { parentId: root.id });
    enqueue(d, "t2", { parentId: root.id });
    assert.equal(stateOf(d, "t1"), "handing_off");
    assert.equal(stateOf(d, "t2"), "queued");
    assert.equal(d.cancelPending(root.id, { leadRunning: true }).ok, false, "refused while the Lead runs it");
    assert.deepEqual(d.cancelPending("t2"), { ok: true, cancelled: ["t2"] });
    assert.deepEqual(d.cancelPending(root.id), { ok: true, cancelled: ["t1", root.id] });
    assert.equal(d.cancelPending("t1").ok, false, "already cancelled");
    await flush();
    assert.equal(host.started.length, 0, "the cancelled hand-off never arrives");
  });
});

describe("Dispatcher: hand-off timing (fake timers)", () => {
  let d: Dispatcher | null = null;
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 }));
  afterEach(() => { d?.destroy(); d = null; mock.timers.reset(); });

  it("work starts exactly at durationMs, never earlier", async () => {
    const host = makeHost(["Ann"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 2500 });
    enqueue(d, "t1");
    await flush();
    assert.equal(stateOf(d, "t1"), "handing_off");
    assert.equal(handoffs(host)[0].durationMs, 2500);
    assert.equal(handoffs(host)[0].kind, "lead_to_dev");
    assert.equal(handoffs(host)[0].fromId, "lead");
    assert.equal(handoffs(host)[0].toId, "ann");
    mock.timers.tick(2499);
    await flush();
    assert.equal(host.started.length, 0);
    mock.timers.tick(1);
    await flush();
    assert.equal(host.started.length, 1);
    assert.equal(host.started[0].at, 2500);
    assert.equal(stateOf(d, "t1"), "running");
  });

  it("0 means instant (no timer needed)", async () => {
    const host = makeHost(["Ann"]);
    d = new Dispatcher(host, { handoffDurationMs: () => 0 });
    enqueue(d, "t1");
    await flush();
    assert.equal(host.started.length, 1);
    assert.equal(host.started[0].at, 0);
    assert.equal(handoffs(host)[0].durationMs, 0);
  });

  it("a hot-reloaded duration applies to the next hand-off", async () => {
    const host = makeHost(["Ann", "Bob"]);
    let duration = 1000;
    d = new Dispatcher(host, { handoffDurationMs: () => duration });
    enqueue(d, "t1");
    duration = 0; // config edited while t1 is walking
    enqueue(d, "t2");
    await flush();
    assert.deepEqual(host.started.map((s) => s.itemId), ["t2"], "t2 used the new value");
    mock.timers.tick(999); await flush();
    assert.equal(host.started.length, 1, "t1 keeps the value it started with");
    mock.timers.tick(1); await flush();
    assert.deepEqual(host.started.map((s) => s.itemId), ["t2", "t1"]);
    assert.deepEqual(handoffs(host).map((h) => h.durationMs), [1000, 0]);
  });

  it("the Boss hand-off holds the Lead's start for durationMs", async () => {
    const host = makeHost([]);
    d = new Dispatcher(host, { handoffDurationMs: () => 300 });
    const arrived: number[] = [];
    const root = d.assignToLead({ prompt: "Build a game", flags: { urgent: false }, leadId: "lead" }, () => arrived.push(Date.now()));
    const h = handoffs(host)[0];
    assert.deepEqual({ from: h.fromId, to: h.toId, kind: h.kind, item: h.workItemId }, { from: "boss", to: "lead", kind: "boss_to_lead", item: root.id });
    mock.timers.tick(299); await flush();
    assert.deepEqual(arrived, []);
    mock.timers.tick(1); await flush();
    assert.deepEqual(arrived, [300]);
    assert.equal(stateOf(d, root.id), "running");
  });
});

describe("Dispatcher: Lead self-work policy", () => {
  let d: Dispatcher | null = null;
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 0 }));
  afterEach(() => { d?.destroy(); d = null; mock.timers.reset(); });

  function setup(policy: Partial<LeadPolicyConfig>, flags: { urgent: boolean; allowLeadSelfWork?: boolean }, itemOpts: { pinned?: boolean } = {}) {
    const host = makeHost(["Ann"]);
    host.devList[0].busy = true; // nobody free
    d = new Dispatcher(host, { handoffDurationMs: () => 0, leadPolicy: () => ({ ...DEFAULT_LEAD_POLICY, waitMs: 1000, ...policy }) });
    const root = d.assignToLead({ prompt: "Boss task", flags, leadId: "lead" }, () => {});
    enqueue(d, "t1", { parentId: root.id, preferredAgentId: itemOpts.pinned ? "ann" : null, pinned: itemOpts.pinned });
    return host;
  }

  it("with the defaults the Lead never self-works", async () => {
    const host = setup({}, { urgent: true, allowLeadSelfWork: true });
    mock.timers.tick(10 * 60 * 1000); await flush();
    assert.equal(host.selfWork.length, 0);
    assert.equal(stateOf(d!, "t1"), "queued");
  });

  it("when_no_dev_after_wait: the Lead takes it only after waitMs", async () => {
    const host = setup({ selfWork: "when_no_dev_after_wait" }, { urgent: false });
    mock.timers.tick(999); await flush();
    assert.equal(host.selfWork.length, 0);
    mock.timers.tick(1); await flush();
    assert.deepEqual(host.selfWork, [{ itemId: "t1", leadId: "lead" }]);
    assert.ok(host.events.some((e): e is LeadSelfWorkEvent => e.type === "lead:self-work" && e.workItemId === "t1"));
    assert.equal(d!.get("t1")?.assigneeId, "lead");
    assert.ok(d!.isSelfWorkRun("t1"));
  });

  it("a per-task false narrows when_no_dev_after_wait", async () => {
    const host = setup({ selfWork: "when_no_dev_after_wait" }, { urgent: true, allowLeadSelfWork: false });
    mock.timers.tick(5000); await flush();
    assert.equal(host.selfWork.length, 0);
  });

  it("urgent_only needs urgent + allowLeadSelfWork", async () => {
    for (const [flags, expected] of [
      [{ urgent: true, allowLeadSelfWork: true }, 1],
      [{ urgent: true }, 0],
      [{ urgent: false, allowLeadSelfWork: true }, 0],
    ] as const) {
      const host = setup({ selfWork: "urgent_only" }, flags);
      mock.timers.tick(1000); await flush();
      assert.equal(host.selfWork.length, expected, JSON.stringify(flags));
      d!.destroy();
    }
  });

  it("pinned items are never taken by the Lead", async () => {
    const host = setup({ selfWork: "when_no_dev_after_wait" }, { urgent: true, allowLeadSelfWork: true }, { pinned: true });
    mock.timers.tick(5000); await flush();
    assert.equal(host.selfWork.length, 0);
  });
});
