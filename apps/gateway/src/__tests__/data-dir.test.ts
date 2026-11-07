import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, lstatSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { migrateLegacyDataDir, resolveDataDir, resolveLegacyDataDir } from "../data-dir.js";

describe("data dir migration", () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), "pc-home-")); });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); });

  it("resolves ~/.pixel-crew and ~/.pixel-crew-dev", () => {
    assert.equal(resolveDataDir({ home, env: {} }), join(home, ".pixel-crew"));
    assert.equal(resolveDataDir({ home, env: { NODE_ENV: "development" } }), join(home, ".pixel-crew-dev"));
    assert.equal(resolveLegacyDataDir({ home, env: {} }), join(home, ".open-office"));
  });

  it("honours PIXEL_CREW_HOME and never migrates then", () => {
    mkdirSync(join(home, ".open-office"));
    const r = migrateLegacyDataDir({ home, env: { PIXEL_CREW_HOME: join(home, "custom") } });
    assert.equal(r.status, "none");
    assert.equal(r.dataDir, join(home, "custom"));
    assert.ok(existsSync(join(home, ".open-office")));
  });

  it("moves the legacy dir and leaves a symlink behind", () => {
    const legacy = join(home, ".open-office");
    mkdirSync(join(legacy, "data"), { recursive: true });
    writeFileSync(join(legacy, "config.json"), '{"defaultBackend":"claude"}');
    const r = migrateLegacyDataDir({ home, env: {} });
    assert.equal(r.status, "migrated");
    assert.equal(r.dataDir, join(home, ".pixel-crew"));
    assert.equal(readFileSync(join(home, ".pixel-crew", "config.json"), "utf-8"), '{"defaultBackend":"claude"}');
    assert.ok(existsSync(join(home, ".pixel-crew", "MIGRATED_FROM.txt")));
    if (r.status === "migrated" && r.symlinked) {
      assert.ok(lstatSync(legacy).isSymbolicLink());
      // Old absolute paths still resolve through the symlink
      assert.ok(existsSync(join(legacy, "config.json")));
    }
  });

  it("does nothing when the new dir already exists", () => {
    mkdirSync(join(home, ".open-office"));
    mkdirSync(join(home, ".pixel-crew"));
    const r = migrateLegacyDataDir({ home, env: {} });
    assert.equal(r.status, "none");
    assert.ok(lstatSync(join(home, ".open-office")).isDirectory());
  });

  it("does nothing on a fresh install", () => {
    const r = migrateLegacyDataDir({ home, env: { NODE_ENV: "development" } });
    assert.equal(r.status, "none");
    assert.equal(r.dataDir, join(home, ".pixel-crew-dev"));
  });
});
