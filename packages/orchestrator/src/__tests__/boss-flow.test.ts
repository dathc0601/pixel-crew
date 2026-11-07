// P1.1 / P1.2 acceptance with the fake backend: Boss → Lead → shared pool → devs.
// Every "agent" is fake-agent.mjs; no real AI CLI runs.
import "./helpers/env.js";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHarness, type Harness, type ScenarioRule } from "./helpers/harness.js";
import { DEFAULT_LEAD_POLICY, type LeadPolicyConfig } from "../lead-policy.js";
import type { WorkItem } from "../work-item.js";
import type {
  HandoffEvent,
  LeadSelfWorkEvent,
  LeadSubagentStartedEvent,
  OrchestratorEvent,
  TaskDoneEvent,
  TaskStartedEvent,
  WorkItemUpdatedEvent,
} from "../types.js";

const LEAD = "lead-1";
const leadFinal: ScenarioRule = { match: "New result from", text: "FINAL SUMMARY: everything is delivered." };
const dev = (name: string, extra: Partial<ScenarioRule> = {}): ScenarioRule => ({
  match: `Your name is ${name},`,
  text: ["STATUS: done", `SUMMARY: ${name} finished the work`],
  ...extra,
});

function hireTeam(h: Harness, devs: string[]): void {
  const teamId = "team-t";
  h.orc.setTeamLead(LEAD);
  h.orc.createAgent({ agentId: LEAD, name: "Lee", role: "Team Lead", backend: "fake", teamId });
  for (const d of devs) h.orc.createAgent({ agentId: `dev-${d.toLowerCase()}`, name: d, role: "Developer", backend: "fake", teamId });
  h.orc.setTeamPhase(teamId, "create", LEAD);
}

const isFinal = (e: OrchestratorEvent): e is TaskDoneEvent => e.type === "task:done" && e.agentId === LEAD && e.isFinalResult === true;
const started = (h: Harness, agentId?: string) =>
  h.events.filter((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId !== LEAD && (!agentId || e.agentId === agentId));
const itemUpdates = (h: Harness) => h.events.filter((e): e is WorkItemUpdatedEvent => e.type === "work:updated");
const lastItem = (h: Harness, pred: (i: WorkItem) => boolean) => [...itemUpdates(h)].reverse().find((e) => pred(e.item))?.item;
const flag = (argv: string[], name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Boss flow with the fake backend", () => {
  let hs: Harness[] = [];
  afterEach(() => { for (const h of hs) h.destroy(); hs = []; });
  function harness(rules: ScenarioRule[], opts: Omit<Parameters<typeof createHarness>[0], "rules"> = {}) {
    const h = createHarness({ rules, ...opts });
    hs.push(h);
    return h;
  }

  it("3 sub-tasks and 2 idle devs: two start at once, the third when a dev frees up", async () => {
    const h = harness([
      leadFinal,
      { match: "The Boss assigned you a task", text: ["TASK: part one", "TASK: part two", "TASK: part three"] },
      dev("Ann", { delayMs: 300 }),
      dev("Bob", { delayMs: 300 }),
    ]);
    hireTeam(h, ["Ann", "Bob"]);
    const res = h.orc.bossAssign({ prompt: "Build three parts", urgent: false });
    assert.ok(res.ok);
    await h.waitFor(isFinal, 9000);

    const s = started(h);
    assert.equal(s.length, 3);
    assert.notEqual(s[0].agentId, s[1].agentId, "the first two went to different devs");
    const firstDevDone = h.events.findIndex((e) => e.type === "task:done" && e.agentId !== LEAD);
    assert.ok(h.events.indexOf(s[1]) < firstDevDone, "both started before either finished");
    assert.ok(h.events.indexOf(s[2]) > firstDevDone, "the third waited for a free dev");

    const items = h.orc.getWorkItems();
    const root = items.find((i) => i.origin === "boss")!;
    assert.equal(root.state, "done");
    const children = items.filter((i) => i.parentId === root.id);
    assert.deepEqual(children.map((c) => c.state), ["done", "done", "done"]);
    assert.ok(h.events.some((e) => e.type === "lead:waiting" && e.queueLength === 1), "the Lead waited for a dev");

    // The Lead ran without tools
    for (const r of h.records().filter((r) => r.rule === 0 || r.rule === 1)) {
      assert.equal(flag(r.argv, "--tools"), "");
      assert.ok(!r.argv.includes("--disallowedTools"));
    }
  });

  it("a busy preferred dev: the second item goes to the idle peer", async () => {
    const h = harness([
      leadFinal,
      { match: "The Boss assigned you a task", text: ["@Ann: part one", "@Ann: part two"] },
      dev("Ann", { delayMs: 300 }),
      dev("Bob"),
    ]);
    hireTeam(h, ["Ann", "Bob"]);
    h.orc.bossAssign({ prompt: "Two parts for Ann", urgent: false });
    await h.waitFor(isFinal, 9000);
    const byPrompt = Object.fromEntries(started(h).map((s) => [s.prompt.split("\n").pop(), s.agentId]));
    assert.deepEqual(byPrompt, { "part one": "dev-ann", "part two": "dev-bob" });
  });

  it("a pin (@Name!) waits for that dev while a peer is idle", async () => {
    const h = harness([
      leadFinal,
      { match: "The Boss assigned you a task", text: ["@Ann!: part one", "@Ann!: part two"] },
      dev("Ann", { delayMs: 200 }),
      dev("Bob"),
    ]);
    hireTeam(h, ["Ann", "Bob"]);
    h.orc.bossAssign({ prompt: "Ann only", urgent: false });
    await h.waitFor(isFinal, 9000);
    const s = started(h);
    assert.deepEqual(s.map((x) => x.agentId), ["dev-ann", "dev-ann"]);
    assert.equal(started(h, "dev-bob").length, 0);
    assert.ok(h.events.some((e) => e.type === "lead:waiting" && e.reason === "pinned_dev_busy"));
  });

  it("killing a dev mid-task re-queues its item, and the retry finishes it", async () => {
    const h = harness([
      leadFinal,
      { match: "The Boss assigned you a task", text: "TASK: slow job" },
      dev("Ann", { match: "Retry 2", text: ["STATUS: done", "SUMMARY: finished on retry"] }),
      dev("Ann", { delayMs: 20_000 }),
    ]);
    hireTeam(h, ["Ann"]);
    h.orc.bossAssign({ prompt: "One slow job", urgent: false });
    await h.waitFor((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId === "dev-ann");
    await sleep(150); // let the fake agent print its init line
    const pid = h.orc.getAgent("dev-ann")!.pid!;
    process.kill(pid, "SIGKILL");

    await h.waitFor((e) => e.type === "work:updated" && e.item.origin === "lead" && e.item.state === "queued" && e.item.attempts === 1);
    await h.waitFor(isFinal, 9000);
    const item = h.orc.getWorkItems().find((i) => i.origin === "lead")!;
    assert.equal(item.state, "done");
    assert.equal(item.attempts, 2);
    const results = h.events.filter((e) => e.type === "task:result-returned");
    assert.deepEqual(results.map((r) => (r as { success: boolean }).success), [true], "the Lead only saw the successful retry");
  });

  /** Run `rules` until `ready`, snapshot the pool, then drop that orchestrator ("daemon stops"). */
  async function poolAt(rules: ScenarioRule[], start: (h: Harness) => void, ready: (e: OrchestratorEvent) => boolean): Promise<WorkItem[]> {
    const before = harness(rules);
    hireTeam(before, ["Ann"]);
    start(before);
    await before.waitFor(ready);
    const saved = before.orc.getWorkItems();
    before.destroy();
    hs = hs.filter((x) => x !== before);
    return saved;
  }
  const annStarted = (e: OrchestratorEvent): e is TaskStartedEvent => e.type === "task:started" && e.agentId === "dev-ann";
  /** Two sub-tasks: job one running on Ann, job two queued */
  const twoJobsPool = () => poolAt(
    [{ match: "The Boss assigned you a task", text: ["TASK: job one", "TASK: job two"] }, dev("Ann", { delayMs: 20_000 })],
    (h) => { h.orc.bossAssign({ prompt: "Two jobs", urgent: false }); },
    annStarted,
  );
  /** "Daemon restart": a fresh orchestrator with the same agents, then the saved pool */
  function restarted(rules: ScenarioRule[], saved: WorkItem[]): { h: Harness; held: number } {
    const h = harness(rules);
    hireTeam(h, ["Ann"]);
    h.orc.setTeamPhase("team-t", "complete", LEAD); // the gateway restores execute as complete
    return { h, held: h.orc.restoreWorkItems(saved) };
  }

  it("after a restart nothing starts: restored items are held", async () => {
    const saved = await twoJobsPool();
    assert.deepEqual(saved.filter((i) => i.origin === "lead").map((i) => i.state), ["running", "queued"]);
    const { h, held } = restarted([leadFinal, dev("Ann")], saved);
    assert.equal(held, 3, "both sub-tasks and the Boss item");
    await sleep(400);
    assert.equal(h.events.filter((e) => e.type === "task:started" || e.type === "handoff" || e.type === "lead:self-work").length, 0);
    assert.equal(h.records().length, 0, "no agent process ran");
    const items = h.orc.getWorkItems();
    assert.ok(items.every((i) => i.held === true), "every restored item is held");
    assert.deepEqual(items.map((i) => i.state), ["running", "queued", "queued"], "Boss item held by the Lead, both jobs queued");
    assert.equal(h.orc.heldCount(), 3);
    assert.equal(h.orc.getTeamPhase(LEAD), "complete", "the phase is not pushed back to execute");
  });

  it("restart resumes the queue on RESUME_POOL: running items are queued again and finish", async () => {
    const saved = await twoJobsPool();
    const { h } = restarted([leadFinal, dev("Ann")], saved);
    const jobOne = saved.find((i) => i.origin === "lead")!;
    assert.equal(itemUpdates(h).find((e) => e.item.id === jobOne.id)?.item.state, "queued", "restored as queued, not running");
    assert.equal(h.orc.resumePool(), 3);
    assert.equal(h.orc.heldCount(), 0);
    assert.equal(h.orc.resumePool(), 0, "nothing left to resume");
    await h.waitFor(isFinal, 9000);
    const items = h.orc.getWorkItems();
    assert.deepEqual(items.filter((i) => i.origin === "lead").map((i) => i.state), ["done", "done"]);
    assert.equal(items.find((i) => i.origin === "boss")?.state, "done");
    assert.ok(items.every((i) => !i.held));
    assert.ok(itemUpdates(h).some((e) => e.item.id === jobOne.id && e.item.state === "queued"), "job one was re-queued");
    assert.equal(started(h).length, 2);
  });

  it("new Boss work runs and finalizes while restored items stay held, then RESUME_POOL finishes them", async () => {
    const saved = await twoJobsPool();
    const { h } = restarted([leadFinal, { match: "NEW task", text: "TASK: new job" }, dev("Ann")], saved);
    const res = h.orc.bossAssign({ prompt: "NEW task", urgent: false });
    assert.ok(res.ok);
    await h.waitFor(isFinal, 9000);
    let items = h.orc.getWorkItems();
    assert.equal(items.find((i) => i.id === res.item.id)?.state, "done", "the new Boss item finished");
    assert.deepEqual(started(h).map((s) => s.prompt.split("\n").pop()), ["new job"], "only the new sub-task ran");
    const old = items.filter((i) => saved.some((s) => s.id === i.id));
    assert.deepEqual(old.map((i) => [i.state, i.held]), [["running", true], ["queued", true], ["queued", true]], "the old items are untouched");
    const newJob = items.find((i) => i.parentId === res.item.id)!;
    assert.equal(newJob.state, "done");
    assert.equal(newJob.held, undefined);

    assert.equal(h.orc.resumePool(), 3);
    await h.waitFor(() => h.events.filter(isFinal).length >= 2, 9000);
    items = h.orc.getWorkItems();
    assert.ok(items.every((i) => i.state === "done"), `all done: ${items.map((i) => i.state).join(",")}`);
    assert.equal(started(h).length, 3);
  });

  it("a held Boss item with nothing in the pool goes back to the Lead on RESUME_POOL", async () => {
    const saved = await poolAt(
      [{ match: "The Boss assigned you a task", text: "thinking", delayMs: 20_000 }],
      (h) => { h.orc.bossAssign({ prompt: "Plan it", urgent: false }); },
      (e) => e.type === "task:started" && e.agentId === LEAD,
    );
    const { h, held } = restarted([{ match: "daemon restarted", text: "Nothing to delegate.", delayMs: 400 }], saved);
    assert.equal(held, 1);
    assert.equal(h.orc.getWorkItems()[0].state, "queued");
    await sleep(300);
    assert.equal(h.records().length, 0, "the Lead did not run before RESUME_POOL");

    assert.equal(h.orc.resumePool(), 1);
    const leadRun = await h.waitFor((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId === LEAD);
    assert.equal(leadRun.taskId, saved[0].id);
    const refused = h.orc.cancelWorkItem(saved[0].id);
    assert.equal(refused.ok, false, "cannot cancel a Boss item the Lead is running");
    await h.waitFor((e): e is WorkItemUpdatedEvent => e.type === "work:updated" && e.item.id === saved[0].id && e.item.state === "done");
    assert.equal(h.orc.getTeamPhase(LEAD), "complete");
  });

  it("CANCEL_WORK_ITEM cancels held sub-tasks and Boss items, and refuses running work", async () => {
    const saved = await twoJobsPool();
    const [root, jobOne, jobTwo] = saved;

    // Held Boss item: it and both held sub-tasks are cancelled; nothing ever starts
    const a = restarted([leadFinal, dev("Ann")], saved).h;
    assert.deepEqual(a.orc.cancelWorkItem(root.id), { ok: true });
    assert.deepEqual(a.orc.getWorkItems().map((i) => [i.state, i.held]), [["cancelled", undefined], ["cancelled", undefined], ["cancelled", undefined]]);
    assert.equal(a.orc.resumePool(), 0);
    assert.equal(a.orc.cancelWorkItem(root.id).ok, false, "already cancelled");
    assert.equal(a.orc.cancelWorkItem("nope").ok, false, "unknown id");
    await sleep(300);
    assert.equal(a.records().length, 0);
    a.destroy();
    hs = hs.filter((x) => x !== a);

    // Held sub-task: only it is cancelled; the rest resumes, and running work is refused
    const b = restarted([leadFinal, dev("Ann", { delayMs: 20_000 })], saved).h;
    assert.deepEqual(b.orc.cancelWorkItem(jobTwo.id), { ok: true });
    const two = b.orc.getWorkItems().find((i) => i.id === jobTwo.id)!;
    assert.deepEqual([two.state, two.held], ["cancelled", undefined]);
    assert.ok(itemUpdates(b).some((e) => e.item.id === jobTwo.id && e.item.state === "cancelled"), "the cancel was broadcast");
    assert.equal(b.orc.resumePool(), 2);
    const run = await b.waitFor(annStarted);
    assert.equal(run.taskId, jobOne.id);
    const busy = b.orc.cancelWorkItem(jobOne.id);
    assert.equal(busy.ok, false, "a running sub-task cannot be cancelled");
    assert.equal(b.orc.cancelWorkItem(root.id).ok, false, "nor a Boss item with a running sub-task");
    assert.equal(b.orc.getWorkItems().find((i) => i.id === root.id)?.state, "running");
  });

  it("a Boss task assigned while the Lead finishes the previous one still runs", async () => {
    const h = harness([
      { match: "New result from", text: "FINAL SUMMARY: all done.", delayMs: 400 },
      { match: "The Boss assigned you a task", text: "TASK: job" },
      dev("Ann"),
    ], { handoffDurationMs: () => 700 });
    hireTeam(h, ["Ann"]);
    h.orc.bossAssign({ prompt: "First task", urgent: false });
    // The Lead's result run (final summary) has started: assign the next task now
    await h.waitFor((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId === LEAD && /New result from/.test(e.prompt), 9000);
    const second = h.orc.bossAssign({ prompt: "Second task", urgent: false });
    assert.ok(second.ok);
    await h.waitFor(isFinal, 9000);
    const midway = h.orc.getWorkItems().find((i) => second.ok && i.id === second.item.id)!;
    assert.notEqual(midway.state, "done", "the first final result did not finish the task still walking over");
    await h.waitFor((e) => e.type === "work:updated" && second.ok && e.item.id === second.item.id && e.item.state === "done", 9000);
    const bossRuns = h.records().filter((r) => r.rule === 1);
    assert.equal(bossRuns.length, 2, "the Lead ran both Boss tasks");
  });

  it("the Boss hand-off delays the Lead's start by durationMs", async () => {
    const h = harness([{ match: ".*", text: "Nothing to delegate." }], { handoffDurationMs: () => 250 });
    hireTeam(h, ["Ann"]);
    const t0 = Date.now();
    h.orc.bossAssign({ prompt: "Say hi", urgent: true });
    const handoff = h.events.find((e): e is HandoffEvent => e.type === "handoff");
    assert.deepEqual(handoff && { kind: handoff.kind, from: handoff.fromId, to: handoff.toId, ms: handoff.durationMs }, { kind: "boss_to_lead", from: "boss", to: LEAD, ms: 250 });
    const leadStart = await h.waitFor((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId === LEAD);
    assert.ok(Date.now() - t0 >= 240, "the Lead did not start before the hand-off ended");
    assert.equal(leadStart.taskId, handoff!.workItemId);
    const root = await h.waitFor((e): e is WorkItemUpdatedEvent => e.type === "work:updated" && e.item.origin === "boss" && e.item.state === "done");
    assert.equal(root.item.priority, "urgent");
  });

  it("rejects BOSS_ASSIGN without a Team Lead", () => {
    const h = harness([]);
    const res = h.orc.bossAssign({ prompt: "x", urgent: false });
    assert.equal(res.ok, false);
  });
});

describe("Lead tools are decided by the daemon", () => {
  let h: Harness | null = null;
  afterEach(() => { h?.destroy(); h = null; });

  const policy = (p: Partial<LeadPolicyConfig>) => () => ({ ...DEFAULT_LEAD_POLICY, ...p });

  it("defaults: subagent tool only while every dev is busy and work is queued", async () => {
    h = createHarness({
      rules: [
        { match: "SECOND", toolUses: [{ name: "Agent", input: { description: "help with job two", subagent_type: "general-purpose" } }], text: "Started a helper." },
        { match: "The Boss assigned you a task", text: ["TASK: job one", "TASK: job two"] },
        dev("Ann", { delayMs: 20_000 }),
      ],
    });
    hireTeam(h, ["Ann"]);
    h.orc.bossAssign({ prompt: "FIRST task", urgent: false });
    await h.waitFor((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId === "dev-ann");
    // Ann is busy and job two is queued: the next Lead run may use subagents
    h.orc.bossAssign({ prompt: "SECOND task", urgent: false });
    const sub = await h.waitFor((e): e is LeadSubagentStartedEvent => e.type === "lead:subagent-started");
    assert.equal(sub.description, "help with job two");
    assert.equal(sub.subagentType, "general-purpose");

    const runs = h.records();
    const first = runs.find((r) => r.rule === 1)!;
    const second = runs.find((r) => r.rule === 0)!;
    assert.equal(flag(first.argv, "--tools"), "", "no tools while a dev was idle");
    assert.equal(flag(second.argv, "--tools"), "Agent", "only the subagent tool");
    assert.ok(!second.argv.includes("--disallowedTools"));
  });

  it("subagents: never denies the tool even when everyone is busy", async () => {
    h = createHarness({
      rules: [
        { match: "SECOND", text: "ok" },
        { match: "The Boss assigned you a task", text: ["TASK: job one", "TASK: job two"] },
        dev("Ann", { delayMs: 20_000 }),
      ],
      leadPolicy: policy({ subagents: "never" }),
    });
    hireTeam(h, ["Ann"]);
    h.orc.bossAssign({ prompt: "FIRST task", urgent: false });
    await h.waitFor((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId === "dev-ann");
    h.orc.bossAssign({ prompt: "SECOND task", urgent: false });
    await h.waitFor((e): e is TaskDoneEvent => e.type === "task:done" && e.agentId === LEAD && /ok/.test(e.result.summary));
    const second = h.records().find((r) => r.rule === 0)!;
    assert.equal(flag(second.argv, "--tools"), "");
  });

  it("with the defaults the Lead never self-works, even after waitMs", async () => {
    h = createHarness({
      rules: [{ match: "The Boss assigned you a task", text: ["TASK: job one", "TASK: job two"] }, dev("Ann", { delayMs: 20_000 })],
      leadPolicy: policy({ waitMs: 50 }),
    });
    hireTeam(h, ["Ann"]);
    h.orc.bossAssign({ prompt: "Two jobs", urgent: true, allowLeadSelfWork: true });
    await h.waitFor((e): e is TaskStartedEvent => e.type === "task:started" && e.agentId === "dev-ann");
    await sleep(400);
    assert.equal(h.events.filter((e) => e.type === "lead:self-work").length, 0);
    assert.equal(h.records().filter((r) => !r.argv.includes("--tools")).length, 1, "only Ann ran with tools");
  });

  it("when_no_dev_after_wait: after waitMs the Lead does the queued item with tools, minus subagents", async () => {
    h = createHarness({
      rules: [
        leadFinal,
        { match: "Your name is Lee, your role is Team Lead, doing this task yourself", text: ["STATUS: done", "SUMMARY: Lee did job two"] },
        { match: "The Boss assigned you a task", text: ["TASK: job one", "TASK: job two"] },
        dev("Ann", { delayMs: 1500 }),
      ],
      leadPolicy: policy({ selfWork: "when_no_dev_after_wait", subagents: "never", waitMs: 100 }),
    });
    hireTeam(h, ["Ann"]);
    h.orc.bossAssign({ prompt: "Two jobs", urgent: false });
    const sw = await h.waitFor((e): e is LeadSelfWorkEvent => e.type === "lead:self-work");
    await h.waitFor(isFinal, 9000);
    const run = h.records().find((r) => r.rule === 1)!;
    assert.ok(run, "the Lead ran the self-work prompt");
    assert.ok(!run.argv.includes("--tools"), "full tool set");
    assert.equal(flag(run.argv, "--disallowedTools"), "Agent,Task");
    const item = h.orc.getWorkItems().find((i) => i.id === sw.workItemId)!;
    assert.equal(item.state, "done");
    assert.equal(item.assigneeId, LEAD);
    assert.equal(lastItem(h, (i) => i.id === sw.workItemId)?.state, "done");
  });
});
