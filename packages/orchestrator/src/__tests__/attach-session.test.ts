// Phase 2a: an attached Claude Code session as a team dev, with fakes only.
// Fork mode runs fake-agent.mjs with the exact fork argv; live mode talks to
// fake-claude-session.mjs (a fake inbox socket + transcript). No real CLI runs.
import "./helpers/env.js";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync } from "fs";
import { join } from "path";
import { createHarness, type Harness, type ScenarioRule } from "./helpers/harness.js";
import { buildClaudeForkArgs, createClaudeForkDriver, FORK_NOTE } from "../drivers/claude-fork.js";
import { createClaudeLiveDriver, liveTaskMarker } from "../drivers/claude-live.js";
import { FAKE_AGENT_SCRIPT } from "../testing/fake-backend.js";
import { startFakeClaudeSession, type FakeClaudeSession } from "../testing/fake-session.js";
import { isPidAlive } from "../proc.js";
import type { AgentDriver, AttachTarget } from "../drivers/driver.js";
import type { OrchestratorEvent, TaskDoneEvent, WorkItemUpdatedEvent } from "../types.js";

const LEAD = "lead-1";
const ATT = "ext-claude-4242";
const leadFinal: ScenarioRule = { match: "New result from", text: "FINAL SUMMARY: delivered." };
const leadSplit: ScenarioRule = { match: "The Boss assigned you a task", text: ["TASK: fix the login form"] };
const attachedRule: ScenarioRule = { match: "added this Claude Code session", text: ["STATUS: done", "SUMMARY: fixed in the fork"], delayMs: 200 };

const isFinal = (e: OrchestratorEvent): e is TaskDoneEvent => e.type === "task:done" && e.agentId === LEAD && e.isFinalResult === true;
const subItems = (h: Harness) => h.orc.getWorkItems().filter((i) => i.origin === "lead");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hire(h: Harness, driver: AgentDriver): void {
  const teamId = "team-a";
  h.orc.setTeamLead(LEAD);
  h.orc.createAgent({ agentId: LEAD, name: "Lee", role: "Team Lead", backend: "fake", teamId });
  h.orc.createAgent({ agentId: ATT, name: "Webshop", role: "Developer — attached Claude Code session", backend: "fake", teamId, driver });
  h.orc.setTeamPhase(teamId, "create", LEAD);
}

describe("fork mode command line", () => {
  it("builds exactly the documented fork argv", () => {
    assert.deepEqual(
      buildClaudeForkArgs("do it", "sess-1", { permissionMode: "auto" }, ["/team/project"]),
      ["-p", "do it", "--resume", "sess-1", "--fork-session", "--output-format", "stream-json", "--verbose", "--permission-mode", "auto", "--add-dir", "/team/project"],
    );
    // Bypass only with the owner's explicit per-backend opt-in; "default" adds nothing
    assert.ok(buildClaudeForkArgs("x", "s", { permissionMode: "bypass" }).includes("--dangerously-skip-permissions"));
    assert.ok(!buildClaudeForkArgs("x", "s", { permissionMode: "default" }).includes("--permission-mode"));
    assert.deepEqual(buildClaudeForkArgs("x", "s", { permissionMode: "auto", model: "sonnet" }).slice(-2), ["--model", "sonnet"]);
  });
});

describe("attached Claude session as a team dev", () => {
  let hs: Harness[] = [];
  let sessions: FakeClaudeSession[] = [];
  afterEach(async () => {
    for (const h of hs) h.destroy();
    for (const s of sessions) await s.stop();
    hs = [];
    sessions = [];
  });
  const harness = (rules: ScenarioRule[], opts: Omit<Parameters<typeof createHarness>[0], "rules"> = {}) => {
    const h = createHarness({ rules, ...opts });
    hs.push(h);
    return h;
  };

  function forkDriver(h: Harness, target: AttachTarget, extra: { externallyBusy?: () => boolean } = {}) {
    const recordFile = join(h.root, "fork-runs.jsonl");
    const driver = createClaudeForkDriver({
      target: () => target,
      command: process.execPath,
      prefixArgs: [FAKE_AGENT_SCRIPT, "--scenario", join(h.root, "scenario.json"), "--record", recordFile],
      externallyBusy: extra.externallyBusy,
    });
    const runs = () => existsSync(recordFile)
      ? readFileSync(recordFile, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string })
      : [];
    return { driver, runs };
  }

  it("fork: the Lead's sub-task walks to the attached session and runs in a fork of it", async () => {
    const h = harness([leadFinal, leadSplit, attachedRule], { handoffDurationMs: () => 50 });
    const ownerDir = join(h.root, "owner-repo");
    const teamDir = join(h.root, "team-project");
    mkdirSync(ownerDir, { recursive: true });
    mkdirSync(teamDir, { recursive: true });
    const { driver, runs } = forkDriver(h, { pid: 4242, cwd: ownerDir, sessionId: "owner-session-1", transcriptPath: join(ownerDir, "t.jsonl") });
    assert.equal(driver.note, FORK_NOTE);
    hire(h, driver);
    h.orc.setTeamProjectDir(teamDir);

    assert.ok(h.orc.bossAssign({ prompt: "Fix login", urgent: false }).ok);
    await h.waitFor(isFinal, 9000);

    const handoff = h.events.find((e) => e.type === "handoff" && e.kind === "lead_to_dev");
    assert.ok(handoff && handoff.type === "handoff" && handoff.toId === ATT && handoff.durationMs === 50, "the Lead walked the paper to the attached session");
    const [item] = subItems(h);
    assert.equal(item.assigneeId, ATT);
    assert.equal(item.state, "done");

    const [run] = runs();
    assert.ok(run, "one fork run");
    const argv = run.argv.slice(4); // drop fake-agent prefix: script --scenario file --record file
    const prompt = argv[1];
    assert.deepEqual(argv, buildClaudeForkArgs(prompt, "owner-session-1", { permissionMode: "auto" }, [teamDir]));
    assert.equal(realpathSync(run.cwd), realpathSync(ownerDir), "runs in the owner's own directory");
    assert.match(prompt, /added this Claude Code session to their Pixel Crew team as the developer "Webshop"/);
    assert.match(prompt, /fix the login form/);
    assert.doesNotMatch(prompt, /Your name is/, "no persona for a borrowed session");
    const done = h.events.find((e): e is TaskDoneEvent => e.type === "task:done" && e.agentId === ATT);
    assert.match(done!.result.summary, /fixed in the fork/);
  });

  it("fork: the owner being mid-turn keeps work away until the session is idle again", async () => {
    const h = harness([leadFinal, leadSplit, attachedRule]);
    const ownerDir = join(h.root, "owner");
    mkdirSync(ownerDir, { recursive: true });
    let ownerBusy = true;
    const { driver, runs } = forkDriver(h, { pid: 1, cwd: ownerDir, sessionId: "s", transcriptPath: "" }, { externallyBusy: () => ownerBusy });
    hire(h, driver);
    assert.ok(h.orc.bossAssign({ prompt: "Fix login", urgent: false }).ok);
    await h.waitFor((e) => e.type === "lead:waiting" && e.queueLength === 1, 6000);
    await sleep(300);
    assert.equal(runs().length, 0);
    assert.equal(subItems(h)[0].state, "queued");
    ownerBusy = false;
    h.orc.pokeDispatcher(); // the gateway pokes when the owner's session goes idle
    await h.waitFor(isFinal, 9000);
    assert.equal(subItems(h)[0].state, "done");
  });

  it("fork: removing the attached member mid-task re-queues its item", async () => {
    const h = harness([{ match: "The Boss assigned you a task", text: ["TASK: long job"] }, { ...attachedRule, delayMs: 5000 }]);
    const ownerDir = join(h.root, "owner");
    mkdirSync(ownerDir, { recursive: true });
    const { driver } = forkDriver(h, { pid: 1, cwd: ownerDir, sessionId: "s", transcriptPath: "" });
    hire(h, driver);
    assert.ok(h.orc.bossAssign({ prompt: "Long", urgent: false }).ok);
    await h.waitFor((e) => e.type === "task:started" && e.agentId === ATT, 6000);
    const pid = h.orc.getAgent(ATT)!.pid!;
    assert.ok(pid > 0);
    h.orc.removeAgent(ATT); // the session went away / the owner detached it
    const requeued = await h.waitFor((e): e is WorkItemUpdatedEvent => e.type === "work:updated" && e.item.origin === "lead" && e.item.state === "queued" && e.item.attempts === 1, 4000);
    assert.equal(requeued.item.assigneeId, null);
    await sleep(200);
    assert.equal(isPidAlive(pid), false, "the fork process was killed");
  });

  it("live: the task goes into the session's inbox and completes at the transcript's turn end", async () => {
    const h = harness([leadFinal, leadSplit]);
    const home = join(h.root, "claude-home");
    const ownerDir = join(h.root, "owner");
    mkdirSync(ownerDir, { recursive: true });
    const fake = await startFakeClaudeSession({ home, cwd: ownerDir, replyDelayMs: 300 });
    sessions.push(fake);
    const target: AttachTarget = { pid: fake.pid, cwd: ownerDir, sessionId: fake.sessionId, transcriptPath: fake.transcript, messagingSocketPath: fake.socketPath ?? undefined };
    const driver = createClaudeLiveDriver({ target: () => target, isAlive: () => isPidAlive(fake.pid), pollMs: 50 });
    hire(h, driver);

    assert.ok(h.orc.bossAssign({ prompt: "Fix login", urgent: false }).ok);
    await h.waitFor(isFinal, 9000);
    const [item] = subItems(h);
    assert.equal(item.state, "done");
    assert.equal(item.assigneeId, ATT);
    const transcript = readFileSync(fake.transcript, "utf-8");
    assert.ok(transcript.includes(liveTaskMarker(item.id)), "the message reached the session");
    const done = h.events.find((e): e is TaskDoneEvent => e.type === "task:done" && e.agentId === ATT);
    assert.match(done!.result.summary, /Finished the task in my own session/);
    assert.equal(h.orc.getAgent(ATT)!.pid, null, "live mode spawns nothing");
  });

  it("live: the session dying mid-task re-queues the item (zombie rule)", async () => {
    const h = harness([{ match: "The Boss assigned you a task", text: ["TASK: fix it"] }]);
    const home = join(h.root, "claude-home");
    const ownerDir = join(h.root, "owner");
    mkdirSync(ownerDir, { recursive: true });
    const fake = await startFakeClaudeSession({ home, cwd: ownerDir, exitAfterDelivery: true });
    sessions.push(fake);
    const target: AttachTarget = { pid: fake.pid, cwd: ownerDir, sessionId: fake.sessionId, transcriptPath: fake.transcript, messagingSocketPath: fake.socketPath ?? undefined };
    const driver = createClaudeLiveDriver({ target: () => target, isAlive: () => isPidAlive(fake.pid), pollMs: 50 });
    hire(h, driver);
    assert.ok(h.orc.bossAssign({ prompt: "Fix", urgent: false }).ok);
    const requeued = await h.waitFor((e): e is WorkItemUpdatedEvent => e.type === "work:updated" && e.item.origin === "lead" && e.item.state === "queued" && e.item.attempts === 1, 8000);
    assert.match(requeued.item.error ?? "", /interrupted/);
    assert.ok(statSync(fake.transcript).size > 0);
  });

  it("live: a session without an inbox socket fails the run instead of hanging", async () => {
    const h = harness([{ match: "The Boss assigned you a task", text: ["TASK: fix it"] }], { dispatch: { maxAttempts: 1 } });
    const ownerDir = join(h.root, "owner");
    mkdirSync(ownerDir, { recursive: true });
    const driver = createClaudeLiveDriver({ target: () => ({ pid: process.pid, cwd: ownerDir, sessionId: "s", transcriptPath: join(ownerDir, "none.jsonl") }), isAlive: () => true });
    hire(h, driver);
    assert.ok(h.orc.bossAssign({ prompt: "Fix", urgent: false }).ok);
    const failed = await h.waitFor((e): e is WorkItemUpdatedEvent => e.type === "work:updated" && e.item.origin === "lead" && e.item.state === "failed", 6000);
    assert.equal(failed.item.assigneeId, ATT);
  });
});
