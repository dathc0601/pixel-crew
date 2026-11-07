// The web bundle uses the zod-free "@pixel-crew/shared/client" entry (plan P4.3). Its
// hand-written copies must match the Zod schemas the daemon uses.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GatewayEventSchema, OfficeConfigSchema, parseGatewayEvent } from "@pixel-crew/shared";
import { DEFAULT_OFFICE_CONFIG, GATEWAY_EVENT_TYPES, parseGatewayEventLite } from "@pixel-crew/shared/client";

describe("@pixel-crew/shared/client", () => {
  it("lists every gateway event type the schema knows", () => {
    const fromSchema = GatewayEventSchema.options.map((o) => o.shape.type.value);
    assert.deepEqual([...GATEWAY_EVENT_TYPES], fromSchema);
  });

  it("has the same office defaults as the schema", () => {
    assert.deepEqual(DEFAULT_OFFICE_CONFIG, OfficeConfigSchema.parse({}));
  });

  it("drops unknown or malformed events like parseGatewayEvent, keeps known ones", () => {
    const ok = { type: "AGENT_STATUS", agentId: "a", status: "working" };
    assert.deepEqual(parseGatewayEventLite(ok), parseGatewayEvent(ok));
    for (const bad of [null, 1, "x", {}, { type: 3 }, { type: "FROM_A_NEWER_DAEMON" }]) {
      assert.equal(parseGatewayEventLite(bad), null);
    }
  });
});
