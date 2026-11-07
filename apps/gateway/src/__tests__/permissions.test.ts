import "./helpers/test-env.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveSpawnPermission } from "@pixel-crew/orchestrator";
import type { BuildArgsOpts } from "@pixel-crew/orchestrator";
import { checkRootAllowed } from "../root-guard.js";
import { isTelegramUserAllowed } from "../telegram-channel.js";

// Point HOME somewhere empty before backends.ts loads: importing it must not write ~/.claude
const fakeHome = mkdtempSync(join(tmpdir(), "pc-home-"));
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
const { getBackend, hasAutoPermissionMode } = await import("../backends.js");

const isRoot = process.getuid?.() === 0;

function argsFor(id: string, policy: "auto" | "ask" | "bypass"): string[] {
  const backend = getBackend(id)!;
  const perm = resolveSpawnPermission(backend, policy);
  const opts: BuildArgsOpts = { permissionMode: perm.mode, fullAccess: perm.mode === "bypass" };
  return backend.buildArgs("do the thing", opts);
}

describe("agent permission defaults (P0.2)", () => {
  it("importing backends does not touch ~/.claude", () => {
    assert.equal(existsSync(join(fakeHome, ".claude")), false);
  });

  it("Claude runs with --permission-mode auto by default, never bypass", () => {
    const args = argsFor("claude", "auto");
    const i = args.indexOf("--permission-mode");
    assert.ok(i >= 0);
    assert.equal(args[i + 1], "auto");
    assert.ok(!args.includes("--dangerously-skip-permissions"));
    assert.equal(resolveSpawnPermission(getBackend("claude")!, "auto").requiresApproval, false);
  });

  it("Claude bypass only with the explicit per-backend opt-in", () => {
    const args = argsFor("claude", "bypass");
    if (isRoot) {
      assert.ok(!args.includes("--dangerously-skip-permissions"));
    } else {
      assert.ok(args.includes("--dangerously-skip-permissions"));
      assert.ok(!args.includes("--permission-mode"));
    }
  });

  it("\"ask\" requires approval even for Claude, then runs in auto mode", () => {
    const perm = resolveSpawnPermission(getBackend("claude")!, "ask");
    assert.equal(perm.requiresApproval, true);
    assert.equal(perm.mode, "auto");
  });

  it("backends without an auto mode require CEO approval and get no bypass flags", () => {
    for (const id of ["codex", "gemini", "copilot", "cursor", "aider", "opencode", "pi", "sapling"]) {
      const perm = resolveSpawnPermission(getBackend(id)!, "auto");
      assert.equal(perm.requiresApproval, true, id);
      assert.equal(perm.mode, "default", id);
      const args = argsFor(id, "auto");
      for (const flag of ["--dangerously-bypass-approvals-and-sandbox", "--yolo", "--yes", "--allow-all-tools", "--dangerously-skip-permissions"]) {
        assert.ok(!args.includes(flag), `${id} must not pass ${flag}`);
      }
    }
  });

  it("bypass flags appear for a non-auto backend only when opted in", () => {
    assert.equal(resolveSpawnPermission(getBackend("gemini")!, "bypass").requiresApproval, false);
    assert.ok(argsFor("gemini", "bypass").includes("--yolo"));
    assert.ok(argsFor("aider", "bypass").includes("--yes"));
    if (!isRoot) assert.ok(argsFor("codex", "bypass").includes("--dangerously-bypass-approvals-and-sandbox"));
  });

  it("detects auto mode in `claude --help` output", () => {
    const help = `  --permission-mode <mode>              Permission mode to use for the session
                                        (choices: "acceptEdits", "auto",
                                        "bypassPermissions", "manual",
                                        "dontAsk", "plan")`;
    assert.equal(hasAutoPermissionMode(help), true);
    assert.equal(hasAutoPermissionMode(`--permission-mode <mode> (choices: "acceptEdits", "default", "plan")`), false);
    assert.equal(hasAutoPermissionMode("no such flag"), false);
  });
});

describe("root guard", () => {
  it("refuses root without --allow-root", () => {
    assert.equal(checkRootAllowed(0, ["node", "pixel-crew"]).ok, false);
    assert.equal(checkRootAllowed(0, ["node", "pixel-crew", "--allow-root"]).ok, true);
    assert.equal(checkRootAllowed(501, ["node", "pixel-crew"]).ok, true);
    assert.equal(checkRootAllowed(undefined, ["node", "pixel-crew"]).ok, true);
  });
});

describe("Telegram allowlist", () => {
  it("denies everyone when the allowlist is empty", () => {
    assert.equal(isTelegramUserAllowed([], 12345), false);
    assert.equal(isTelegramUserAllowed(["12345"], 12345), true);
    assert.equal(isTelegramUserAllowed(["12345"], 999), false);
  });
});
