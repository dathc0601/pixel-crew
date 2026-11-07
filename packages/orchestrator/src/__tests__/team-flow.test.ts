// P0.8: a scripted Lead → Dev → Reviewer run through the real orchestrator,
// with the fake backend standing in for the AI CLI.
import "./helpers/env.js";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "fs";
import { join } from "path";
import { createHarness, type Harness } from "./helpers/harness.js";
import type { OrchestratorEvent, TaskDoneEvent, TaskDelegatedEvent, TeamPhaseChangedEvent } from "../types.js";

const rules = [
  // Workers (matched by their own prompt header)
  { match: "Your name is Rev", text: ["VERDICT: PASS", "ISSUES: none", "SUMMARY: index.html looks correct"] },
  {
    match: "Your name is Dev",
    writeFiles: { "index.html": "<h1>Hello from Pixel Crew</h1>\n" },
    toolUses: [{ name: "Write", input: { file_path: "index.html" } }],
    text: ["Created the page.", "STATUS: done", "FILES_CHANGED: index.html", "SUMMARY: Built index.html with a hello message"],
  },
  // Lead: final summary once the reviewer reported back
  { match: "Rev \\(completed", text: ["The page is built and reviewed.", "FINAL SUMMARY: Hello page shipped and passed review."] },
  // Lead: send the dev's work to review
  { match: "Dev \\(completed", text: "@Rev: Review index.html for bugs." },
  // Lead: first execute turn
  { match: "the Team Lead", text: "@Dev: Create index.html with a hello message." },
];

describe("Lead → Dev → Reviewer with the fake backend", () => {
  let h: Harness | null = null;
  after(() => h?.destroy());

  it("delegates, reviews and finalizes in under 10 s", async () => {
    const started = Date.now();
    h = createHarness({ rules });
    const { orc } = h;
    const teamId = "team-test";
    orc.setTeamLead("lead-1");
    orc.createAgent({ agentId: "lead-1", name: "Lead", role: "Team Lead", backend: "fake", teamId });
    orc.createAgent({ agentId: "dev-1", name: "Dev", role: "Developer", backend: "fake", teamId });
    orc.createAgent({ agentId: "rev-1", name: "Rev", role: "Code Reviewer", backend: "fake", teamId });
    orc.setTeamPhase(teamId, "execute", "lead-1");

    orc.runTask("lead-1", "task-1", "Build a hello page", { phaseOverride: "execute" });

    const final = await h.waitFor(
      (e): e is TaskDoneEvent => e.type === "task:done" && e.agentId === "lead-1" && e.isFinalResult === true,
      9_000,
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 10_000, `took ${elapsed} ms`);
    assert.match(final.result.summary, /Hello page shipped/);

    const delegations = h.events.filter((e): e is TaskDelegatedEvent => e.type === "task:delegated");
    assert.deepEqual(delegations.map((d) => `${d.fromAgentId}->${d.toAgentId}`), ["lead-1->dev-1", "lead-1->rev-1"]);

    const devDone = h.events.find((e): e is TaskDoneEvent => e.type === "task:done" && e.agentId === "dev-1");
    assert.ok(devDone);
    assert.ok(devDone!.result.changedFiles.some((f) => f.endsWith("index.html")));
    assert.ok(existsSync(join(h.workspace, "index.html")), "dev wrote into the shared workspace");

    const phase = h.events.find((e): e is TeamPhaseChangedEvent => e.type === "team:phase" && e.phase === "complete");
    assert.ok(phase, "team moved to the complete phase");

    // Every run went through the fake CLI with auto permissions; the lead had tools stripped.
    const runs = h.records();
    assert.equal(runs.length, 5, "lead x3 + dev + reviewer");
    for (const r of runs) {
      assert.ok(r.argv.includes("--permission-mode") && r.argv[r.argv.indexOf("--permission-mode") + 1] === "auto");
      assert.ok(!r.argv.includes("--dangerously-skip-permissions"));
    }
    const leadRuns = runs.filter((r) => r.rule === 2 || r.rule === 3 || r.rule === 4);
    assert.equal(leadRuns.length, 3);
    for (const r of leadRuns) assert.ok(r.argv.includes("--tools"), "lead runs with --tools \"\"");

    // No approvals were needed for an auto-capable backend
    assert.equal(h.events.filter((e: OrchestratorEvent) => e.type === "approval:needed").length, 0);
  });
});
