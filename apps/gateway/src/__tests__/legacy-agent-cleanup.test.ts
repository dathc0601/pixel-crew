// Role packs no longer touch ~/.claude/: startup writes the --agents file into the Pixel Crew
// data dir, and removes only byte-identical copies older versions left in ~/.claude/agents/.
// Every test uses a temp HOME; the real one is never read or written.
import "./helpers/test-env.js";
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "fs";
import { join, relative, sep } from "path";
import { tmpdir } from "os";
import * as orchestrator from "@pixel-crew/orchestrator";
import { getBundledAgentsDir, listRolePacks, resolveRolePackKey, type BuildArgsOpts } from "@pixel-crew/orchestrator";

// Point HOME at a temp dir before anything that might resolve it loads
const fakeHome = mkdtempSync(join(tmpdir(), "pc-home-"));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
const { getBackend } = await import("../backends.js");
const { setupRolePacks, claudeAgentsFilePath } = await import("../role-packs.js");
const { cleanupLegacyAgentFiles, shouldRunLegacyCleanup, PREVIOUS_ROLE_PACK_SHA256 } = await import("../legacy-agent-cleanup.js");

const bundledDir = getBundledAgentsDir();
const bundledFiles = readdirSync(bundledDir).filter((f) => f.endsWith(".md")).sort();
const quiet = () => {};

function newHome(): string {
  return mkdtempSync(join(tmpdir(), "pc-home-"));
}

/** Every file under dir with its content hash, so a test can prove nothing was added or changed. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split(sep).join("/")] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

function claudeArgs(agentType?: string): string[] {
  const opts: BuildArgsOpts = { permissionMode: "auto", agentType };
  return getBackend("claude")!.buildArgs("do the thing", opts);
}

describe("startup writes nothing under ~/.claude", () => {
  it("(a) the old global sync is gone", () => {
    assert.equal("syncAgentDefs" in orchestrator, false);
    const index = readFileSync(new URL("../index.ts", import.meta.url), "utf-8");
    assert.ok(!index.includes("syncAgentDefs"));
    assert.ok(index.includes("setupRolePacks({ demo: DEMO_MODE, dataDir: CONFIG_DIR })"));
  });

  it("(a) with no ~/.claude at all, none is created", () => {
    const home = newHome();
    const dataDir = join(home, ".pixel-crew");
    setupRolePacks({ demo: false, dataDir, home, env: {}, log: quiet });
    assert.equal(existsSync(join(home, ".claude")), false);
    assert.equal(existsSync(join(fakeHome, ".claude")), false);
    assert.ok(existsSync(claudeAgentsFilePath(dataDir)));
  });

  it("(a) an existing ~/.claude is only ever shrunk by identical copies, never added to or changed", () => {
    const home = newHome();
    const agents = join(home, ".claude", "agents");
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), "{}\n");
    writeFileSync(join(agents, "my-agent.md"), "---\nname: mine\ndescription: x\n---\nmine\n");
    const before = snapshot(join(home, ".claude"));
    setupRolePacks({ demo: false, dataDir: join(home, ".pixel-crew"), home, env: {}, log: quiet });
    assert.deepEqual(snapshot(join(home, ".claude")), before);
  });
});

describe("Claude argv", () => {
  it("(b) has --agents <pixel-crew file> and an --agent key that is in that file", () => {
    const home = newHome();
    const dataDir = join(home, ".pixel-crew");
    const { agentsFile } = setupRolePacks({ demo: false, dataDir, home, env: {}, log: quiet });
    assert.equal(agentsFile, join(dataDir, "data", "claude-agents.json"));

    const key = resolveRolePackKey("Code Reviewer")!;
    const args = claudeArgs(key);
    const i = args.indexOf("--agents");
    assert.ok(i >= 0, "--agents present");
    assert.equal(args[i + 1], agentsFile);
    assert.ok(!args[i + 1].includes(`${sep}.claude${sep}`), "file is not under ~/.claude");
    assert.ok(args.includes("-p"), "--agents takes a file only with -p");
    const j = args.indexOf("--agent");
    assert.equal(args[j + 1], key);
    const json = JSON.parse(readFileSync(agentsFile!, "utf-8"));
    assert.ok(json[key], `${key} is a key in the file`);
    // Every pack's role title maps to a key in the file
    for (const pack of listRolePacks().packs) assert.ok(json[resolveRolePackKey(pack.name)!], pack.name);
  });

  it("(b) without a role pack (or without the file) there is no --agent or --agents", () => {
    setupRolePacks({ demo: false, dataDir: join(newHome(), ".pixel-crew"), home: newHome(), env: {}, log: quiet });
    const args = claudeArgs(undefined);
    assert.ok(!args.includes("--agents") && !args.includes("--agent"));
    setupRolePacks({ demo: true, dataDir: join(newHome(), ".pixel-crew"), log: quiet });
    const demoArgs = claudeArgs("pixel-crew-code-reviewer");
    assert.ok(!demoArgs.includes("--agents") && !demoArgs.includes("--agent"));
  });
});

describe("legacy ~/.claude/agents cleanup", () => {
  let home: string;
  let agents: string;
  let logs: string[];
  beforeEach(() => {
    home = newHome();
    agents = join(home, ".claude", "agents");
    mkdirSync(agents, { recursive: true });
    logs = [];
  });
  const run = () => cleanupLegacyAgentFiles({ bundledDir, home, log: (m) => logs.push(m) });

  it("(d) removes byte-identical copies of every bundled pack and logs each one", () => {
    for (const f of bundledFiles) writeFileSync(join(agents, f), readFileSync(join(bundledDir, f)));
    const result = run();
    assert.deepEqual(result.removed, bundledFiles);
    assert.deepEqual(result.kept, []);
    assert.deepEqual(readdirSync(agents), []);
    for (const f of bundledFiles) assert.ok(logs.some((l) => l.includes("Removed") && l.includes(f)), f);
  });

  it("(d) keeps a user's own code-reviewer.md with different content, and logs it", () => {
    const mine = "---\nname: code-reviewer\ndescription: My reviewer\n---\nMy own rules.\n";
    writeFileSync(join(agents, "code-reviewer.md"), mine);
    writeFileSync(join(agents, "sre.md"), readFileSync(join(bundledDir, "sre.md")));
    const result = run();
    assert.deepEqual(result.kept, ["code-reviewer.md"]);
    assert.deepEqual(result.removed, ["sre.md"]);
    assert.equal(readFileSync(join(agents, "code-reviewer.md"), "utf-8"), mine);
    assert.ok(logs.some((l) => l.includes("Kept") && l.includes("code-reviewer.md")));
  });

  it("(d) keeps a shipped pack the user edited, even by one byte", () => {
    const edited = Buffer.concat([readFileSync(join(bundledDir, "qa-engineer.md")), Buffer.from("\n")]);
    writeFileSync(join(agents, "qa-engineer.md"), edited);
    const result = run();
    assert.deepEqual(result.kept, ["qa-engineer.md"]);
    assert.ok(readFileSync(join(agents, "qa-engineer.md")).equals(edited));
  });

  it("(d) never touches files that are not role pack names", () => {
    writeFileSync(join(agents, "my-agent.md"), readFileSync(join(bundledDir, "sre.md")));
    writeFileSync(join(agents, "notes.txt"), "x");
    const result = run();
    assert.deepEqual(result, { removed: [], kept: [] });
    assert.deepEqual(readdirSync(agents).sort(), ["my-agent.md", "notes.txt"]);
  });

  it("(d) removes a known earlier shipped version by its hash", () => {
    const old = Buffer.from("an earlier shipped game designer pack\n");
    writeFileSync(join(agents, "game-designer.md"), old);
    const oldHash = createHash("sha256").update(old).digest("hex");
    const result = cleanupLegacyAgentFiles({ bundledDir, home, log: quiet, previous: { "game-designer.md": [oldHash] } });
    assert.deepEqual(result.removed, ["game-designer.md"]);
  });

  it("(d) lists only real earlier versions (all differ from today's files)", () => {
    for (const [file, hashes] of Object.entries(PREVIOUS_ROLE_PACK_SHA256)) {
      assert.ok(bundledFiles.includes(file), file);
      const current = createHash("sha256").update(readFileSync(join(bundledDir, file))).digest("hex");
      for (const h of hashes) {
        assert.match(h, /^[0-9a-f]{64}$/);
        assert.notEqual(h, current);
      }
    }
  });

  it("(d) keeps a symlink even when it points at identical content", { skip: process.platform === "win32" }, () => {
    const elsewhere = join(home, "elsewhere.md");
    writeFileSync(elsewhere, readFileSync(join(bundledDir, "sre.md")));
    symlinkSync(elsewhere, join(agents, "sre.md"));
    const result = run();
    assert.deepEqual(result.kept, ["sre.md"]);
    assert.ok(existsSync(join(agents, "sre.md")));
  });

  it("does nothing when ~/.claude/agents does not exist", () => {
    const empty = newHome();
    assert.deepEqual(cleanupLegacyAgentFiles({ bundledDir, home: empty, log: quiet }), { removed: [], kept: [] });
    assert.equal(existsSync(join(empty, ".claude")), false);
  });

  it("(e) is skipped in demo mode and with PIXEL_CREW_SKIP_LEGACY_CLEANUP=1", () => {
    assert.equal(shouldRunLegacyCleanup({ demo: true, env: {} }), false);
    assert.equal(shouldRunLegacyCleanup({ demo: false, env: { PIXEL_CREW_SKIP_LEGACY_CLEANUP: "1" } }), false);
    assert.equal(shouldRunLegacyCleanup({ demo: false, env: {} }), true);

    const copy = join(agents, "sre.md");
    writeFileSync(copy, readFileSync(join(bundledDir, "sre.md")));
    const demo = setupRolePacks({ demo: true, dataDir: join(home, ".pixel-crew"), home, env: {}, log: quiet });
    assert.equal(demo.cleanup, undefined);
    assert.equal(existsSync(join(home, ".pixel-crew")), false, "demo writes no agents file either");
    assert.ok(existsSync(copy));
    const skipped = setupRolePacks({ demo: false, dataDir: join(home, ".pixel-crew"), home, env: { PIXEL_CREW_SKIP_LEGACY_CLEANUP: "1" }, log: quiet });
    assert.equal(skipped.cleanup, undefined);
    assert.ok(existsSync(copy));
    const ran = setupRolePacks({ demo: false, dataDir: join(home, ".pixel-crew"), home, env: {}, log: quiet });
    assert.deepEqual(ran.cleanup?.removed, ["sre.md"]);
    assert.equal(existsSync(copy), false);
  });
});
