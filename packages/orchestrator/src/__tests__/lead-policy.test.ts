// P1.2 policy matrix, the delegation line format and the work-item state machine.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canLeadSelfWork, canLeadUseSubagents, DEFAULT_LEAD_POLICY, type LeadPolicyConfig } from "../lead-policy.js";
import { canTransition, parseDelegationLine } from "../work-item.js";

const cfg = (p: Partial<LeadPolicyConfig>): LeadPolicyConfig => ({ ...DEFAULT_LEAD_POLICY, ...p });
const busy = { allDevsBusy: true, queuedCount: 2 };
const free = { allDevsBusy: false, queuedCount: 2 };
const empty = { allDevsBusy: true, queuedCount: 0 };

describe("lead self-work policy", () => {
  it("defaults to never, whatever the task asks", () => {
    assert.equal(DEFAULT_LEAD_POLICY.selfWork, "never");
    assert.equal(canLeadSelfWork(DEFAULT_LEAD_POLICY, { urgent: true, allowLeadSelfWork: true }), false);
  });

  it("urgent_only: urgent AND the flag set to true", () => {
    const c = cfg({ selfWork: "urgent_only" });
    assert.equal(canLeadSelfWork(c, { urgent: true, allowLeadSelfWork: true }), true);
    assert.equal(canLeadSelfWork(c, { urgent: true }), false);
    assert.equal(canLeadSelfWork(c, { urgent: false, allowLeadSelfWork: true }), false);
  });

  it("when_no_dev_after_wait: allowed unless the task narrows it", () => {
    const c = cfg({ selfWork: "when_no_dev_after_wait" });
    assert.equal(canLeadSelfWork(c, { urgent: false }), true);
    assert.equal(canLeadSelfWork(c, { urgent: true, allowLeadSelfWork: false }), false);
  });
});

describe("lead subagent policy", () => {
  it("defaults to when_all_devs_busy: only while every dev is busy and work is queued", () => {
    assert.equal(DEFAULT_LEAD_POLICY.subagents, "when_all_devs_busy");
    const flags = { urgent: false };
    assert.equal(canLeadUseSubagents(DEFAULT_LEAD_POLICY, flags, busy), true);
    assert.equal(canLeadUseSubagents(DEFAULT_LEAD_POLICY, flags, free), false);
    assert.equal(canLeadUseSubagents(DEFAULT_LEAD_POLICY, flags, empty), false);
    assert.equal(canLeadUseSubagents(DEFAULT_LEAD_POLICY, { urgent: false, allowSubagents: false }, busy), false, "a task can narrow it");
  });

  it("never: a task flag cannot widen it", () => {
    const c = cfg({ subagents: "never" });
    assert.equal(canLeadUseSubagents(c, { urgent: true, allowSubagents: true }, busy), false);
  });

  it("urgent_only: urgent AND the flag set to true", () => {
    const c = cfg({ subagents: "urgent_only" });
    assert.equal(canLeadUseSubagents(c, { urgent: true, allowSubagents: true }, free), true);
    assert.equal(canLeadUseSubagents(c, { urgent: true }, busy), false);
    assert.equal(canLeadUseSubagents(c, { urgent: false, allowSubagents: true }, busy), false);
  });

  it("allowed: always, unless the task narrows it", () => {
    const c = cfg({ subagents: "allowed" });
    assert.equal(canLeadUseSubagents(c, { urgent: false }, free), true);
    assert.equal(canLeadUseSubagents(c, { urgent: false, allowSubagents: false }, busy), false);
  });
});

describe("delegation line format", () => {
  it("parses @Name, @Name!, TASK and TASK[skills]", () => {
    assert.deepEqual(parseDelegationLine("@Ann: build the menu"), { target: "Ann", pinned: false, skills: [], prompt: "build the menu" });
    assert.deepEqual(parseDelegationLine("- **@Ann!**: only Ann"), { target: "Ann", pinned: true, skills: [], prompt: "only Ann" });
    assert.deepEqual(parseDelegationLine("TASK: anyone"), { target: null, pinned: false, skills: [], prompt: "anyone" });
    assert.deepEqual(parseDelegationLine("* TASK[CSS, canvas]: style it"), { target: null, pinned: false, skills: ["css", "canvas"], prompt: "style it" });
  });

  it("ignores ordinary text", () => {
    assert.equal(parseDelegationLine("Task: lowercase is prose"), null);
    assert.equal(parseDelegationLine("I will ask @Ann later"), null);
    assert.equal(parseDelegationLine("TASKS: plural"), null);
  });
});

describe("work item state machine (§7.4)", () => {
  it("allows the documented path and the zombie re-queue", () => {
    const path = ["queued", "assigned", "handing_off", "running", "in_review", "running", "in_review", "done"] as const;
    for (let i = 1; i < path.length; i++) assert.ok(canTransition(path[i - 1], path[i]), `${path[i - 1]} → ${path[i]}`);
    assert.ok(canTransition("running", "queued"));
    assert.ok(canTransition("handing_off", "queued"));
  });

  it("terminal states are final and steps cannot be skipped", () => {
    for (const t of ["done", "failed", "cancelled"] as const) assert.ok(!canTransition(t, "queued"));
    assert.ok(!canTransition("queued", "running"));
    assert.ok(!canTransition("assigned", "running"));
  });
});
