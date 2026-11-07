// Phase 2a: attaching external Claude Code sessions to the team, with fakes only.
// The "external session" is fake-claude-session.mjs (registry entry + transcript + inbox
// socket in a temp Claude config dir); fork runs are fake-agent.mjs. No real CLI runs.
import { TEST_HOME } from "./helpers/test-env.js";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import {
  createFakeBackend,
  createOrchestrator,
  FAKE_AGENT_SCRIPT,
  isPidAlive,
  setSessionDir,
  setStorageRoot,
  startFakeClaudeSession,
  type FakeClaudeSession,
  type Orchestrator,
  type OrchestratorEvent,
} from "@pixel-crew/orchestrator";
import type { GatewayEvent } from "@pixel-crew/shared";
import { AttachManager, type ExternalSession } from "../attach/attach-manager.js";
import { handleAttachCommand } from "../attach/attach-commands.js";
import { argsBypassPermissions, readClaudeSession } from "../attach/claude-sessions.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Office {
  root: string;
  orc: Orchestrator;
  events: OrchestratorEvent[];
  manager: AttachManager;
  stateFile: string;
  claudeHome: string;
  scenario: string;
  forkRuns(): Array<{ argv: string[]; cwd: string }>;
  waitFor(pred: (e: OrchestratorEvent) => boolean, ms?: number): Promise<OrchestratorEvent>;
}

const RULES = [
  { match: "New result from", text: "FINAL SUMMARY: done." },
  { match: "The Boss assigned you a task", text: ["TASK[claude]: check the checkout page"] },
  { match: "added this Claude Code session", text: ["STATUS: done", "SUMMARY: checked in the fork"], delayMs: 300 },
  { match: "Your name is", text: ["STATUS: done", "SUMMARY: regular dev"], delayMs: 300 },
];

function makeOffice(opts: { root?: string; withTeam?: boolean; slowFork?: boolean } = {}): Office {
  const root = opts.root ?? mkdtempSync(path.join(TEST_HOME, "attach-"));
  setSessionDir(path.join(root, "instance"));
  setStorageRoot(path.join(root, "memory"));
  const scenario = path.join(root, "scenario.json");
  const rules = opts.slowFork ? RULES.map((r) => (r.match.startsWith("added") ? { ...r, delayMs: 8000 } : r)) : RULES;
  writeFileSync(scenario, JSON.stringify({ rules }));
  mkdirSync(path.join(root, "workspace"), { recursive: true });
  const orc = createOrchestrator({
    workspace: path.join(root, "workspace"),
    backends: [createFakeBackend({ scenarioFile: scenario, id: "claude" })],
    defaultBackend: "claude",
    worktree: false,
    retry: false,
    handoffDurationMs: () => 30,
  });
  const events: OrchestratorEvent[] = [];
  const waiters: Array<{ pred: (e: OrchestratorEvent) => boolean; resolve: (e: OrchestratorEvent) => void }> = [];
  for (const name of ["task:started", "task:done", "agent:created", "agent:fired", "work:updated", "handoff"] as const) {
    orc.on(name, ((e: OrchestratorEvent) => {
      events.push(e);
      for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); }
    }) as never);
  }
  if (opts.withTeam !== false && !orc.getAgent("lead")) {
    orc.setTeamLead("lead");
    orc.createAgent({ agentId: "lead", name: "Lee", role: "Team Lead", teamId: "team-1" });
    orc.setTeamPhase("team-1", "create", "lead");
  }
  const claudeHome = path.join(root, "claude-home");
  const stateFile = path.join(root, "instance", "attachments.json");
  const forkRecord = path.join(root, "fork-runs.jsonl");
  const manager = new AttachManager({
    host: {
      team: () => (orc.getAgent("lead") ? { teamId: "team-1", leadId: "lead" } : null),
      createAgent: (o) => orc.createAgent(o),
      removeAgent: (id) => orc.removeAgent(id),
      hasAgent: (id) => !!orc.getAgent(id),
      agentNames: () => orc.getAllAgents().map((a) => a.name),
      poke: () => orc.pokeDispatcher(),
      backendId: "claude",
    },
    claudeHome,
    stateFile,
    forkCommand: { command: process.execPath, prefixArgs: [FAKE_AGENT_SCRIPT, "--scenario", scenario, "--record", forkRecord] },
    live: { pollMs: 50 },
    tickMs: 100,
  });
  return {
    root, orc, events, manager, stateFile, claudeHome, scenario,
    forkRuns: () => (existsSync(forkRecord) ? readFileSync(forkRecord, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    waitFor(pred, ms = 8000) {
      const hit = events.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout; saw ${events.map((e) => e.type).join(", ")}`)), ms);
        waiters.push({ pred, resolve: (e) => { clearTimeout(t); resolve(e); } });
      });
    },
  };
}

function externalOf(s: FakeClaudeSession, args = "claude"): ExternalSession {
  return { agentId: `ext-claude-${s.pid}`, pid: s.pid, cwd: s.cwd, backendId: "claude", palette: 2, args };
}

describe("attaching external Claude sessions", () => {
  let offices: Office[] = [];
  let sessions: FakeClaudeSession[] = [];
  afterEach(async () => {
    for (const o of offices) { o.manager.stop(); o.orc.destroy(); }
    for (const s of sessions) await s.stop();
    offices = [];
    sessions = [];
  });
  const office = (opts?: Parameters<typeof makeOffice>[0]) => { const o = makeOffice(opts); offices.push(o); return o; };
  const fakeSession = async (o: Office, extra: { noSocket?: boolean; replyDelayMs?: number } = {}) => {
    const cwd = path.join(o.root, "terminal", "web-shop");
    mkdirSync(cwd, { recursive: true });
    const s = await startFakeClaudeSession({ home: o.claudeHome, cwd, replyDelayMs: extra.replyDelayMs ?? 200, noSocket: extra.noSocket });
    sessions.push(s);
    return s;
  };

  it("offers fork (and live when the session has an inbox), and only for Claude", async () => {
    const o = office();
    const s = await fakeSession(o);
    const opts = o.manager.options(externalOf(s));
    assert.deepEqual(opts.map((x) => x.mode), ["fork", "live"]);
    assert.match(opts[0].note, /fork of this session; your terminal is not touched/);
    assert.match(o.manager.options(externalOf(s, "claude --dangerously-skip-permissions"))[1].note, /asks you there to accept each task/);
    assert.deepEqual(o.manager.options({ ...externalOf(s), backendId: "codex" }), []);
    const noSock = await fakeSession(o, { noSocket: true });
    assert.deepEqual(o.manager.options(externalOf(noSock)).map((x) => x.mode), ["fork"]);
    assert.equal(readClaudeSession(o.claudeHome, s.pid)?.sessionId, s.sessionId);
    assert.ok(argsBypassPermissions("claude --dangerously-skip-permissions"));
  });

  it("attach → the Lead walks a sub-task over → it runs as a fork → done", async () => {
    const o = office();
    const s = await fakeSession(o);
    const ext = externalOf(s);
    const res = o.manager.attach(ext, "fork");
    assert.ok(res.ok, !res.ok ? res.error : "");
    const agent = o.orc.getAgent(ext.agentId)!;
    assert.equal(agent.teamId, "team-1");
    assert.equal(agent.name, "WebShop");
    assert.deepEqual(o.manager.wireFields(ext.agentId), { attached: true, attachMode: "fork", attachNote: "Work runs in a fork of this session; your terminal is not touched.", isExternal: false });
    assert.equal(JSON.parse(readFileSync(o.stateFile, "utf-8")).attachments[0].sessionId, s.sessionId);

    assert.ok(o.orc.bossAssign({ prompt: "Check checkout", urgent: false }).ok);
    const handoff = await o.waitFor((e) => e.type === "handoff" && e.kind === "lead_to_dev");
    assert.equal(handoff.type === "handoff" && handoff.toId, ext.agentId);
    await o.waitFor((e) => e.type === "task:done" && e.agentId === "lead" && e.isFinalResult === true, 10_000);
    const item = o.orc.getWorkItems().find((i) => i.origin === "lead")!;
    assert.equal(item.state, "done");
    const [run] = o.forkRuns();
    const argv = run.argv.slice(4);
    assert.deepEqual(argv.slice(2, 9), ["--resume", s.sessionId, "--fork-session", "--output-format", "stream-json", "--verbose", "--permission-mode"]);
    assert.equal(argv[9], "auto");
  });

  it("is owner-only", async () => {
    const o = office();
    const s = await fakeSession(o);
    const replies: GatewayEvent[] = [];
    const deps = { manager: o.manager, external: () => externalOf(s), reply: (e: GatewayEvent) => replies.push(e) };
    for (const role of ["collaborator", "spectator"] as const) {
      handleAttachCommand({ type: "ATTACH_EXTERNAL", agentId: externalOf(s).agentId }, { role }, deps);
    }
    assert.equal(o.orc.getAgent(externalOf(s).agentId), undefined);
    assert.ok(replies.every((r) => r.type === "ATTACH_RESULT" && !r.ok && /Only the owner/.test(r.error ?? "")));
    handleAttachCommand({ type: "ATTACH_EXTERNAL", agentId: externalOf(s).agentId, mode: "live" }, { role: "owner" }, deps);
    assert.ok(o.manager.isAttached(externalOf(s).agentId));
    assert.equal(o.manager.get(externalOf(s).agentId)?.mode, "live");
    handleAttachCommand({ type: "DETACH_AGENT", agentId: externalOf(s).agentId }, { role: "collaborator" }, deps);
    assert.ok(o.manager.isAttached(externalOf(s).agentId), "a collaborator cannot detach");
    const last = replies.at(-1);
    assert.ok(last?.type === "ATTACH_RESULT" && last.action === "detach" && !last.ok);
  });

  it("refuses without a team, and refuses a session that is gone", async () => {
    const o = office({ withTeam: false });
    const s = await fakeSession(o);
    const r1 = o.manager.attach(externalOf(s));
    assert.ok(!r1.ok && /Hire a team first/.test(r1.error));
    const o2 = office();
    const r2 = o2.manager.attach({ ...externalOf(s), pid: 999_999_9 });
    assert.ok(!r2.ok && /no longer running/.test(r2.error));
  });

  it("detach: the member leaves, the agent:fired is recognized and the state file empties", async () => {
    const o = office();
    const s = await fakeSession(o);
    const ext = externalOf(s);
    assert.ok(o.manager.attach(ext).ok);
    let recognized = false;
    o.orc.on("agent:fired", (e) => { recognized = o.manager.onAgentFired(e.agentId); });
    o.manager.detach(ext.agentId);
    assert.equal(o.orc.getAgent(ext.agentId), undefined);
    assert.ok(recognized, "gateway shows it as external again instead of removing it");
    assert.equal(o.manager.isAttached(ext.agentId), false);
    assert.deepEqual(JSON.parse(readFileSync(o.stateFile, "utf-8")).attachments, []);
    assert.ok(isPidAlive(s.pid), "the owner's session keeps running");
  });

  it("the session dying mid-task detaches it and re-queues the item", async () => {
    const o = office({ slowFork: true });
    const s = await fakeSession(o);
    const ext = externalOf(s);
    assert.ok(o.manager.attach(ext).ok);
    o.manager.start();
    assert.ok(o.orc.bossAssign({ prompt: "Check checkout", urgent: false }).ok);
    await o.waitFor((e) => e.type === "task:started" && e.agentId === ext.agentId);
    const forkPid = o.orc.getAgent(ext.agentId)!.pid!;
    await s.stop(); // the owner closed the terminal
    const requeued = await o.waitFor((e) => e.type === "work:updated" && e.item.origin === "lead" && e.item.state === "queued" && e.item.attempts === 1, 5000);
    assert.ok(requeued.type === "work:updated" && requeued.item.assigneeId === null);
    assert.equal(o.orc.getAgent(ext.agentId), undefined);
    assert.equal(o.manager.isAttached(ext.agentId), false);
    await sleep(200);
    assert.equal(isPidAlive(forkPid), false, "the fork run was stopped");
  });

  it("restores attachments after a restart only while the same session still runs", async () => {
    const o = office();
    const s = await fakeSession(o);
    const ext = externalOf(s);
    assert.ok(o.manager.attach(ext, "live").ok);
    o.orc.destroy();

    // Restart #1: the session still runs → restored with the same mode
    const again = office({ root: o.root });
    const restored = again.manager.restore();
    assert.deepEqual(restored.map((a) => [a.agentId, a.mode]), [[ext.agentId, "live"]]);
    assert.equal(again.orc.getAgent(ext.agentId)?.teamId, "team-1");
    again.orc.destroy();

    // Restart #2: the session is gone → dropped
    await s.stop();
    const third = office({ root: o.root });
    assert.deepEqual(third.manager.restore(), []);
    assert.equal(third.orc.getAgent(ext.agentId), undefined);
    assert.deepEqual(JSON.parse(readFileSync(o.stateFile, "utf-8")).attachments, []);
  });
});
