// Demo mode must only turn on when asked for explicitly, per run.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SCENARIO, isDemoRequested } from "../demo-mode.js";

describe("demo mode", () => {
  it("needs --demo or PIXEL_CREW_DEMO=1 exactly", () => {
    assert.equal(isDemoRequested(["node", "index.js"], {}), false);
    assert.equal(isDemoRequested(["node", "index.js", "--demo"], {}), true);
    assert.equal(isDemoRequested(["node", "index.js"], { PIXEL_CREW_DEMO: "1" }), true);
    for (const v of ["0", "true", "yes", "", " 1"]) {
      assert.equal(isDemoRequested(["node", "index.js"], { PIXEL_CREW_DEMO: v }), false, `PIXEL_CREW_DEMO=${JSON.stringify(v)}`);
    }
    assert.equal(isDemoRequested(["node", "index.js", "--demo=1", "demo"], {}), false);
  });

  it("the Lead's script fans work out with TASK: lines and devs report back", () => {
    const lead = DEMO_SCENARIO.rules.find((r) => new RegExp(r.match).test("The Boss assigned you a task:\nBuild it"));
    assert.ok(lead && Array.isArray(lead.text));
    assert.ok((lead.text as string[]).filter((l) => /^TASK(\[[^\]]*\])?:/.test(l)).length >= 2);
    const dev = DEMO_SCENARIO.rules.find((r) => new RegExp(r.match).test("[Assigned by Lee (Team Lead)]\nBuild the core feature"));
    assert.ok(dev && (dev.delayMs ?? 0) >= 1000, "devs work for a few seconds");
    const result = DEMO_SCENARIO.rules.find((r) => new RegExp(r.match).test("New result from Ann (completed)"));
    assert.ok(result && !/TASK|@\w+:/.test(String(result.text)), "the Lead does not delegate again on results");
  });
});
