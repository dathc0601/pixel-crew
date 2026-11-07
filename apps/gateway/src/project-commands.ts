// END_PROJECT, kept apart from index.ts so it can be tested with a stub orchestrator.
import type { Command } from "@pixel-crew/shared";
import type { Orchestrator } from "@pixel-crew/orchestrator";

export type EndProjectCommand = Extract<Command, { type: "END_PROJECT" }>;

/** The orchestrator calls END_PROJECT needs. There is deliberately no runTask: ending a project never starts a run. */
export interface EndProjectOrchestrator {
  clearLeaderHistory(agentId: string): void;
  getAgent(agentId: string): object | undefined;
  createAgent(opts: Parameters<Orchestrator["createAgent"]>[0]): void;
  getAllTeamPhases(): Array<{ teamId: string; leadAgentId: string }>;
  getAllAgents(): Array<{ agentId: string; teamId?: string }>;
  setTeamLead(agentId: string): void;
  setTeamPhase(teamId: string, phase: Parameters<Orchestrator["setTeamPhase"]>[1], leadAgentId: string): void;
}

export interface EndProjectDeps {
  /** Backend for an agent auto-created here (the gateway's default backend) */
  defaultBackend: string;
  /** Archive the finished project and reset the event buffer (gateway state) */
  archive(): void;
}

/**
 * End the current project: archive it, clear the team's history, and put the team
 * back in the create phase. Nothing runs until the Boss assigns new work (no greet
 * run, plan P1.7). Returns the team id that was reset.
 */
export function endProject(orc: EndProjectOrchestrator, cmd: EndProjectCommand, deps: EndProjectDeps): { teamId: string } {
  const agentId = cmd.agentId;

  // Project was already archived when phase hit "complete".
  // If somehow it wasn't (e.g. solo agent, no phase machine), archive now as fallback.
  deps.archive();

  orc.clearLeaderHistory(agentId);

  // Auto-create agent if not in orchestrator (e.g. after gateway restart)
  if (!orc.getAgent(agentId) && cmd.name) {
    const backendId = cmd.backend ?? deps.defaultBackend;
    console.log(`[Gateway] END_PROJECT: auto-creating agent ${agentId}`);
    orc.createAgent({
      agentId,
      name: cmd.name,
      role: cmd.role ?? "",
      personality: cmd.personality,
      backend: backendId,
    });
  }

  // Find teamId from orchestrator, or recover
  let teamId = orc.getAllTeamPhases().find((tp) => tp.leadAgentId === agentId)?.teamId;
  if (!teamId) {
    const agentInfo = orc.getAllAgents().find((a) => a.agentId === agentId);
    teamId = agentInfo?.teamId ?? `team-${agentId}`;
  }
  // Ensure agent is recognized as team lead, then reset to create phase
  orc.setTeamLead(agentId);
  orc.setTeamPhase(teamId, "create", agentId);
  return { teamId };
}
