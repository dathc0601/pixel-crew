// Role packs (P6.3): every bundled agents/*.md must parse, pack names must be unique, and the
// packs reach Claude per run as an `--agents` JSON object (never via ~/.claude/agents/).
import "./helpers/env.js";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildClaudeAgentsConfig, getBundledAgentsDir, listRolePacks, parseRolePack, parseRolePackDefinition,
  resolveRolePackKey, rolePackKey, writeClaudeAgentsFile, ROLE_PACK_KEY_PREFIX,
} from "../agent-defs.js";
import { createHarness, type Harness } from "./helpers/harness.js";
import type { TaskDoneEvent } from "../types.js";

// Fields Claude Code accepts in an --agents definition (code.claude.com/docs/en/sub-agents,
// "CLI-defined subagents"). We emit a subset; anything else would be a bug.
const DOCUMENTED_FIELDS = new Set([
  "description", "prompt", "tools", "disallowedTools", "model", "permissionMode", "mcpServers", "hooks",
  "maxTurns", "autoCompactWindow", "skills", "initialPrompt", "memory", "effort", "background",
  "omitClaudeMd", "isolation",
]);

describe("role packs", () => {
  it("every bundled pack parses and names are unique", () => {
    const { packs, invalid } = listRolePacks();
    assert.deepEqual(invalid, []);
    assert.equal(packs.length, 18);
    const names = packs.map((p) => p.name);
    assert.equal(new Set(names).size, names.length, `duplicate pack names: ${names.join(", ")}`);
  });

  it("reads name and description from the front matter only", () => {
    assert.deepEqual(
      parseRolePack("x.md", "---\nname: Code Reviewer\ndescription: \"Reviews code.\"\n---\n\n# Body\nname: ignored\n"),
      { file: "x.md", name: "Code Reviewer", description: "Reviews code." },
    );
    assert.equal(parseRolePack("x.md", "# No front matter\n"), null);
    assert.equal(parseRolePack("x.md", "---\nname: Only a name\n---\n"), null);
  });

  it("a definition carries the body as prompt and optional tools/model", () => {
    assert.deepEqual(
      parseRolePackDefinition("x.md", "---\nname: X\ndescription: Does x.\ntools: Read, Grep ,Bash\nmodel: sonnet\n---\n\n# X\nBody\n"),
      { file: "x.md", name: "X", description: "Does x.", prompt: "# X\nBody", tools: ["Read", "Grep", "Bash"], model: "sonnet" },
    );
    assert.deepEqual(
      parseRolePackDefinition("y.md", "---\nname: Y\ndescription: Does y.\n---\nBody"),
      { file: "y.md", name: "Y", description: "Does y.", prompt: "Body" },
    );
  });
});

describe("--agents JSON", () => {
  it("matches the documented shape for all 18 bundled packs", () => {
    const { packs } = listRolePacks();
    const config = buildClaudeAgentsConfig(packs);
    const keys = Object.keys(config);
    assert.equal(keys.length, 18);
    for (const pack of packs) {
      const key = rolePackKey(pack);
      const def = config[key];
      assert.ok(def, `missing key ${key}`);
      // Keys are agent names: no leading "-", no ":" (reserved for plugin scopes)
      assert.match(key, /^pixel-crew-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.equal(typeof def.description, "string");
      assert.ok(def.description.length > 0);
      assert.equal(def.description, pack.description);
      assert.equal(typeof def.prompt, "string");
      assert.ok(def.prompt.length > 0, `${key} has an empty prompt`);
      assert.ok(!def.prompt.startsWith("---"), `${key} prompt still has front matter`);
      for (const field of Object.keys(def)) assert.ok(DOCUMENTED_FIELDS.has(field), `${key}.${field} is not a documented field`);
      if (def.tools) assert.ok(Array.isArray(def.tools));
    }
  });

  it("every role title resolves to the key of its pack", () => {
    for (const pack of listRolePacks().packs) {
      assert.equal(resolveRolePackKey(pack.name), rolePackKey(pack));
      assert.equal(resolveRolePackKey(pack.name.toUpperCase()), rolePackKey(pack));
    }
    assert.equal(resolveRolePackKey("Code Reviewer"), `${ROLE_PACK_KEY_PREFIX}code-reviewer`);
    assert.equal(resolveRolePackKey("Frontend Developer"), undefined);
  });

  it("writes the file atomically where it is told, and only there", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-agents-"));
    const file = join(dir, "data", "claude-agents.json");
    const { count, invalid } = writeClaudeAgentsFile(file);
    assert.equal(count, 18);
    assert.deepEqual(invalid, []);
    assert.deepEqual(readdirSync(join(dir, "data")), ["claude-agents.json"], "no temp file left behind");
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    assert.deepEqual(parsed, buildClaudeAgentsConfig(listRolePacks(getBundledAgentsDir()).packs));
    // Rewriting replaces the file in place
    writeClaudeAgentsFile(file);
    assert.deepEqual(readdirSync(join(dir, "data")), ["claude-agents.json"]);
    assert.ok(existsSync(file));
  });
});

describe("role pack key reaches the backend", () => {
  let h: Harness | null = null;
  afterEach(() => { h?.destroy(); h = null; });

  it("a pack role runs with its --agents key; a role without a pack gets no --agent", async () => {
    h = createHarness({ rules: [{ match: ".*", text: "SUMMARY: done\nVERDICT: PASS" }], supportsAgentType: true });
    h.orc.createAgent({ agentId: "r1", name: "Sophie", role: "Code Reviewer — Code review, bugs, security, quality", backend: "fake" });
    h.orc.createAgent({ agentId: "d1", name: "Alex", role: "Frontend Developer — UI", backend: "fake" });
    h.orc.runTask("r1", "t1", "review it");
    await h.waitFor((e): e is TaskDoneEvent => e.type === "task:done" && e.taskId === "t1");
    h.orc.runTask("d1", "t2", "build it");
    await h.waitFor((e): e is TaskDoneEvent => e.type === "task:done" && e.taskId === "t2");
    const [review, dev] = h.records();
    const i = review.argv.indexOf("--agent");
    assert.ok(i >= 0, "reviewer run has --agent");
    assert.equal(review.argv[i + 1], "pixel-crew-code-reviewer");
    assert.ok(!dev.argv.includes("--agent"), "no --agent for a role without a pack");
  });
});
