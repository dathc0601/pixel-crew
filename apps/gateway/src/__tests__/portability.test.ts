// Path handling that must hold on Windows as well as Unix (P5.1).
import "./helpers/test-env.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { isPathInside } from "../security.js";
import { claudeProjectDir, claudeProjectKey } from "../external-output-reader.js";

describe("isPathInside (static and preview path guards)", () => {
  const root = path.resolve(tmpdir(), "pc-root");
  it("accepts the root and its children", () => {
    assert.equal(isPathInside(root, root), true);
    assert.equal(isPathInside(root, path.join(root, "a", "b.html")), true);
    assert.equal(isPathInside(root, path.join(root, "..hidden")), true, "a name that starts with two dots is still inside");
  });
  it("rejects parents, siblings sharing a prefix and other drives", () => {
    assert.equal(isPathInside(root, path.dirname(root)), false);
    assert.equal(isPathInside(root, path.join(root, "..", "secret.txt")), false);
    assert.equal(isPathInside(root, `${root}-evil${path.sep}x`), false);
    if (process.platform === "win32") {
      assert.equal(isPathInside("C:\\srv\\web", "D:\\srv\\web\\x"), false);
      assert.equal(isPathInside("C:\\srv\\web", "c:\\SRV\\web\\x"), true, "Windows paths compare case-insensitively");
    }
  });
});

describe("Claude Code project key (~/.claude/projects/<key>)", () => {
  it("replaces every non-alphanumeric character with a dash", () => {
    assert.equal(claudeProjectKey("/Users/foo/project"), "-Users-foo-project");
    assert.equal(claudeProjectKey("/Users/foo/.claude/worktrees/x_y"), "-Users-foo--claude-worktrees-x-y");
    assert.equal(claudeProjectKey("/Users/foo/Application Support/a.b"), "-Users-foo-Application-Support-a-b");
    assert.equal(claudeProjectKey("C:\\Users\\foo\\proj"), "C--Users-foo-proj");
  });
  it("cuts long keys to 200 characters plus a base-36 hash", () => {
    const long = `/${"a".repeat(250)}`;
    const key = claudeProjectKey(long);
    assert.match(key, /^-a{199}-[0-9a-z]+$/);
    assert.notEqual(claudeProjectKey(`/${"a".repeat(249)}b`), key, "different paths get different hashes");
  });
  it("on Windows, matches an existing project dir whatever the drive-letter case", () => {
    const projects = mkdtempSync(path.join(tmpdir(), "pc-projects-"));
    mkdirSync(path.join(projects, "c--Users-foo-proj"));
    assert.equal(claudeProjectDir("C:\\Users\\foo\\proj", projects, "win32"), path.join(projects, "c--Users-foo-proj"));
    assert.equal(claudeProjectDir("C:\\Users\\foo\\proj", projects, "linux"), path.join(projects, "C--Users-foo-proj"));
  });
});
