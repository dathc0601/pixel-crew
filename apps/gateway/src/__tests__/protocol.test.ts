// P1.3 protocol: BOSS_ASSIGN, office config commands and the choreography events.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BOSS_AGENT_ID, CommandSchema, DEFAULT_OFFICE_CONFIG, GatewayEventSchema, parseGatewayEvent } from "@pixel-crew/shared";

const item = {
  id: "w1",
  parentId: "root",
  origin: "lead",
  title: "Build the menu",
  prompt: "Build the menu screen",
  priority: "urgent",
  requiredSkills: ["css"],
  preferredAgentId: null,
  pinned: false,
  state: "handing_off",
  assigneeId: "agent-a",
  attempts: 1,
  createdAt: 1,
  updatedAt: 2,
  heartbeatAt: null,
};

describe("commands", () => {
  it("BOSS_ASSIGN: prompt required, urgent defaults to false, flags optional", () => {
    const ok = CommandSchema.parse({ type: "BOSS_ASSIGN", prompt: "  Build a snake game  " });
    assert.deepEqual(ok, { type: "BOSS_ASSIGN", prompt: "Build a snake game", urgent: false });
    const full = CommandSchema.parse({ type: "BOSS_ASSIGN", prompt: "x", urgent: true, allowLeadSelfWork: true, allowSubagents: false });
    assert.equal(full.type === "BOSS_ASSIGN" && full.allowSubagents, false);
    assert.equal(CommandSchema.safeParse({ type: "BOSS_ASSIGN", prompt: "   " }).success, false);
    assert.equal(CommandSchema.safeParse({ type: "BOSS_ASSIGN", prompt: "x", urgent: "yes" }).success, false);
  });

  it("GET_OFFICE_CONFIG / SET_OFFICE_CONFIG", () => {
    assert.ok(CommandSchema.safeParse({ type: "GET_OFFICE_CONFIG" }).success);
    // Values are validated by the daemon (so it can answer with an error), not here
    assert.ok(CommandSchema.safeParse({ type: "SET_OFFICE_CONFIG", office: { handoff: { durationMs: 99999 } } }).success);
    assert.equal(CommandSchema.safeParse({ type: "SET_OFFICE_CONFIG", office: "nope" }).success, false);
  });
});

describe("events", () => {
  it("WORK_ITEM_UPDATED, HANDOFF, LEAD_* and OFFICE_CONFIG parse", () => {
    const events = [
      { type: "WORK_ITEM_UPDATED", item },
      { type: "WORK_ITEM_UPDATED", item: { ...item, origin: "boss", parentId: null, flags: { urgent: true, allowSubagents: true } } },
      { type: "HANDOFF", handoffId: "h1", fromId: BOSS_AGENT_ID, toId: "lead", workItemId: "root", kind: "boss_to_lead", label: "Build", durationMs: 2500 },
      { type: "LEAD_WAITING", leadId: "lead", queueLength: 2, reason: "all_devs_busy" },
      { type: "LEAD_SELF_WORK", leadId: "lead", workItemId: "w1" },
      { type: "LEAD_SUBAGENT_STARTED", leadId: "lead", workItemId: null, description: "help" },
      { type: "OFFICE_CONFIG", config: DEFAULT_OFFICE_CONFIG },
      { type: "OFFICE_CONFIG", config: DEFAULT_OFFICE_CONFIG, error: "Only the owner can read or change office settings" },
    ];
    for (const e of events) assert.ok(GatewayEventSchema.safeParse(e).success, e.type);
  });

  it("rejects bad shapes", () => {
    assert.equal(GatewayEventSchema.safeParse({ type: "HANDOFF", handoffId: "h", fromId: "a", toId: "b", workItemId: "w", kind: "lead_to_boss", label: "", durationMs: 0 }).success, false);
    assert.equal(GatewayEventSchema.safeParse({ type: "HANDOFF", handoffId: "h", fromId: "a", toId: "b", workItemId: "w", kind: "lead_to_dev", label: "", durationMs: -1 }).success, false);
    assert.equal(GatewayEventSchema.safeParse({ type: "WORK_ITEM_UPDATED", item: { ...item, state: "paused" } }).success, false);
    assert.equal(GatewayEventSchema.safeParse({ type: "OFFICE_CONFIG", config: { ...DEFAULT_OFFICE_CONFIG, handoff: { durationMs: 20000 } } }).success, false);
  });

  it("parseGatewayEvent drops unknown or malformed events instead of throwing", () => {
    assert.equal(parseGatewayEvent({ type: "SOMETHING_FROM_THE_FUTURE", x: 1 }), null);
    assert.equal(parseGatewayEvent({ type: "HANDOFF" }), null);
    assert.equal(parseGatewayEvent(null), null);
    assert.equal(parseGatewayEvent("not an object"), null);
    const e = parseGatewayEvent({ type: "LEAD_SELF_WORK", leadId: "lead", workItemId: "w1", extra: "ignored" });
    assert.deepEqual(e, { type: "LEAD_SELF_WORK", leadId: "lead", workItemId: "w1" });
  });
});

describe("pool commands, held items and demo info", () => {
  it("RESUME_POOL / CANCEL_WORK_ITEM parse; CANCEL needs an id", () => {
    assert.ok(CommandSchema.safeParse({ type: "RESUME_POOL" }).success);
    assert.ok(CommandSchema.safeParse({ type: "CANCEL_WORK_ITEM", workItemId: "w1" }).success);
    assert.equal(CommandSchema.safeParse({ type: "CANCEL_WORK_ITEM", workItemId: "" }).success, false);
    assert.equal(CommandSchema.safeParse({ type: "CANCEL_WORK_ITEM" }).success, false);
  });

  it("WORK_ITEM_UPDATED carries the optional held flag; GATEWAY_INFO carries demo", () => {
    const held = GatewayEventSchema.safeParse({ type: "WORK_ITEM_UPDATED", item: { ...item, state: "queued", held: true } });
    assert.ok(held.success);
    assert.equal(held.success && held.data.type === "WORK_ITEM_UPDATED" && held.data.item.held, true);
    assert.ok(GatewayEventSchema.safeParse({ type: "GATEWAY_INFO", demo: true }).success);
    assert.equal(GatewayEventSchema.safeParse({ type: "GATEWAY_INFO" }).success, false);
  });
});
