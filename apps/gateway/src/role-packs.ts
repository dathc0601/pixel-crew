/**
 * Startup wiring for role packs: write the `--agents` JSON into the Pixel Crew data dir,
 * point the Claude backend at it, and remove unchanged copies older versions left in
 * ~/.claude/agents/. Nothing here writes under ~/.claude/.
 */
import { join } from "path";
import { getBundledAgentsDir, writeClaudeAgentsFile } from "@pixel-crew/orchestrator";
import { setClaudeAgentsFile } from "./backends.js";
import { cleanupLegacyAgentFiles, shouldRunLegacyCleanup, type LegacyCleanupResult } from "./legacy-agent-cleanup.js";

export interface SetupRolePacksOptions {
  demo: boolean;
  /** Pixel Crew data dir (CONFIG_DIR); the file goes to <dataDir>/data/claude-agents.json */
  dataDir: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  bundledDir?: string;
  log?: (msg: string) => void;
}

export function claudeAgentsFilePath(dataDir: string): string {
  return join(dataDir, "data", "claude-agents.json");
}

export function setupRolePacks(opts: SetupRolePacksOptions): { agentsFile?: string; cleanup?: LegacyCleanupResult } {
  const log = opts.log ?? ((msg: string) => console.log(msg));
  // Demo agents are the scripted fake backend: no Claude runs, nothing to write or clean.
  if (opts.demo) {
    setClaudeAgentsFile(undefined);
    return {};
  }
  const bundledDir = opts.bundledDir ?? getBundledAgentsDir();
  let agentsFile: string | undefined;
  try {
    const written = writeClaudeAgentsFile(claudeAgentsFilePath(opts.dataDir), bundledDir);
    for (const file of written.invalid) log(`[Agents] Skipping ${file}: front matter needs name and description`);
    agentsFile = written.file;
    log(`[Agents] Wrote ${written.count} role packs to ${written.file}`);
  } catch (e) {
    log(`[Agents] Could not write role packs (${(e as Error).message}); agents run without them`);
  }
  setClaudeAgentsFile(agentsFile);

  let cleanup: LegacyCleanupResult | undefined;
  if (shouldRunLegacyCleanup({ demo: opts.demo, env: opts.env })) {
    try {
      cleanup = cleanupLegacyAgentFiles({ bundledDir, home: opts.home, log });
    } catch (e) {
      log(`[Agents] Legacy cleanup failed: ${(e as Error).message}`);
    }
  }
  return { agentsFile, cleanup };
}
