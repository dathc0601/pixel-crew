// END_PROJECT: resets the team to the create phase and never starts a run (plan P1.7).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { endProject, type EndProjectCommand, type EndProjectOrchestrator } from "../project-commands.js";

interface StubAgent { agentId: string; name: string; teamId?: string }

function stubOrchestrator(opts: { agents?: StubAgent[]; phases?: Array<{ teamId: string; leadAgentId: string }> } = {}) {
  const agents = [...(opts.agents ?? [])];
  const calls: string[] = [];
  const created: Array<Parameters<EndProjectOrchestrator["createAgent"]>[0]> = [];
  const leads: string[] = [];
  const phases: Array<{ teamId: string; phase: string; leadAgentId: string }> = [];
  const runs: unknown[] = [];
  const orc = {
    clearLeaderHistory: (agentId: string) => { calls.push(`clear:${agentId}`); },
    getAgent: (agentId: string) => agents.find((a) => a.agentId === agentId),
    createAgent: (o: Parameters<EndProjectOrchestrator["createAgent"]>[0]) => {
      created.push(o);
      agents.push({ agentId: o.agentId, name: o.name, teamId: o.teamId });
    },
    getAllTeamPhases: () => opts.phases ?? [],
    getAllAgents: () => agents,
    setTeamLead: (agentId: string) => { leads.push(agentId); },
    setTeamPhase: (teamId: string, phase: string, leadAgentId: string) => { phases.push({ teamId, phase, leadAgentId }); },
    // Present on the real Orchestrator: END_PROJECT must never call it (it spends tokens)
    runTask: (...args: unknown[]) => { runs.push(args); },
  } satisfies EndProjectOrchestrator & { runTask: (...args: unknown[]) => void };
  return { orc, calls, created, leads, phases, runs };
}

const cmd = (extra: Partial<EndProjectCommand> = {}): EndProjectCommand => ({ type: "END_PROJECT", agentId: "lead-1", ...extra });

describe("END_PROJECT", () => {
  it("archives, clears history and resets the team to the create phase without a run", () => {
    const s = stubOrchestrator({ agents: [{ agentId: "lead-1", name: "Lee", teamId: "team-a" }], phases: [{ teamId: "team-a", leadAgentId: "lead-1" }] });
    let archived = 0;
    const res = endProject(s.orc, cmd(), { defaultBackend: "fake", archive: () => { archived++; } });
    assert.deepEqual(res, { teamId: "team-a" });
    assert.equal(archived, 1);
    assert.deepEqual(s.calls, ["clear:lead-1"]);
    assert.deepEqual(s.leads, ["lead-1"]);
    assert.deepEqual(s.phases, [{ teamId: "team-a", phase: "create", leadAgentId: "lead-1" }]);
    assert.equal(s.created.length, 0, "the agent exists, nothing is created");
    assert.equal(s.runs.length, 0, "no greet run");
  });

  it("auto-creates a missing agent (after a restart) and recovers a team id", () => {
    const s = stubOrchestrator();
    const res = endProject(s.orc, cmd({ name: "Lee", role: "Team Lead", personality: "calm" }), { defaultBackend: "fake", archive: () => {} });
    assert.deepEqual(s.created, [{ agentId: "lead-1", name: "Lee", role: "Team Lead", personality: "calm", backend: "fake" }]);
    assert.deepEqual(res, { teamId: "team-lead-1" });
    assert.deepEqual(s.phases, [{ teamId: "team-lead-1", phase: "create", leadAgentId: "lead-1" }]);
    assert.equal(s.runs.length, 0, "no greet run");
  });

  it("uses the command's backend and the agent's team when the phase machine has no entry", () => {
    const s = stubOrchestrator({ agents: [{ agentId: "lead-1", name: "Lee", teamId: "team-b" }] });
    endProject(s.orc, cmd({ name: "Lee", backend: "codex" }), { defaultBackend: "fake", archive: () => {} });
    assert.equal(s.created.length, 0);
    assert.deepEqual(s.phases, [{ teamId: "team-b", phase: "create", leadAgentId: "lead-1" }]);

    const t = stubOrchestrator();
    endProject(t.orc, cmd({ name: "Lee", backend: "codex" }), { defaultBackend: "fake", archive: () => {} });
    assert.equal(t.created[0].backend, "codex");
    assert.equal(t.runs.length, 0);
  });
});
