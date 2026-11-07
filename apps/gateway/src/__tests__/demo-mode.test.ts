// Demo mode must only turn on when asked for explicitly, per run.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_AGENT_DEFS } from "@pixel-crew/shared";
import { DEMO_SCENARIO, DEMO_TEAM, isDemoRequested } from "../demo-mode.js";

const ruleFor = (prompt: string) => DEMO_SCENARIO.rules.find((r) => new RegExp(r.match).test(prompt));

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
    const result = ruleFor("New result from Ann (completed):\nFinished my part.");
    assert.match(String(result?.text), /^@Sophie: /, "dev results go to the reviewer");
    const verdict = ruleFor("New result from Sophie (completed):\nReviewed, looks good.");
    assert.ok(verdict && !/TASK|@\w+:/.test(String(verdict.text)), "the reviewer's verdict ends the task");
  });

  it("the demo team is one Lead, three or more devs and the reviewer", () => {
    const def = (id: string) => DEFAULT_AGENT_DEFS.find((d) => d.id === id);
    assert.match(def(DEMO_TEAM.lead)?.role ?? "", /lead/i);
    const roles = DEMO_TEAM.members.map((id) => def(id)?.role ?? "missing");
    assert.ok(!roles.includes("missing"), "every member is a built-in agent definition");
    const reviewers = roles.filter((r) => /review/i.test(r));
    assert.equal(reviewers.length, 1);
    assert.equal(def(DEMO_TEAM.members.find((id) => /review/i.test(def(id)!.role))!)?.name, "Sophie");
    assert.ok(roles.length - reviewers.length >= 3, "at least three devs");
    const fanOut = (ruleFor("The Boss assigned you a task:\nBuild it")?.text as string[]).filter((l) => /^TASK/.test(l)).length;
    assert.ok(fanOut >= 3 && fanOut <= roles.length - reviewers.length, "one sub-task per dev");
  });
});
