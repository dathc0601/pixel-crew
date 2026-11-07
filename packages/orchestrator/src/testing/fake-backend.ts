import { fileURLToPath } from "url";
import type { AIBackend } from "../ai-backend.js";

/** Absolute path of the fake agent script (resolvable when running from source). */
export const FAKE_AGENT_SCRIPT = fileURLToPath(new URL("../../fake-agent/fake-agent.mjs", import.meta.url));

export interface FakeBackendOptions {
  /** Scenario JSON (see fake-agent.mjs for the format) */
  scenarioFile: string;
  /** Optional JSONL file recording each run's argv and cwd */
  recordFile?: string;
  /** Backend id (default "fake") */
  id?: string;
  /** Pretend the CLI has an auto permission mode (default true) */
  supportsAutoPermission?: boolean;
  /** Override the script location */
  scriptPath?: string;
}

/**
 * A backend that runs fake-agent.mjs with the current Node binary. It mirrors the
 * Claude adapter's flags so tests can assert what a real run would receive,
 * without spending tokens.
 */
export function createFakeBackend(opts: FakeBackendOptions): AIBackend {
  const script = opts.scriptPath ?? FAKE_AGENT_SCRIPT;
  return {
    id: opts.id ?? "fake",
    name: "Fake Agent",
    command: process.execPath,
    stability: "experimental",
    guardType: "none",
    supportsResume: true,
    supportsAgentType: false,
    supportsNativeWorktree: false,
    supportsStructuredOutput: true,
    supportsAutoPermission: opts.supportsAutoPermission ?? true,
    buildArgs(prompt, o) {
      const args = [script, "--scenario", opts.scenarioFile];
      if (opts.recordFile) args.push("--record", opts.recordFile);
      args.push("--output-format", "stream-json");
      if (o.permissionMode === "bypass") args.push("--dangerously-skip-permissions");
      else if (o.permissionMode === "auto") args.push("--permission-mode", "auto");
      if (o.resumeSessionId && !o.skipResume) args.push("--resume", o.resumeSessionId);
      if (o.tools) args.push("--tools", o.tools.join(","));
      else if (o.noTools) args.push("--tools", "");
      if (o.disallowedTools?.length) args.push("--disallowedTools", o.disallowedTools.join(","));
      if (o.model) args.push("--model", o.model);
      args.push("-p", prompt);
      return args;
    },
  };
}
