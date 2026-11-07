// P0.2: backends without an auto permission mode must get CEO approval before spawning.
import "./helpers/env.js";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type Harness } from "./helpers/harness.js";
import type { ApprovalNeededEvent, TaskDoneEvent, TaskFailedEvent, TaskQueuedEvent } from "../types.js";

const rules = [{ match: ".*", text: "SUMMARY: did the work" }];

describe("CEO approval before spawn", () => {
  let h: Harness | null = null;
  afterEach(() => { h?.destroy(); h = null; });

  function solo(opts: Parameters<typeof createHarness>[0]) {
    h = createHarness(opts);
    h.orc.createAgent({ agentId: "a1", name: "Ada", role: "Developer", backend: "fake" });
    return h;
  }

  it("spawns only after approval when the backend has no auto mode", async () => {
    const h = solo({ rules, supportsAutoPermission: false });
    h.orc.runTask("a1", "t1", "write code");
    const ask = await h.waitFor((e): e is ApprovalNeededEvent => e.type === "approval:needed");
    assert.match(ask.title, /Ada/);
    assert.equal(h.records().length, 0, "nothing spawned while waiting");
    assert.equal(h.orc.getAgent("a1")?.status, "waiting_approval");
    h.orc.resolveApproval(ask.approvalId, "yes");
    await h.waitFor((e): e is TaskDoneEvent => e.type === "task:done" && e.taskId === "t1");
    const runs = h.records();
    assert.equal(runs.length, 1);
    assert.ok(!runs[0].argv.includes("--permission-mode"), "no auto flag for a backend without auto mode");
    assert.ok(!runs[0].argv.includes("--dangerously-skip-permissions"), "never falls back to bypass");
  });

  it("fails the task without spawning when the CEO says no", async () => {
    const h = solo({ rules, supportsAutoPermission: false });
    h.orc.runTask("a1", "t1", "write code");
    const ask = await h.waitFor((e): e is ApprovalNeededEvent => e.type === "approval:needed");
    h.orc.resolveApproval(ask.approvalId, "no");
    const failed = await h.waitFor((e): e is TaskFailedEvent => e.type === "task:failed" && e.taskId === "t1");
    assert.match(failed.error, /not approved/);
    assert.equal(h.records().length, 0);
  });

  it("queues tasks that arrive while waiting, and cancel abandons the spawn", async () => {
    const h = solo({ rules, supportsAutoPermission: false });
    h.orc.runTask("a1", "t1", "first");
    await h.waitFor((e): e is ApprovalNeededEvent => e.type === "approval:needed");
    h.orc.runTask("a1", "t2", "second");
    await h.waitFor((e): e is TaskQueuedEvent => e.type === "task:queued" && e.taskId === "t2");
    h.orc.cancelTask("a1");
    await h.waitFor((e): e is TaskFailedEvent => e.type === "task:failed" && e.taskId === "t1");
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(h.records().length, 0, "cancelled before anything spawned");
    // The agent is usable again
    h.orc.runTask("a1", "t3", "third");
    const ask = await h.waitFor((e): e is ApprovalNeededEvent => e.type === "approval:needed" && e.taskId === "t3");
    h.orc.resolveApproval(ask.approvalId, "yes");
    await h.waitFor((e): e is TaskDoneEvent => e.type === "task:done" && e.taskId === "t3");
    assert.equal(h.records().length, 1);
  });

  it("\"ask\" policy gates even an auto-capable backend, then runs in auto mode", async () => {
    const h = solo({ rules, supportsAutoPermission: true, permissionPolicy: () => "ask" });
    h.orc.runTask("a1", "t1", "write code");
    const ask = await h.waitFor((e): e is ApprovalNeededEvent => e.type === "approval:needed");
    h.orc.resolveApproval(ask.approvalId, "yes");
    await h.waitFor((e): e is TaskDoneEvent => e.type === "task:done");
    const argv = h.records()[0].argv;
    assert.equal(argv[argv.indexOf("--permission-mode") + 1], "auto");
  });

  it("explicit bypass opt-in skips the gate and passes bypass flags", async () => {
    const h = solo({ rules, supportsAutoPermission: false, permissionPolicy: () => "bypass" });
    h.orc.runTask("a1", "t1", "write code");
    await h.waitFor((e): e is TaskDoneEvent => e.type === "task:done");
    assert.equal(h.events.filter((e) => e.type === "approval:needed").length, 0);
    assert.ok(h.records()[0].argv.includes("--dangerously-skip-permissions"));
  });
});
