import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { TEST_HOME } from "./env.js";
import { createOrchestrator, createFakeBackend, setSessionDir, setStorageRoot } from "../../index.js";
import type { Orchestrator } from "../../orchestrator.js";
import type { OrchestratorEvent } from "../../types.js";
import type { PermissionPolicy } from "../../permissions.js";

export interface ScenarioRule {
  match: string;
  text?: string | string[];
  toolUses?: Array<{ name: string; input?: Record<string, unknown> }>;
  writeFiles?: Record<string, string>;
  delayMs?: number;
  exitCode?: number;
  stderr?: string;
}

export interface Harness {
  orc: Orchestrator;
  events: OrchestratorEvent[];
  workspace: string;
  records(): Array<{ argv: string[]; cwd: string; rule: number | "default" }>;
  waitFor<T extends OrchestratorEvent>(pred: (e: OrchestratorEvent) => e is T, timeoutMs?: number): Promise<T>;
  waitFor(pred: (e: OrchestratorEvent) => boolean, timeoutMs?: number): Promise<OrchestratorEvent>;
  destroy(): void;
}

const ALL_EVENTS = [
  "task:started", "task:done", "task:failed", "task:delegated", "task:retrying", "agent:status",
  "approval:needed", "log:append", "log:activity", "team:chat", "task:queued", "agent:activity",
  "worktree:created", "worktree:merged", "worktree:ready", "autoMerge:updated", "token:update",
  "agent:created", "agent:fired", "task:result-returned", "team:phase",
] as const;

/**
 * Orchestrator wired to the fake backend in a temp workspace. No real AI CLI is
 * ever started; worktrees and retries are off so runs are fast and deterministic.
 */
export function createHarness(opts: {
  rules: ScenarioRule[];
  defaultRule?: ScenarioRule;
  supportsAutoPermission?: boolean;
  permissionPolicy?: (backendId: string) => PermissionPolicy;
}): Harness {
  const root = mkdtempSync(join(TEST_HOME, "run-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { recursive: true });
  setSessionDir(join(root, "instance"));
  setStorageRoot(join(root, "memory"));

  const scenarioFile = join(root, "scenario.json");
  writeFileSync(scenarioFile, JSON.stringify({ rules: opts.rules, default: opts.defaultRule }));
  const recordFile = join(root, "runs.jsonl");

  const orc = createOrchestrator({
    workspace,
    backends: [createFakeBackend({ scenarioFile, recordFile, supportsAutoPermission: opts.supportsAutoPermission })],
    defaultBackend: "fake",
    worktree: false,
    retry: false,
    permissionPolicy: opts.permissionPolicy,
  });

  const events: OrchestratorEvent[] = [];
  const waiters: Array<{ pred: (e: OrchestratorEvent) => boolean; resolve: (e: OrchestratorEvent) => void }> = [];
  for (const name of ALL_EVENTS) {
    orc.on(name, ((e: OrchestratorEvent) => {
      events.push(e);
      for (const w of [...waiters]) {
        if (w.pred(e)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(e);
        }
      }
    }) as never);
  }

  return {
    orc,
    events,
    workspace,
    records() {
      if (!existsSync(recordFile)) return [];
      return readFileSync(recordFile, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
    waitFor(pred: (e: OrchestratorEvent) => boolean, timeoutMs = 8000): Promise<any> {
      const already = events.find(pred);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const kinds = events.map((e) => e.type).join(", ");
          reject(new Error(`timed out waiting for event; saw: ${kinds}`));
        }, timeoutMs);
        waiters.push({ pred, resolve: (e) => { clearTimeout(timer); resolve(e); } });
      });
    },
    destroy() {
      orc.destroy();
    },
  };
}
