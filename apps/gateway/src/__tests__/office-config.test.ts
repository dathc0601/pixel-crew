import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DEFAULT_OFFICE_CONFIG, backendPermissionMode } from "@pixel-crew/shared";
import { OfficeConfigManager, parseOfficeSection } from "../office-config.js";

function tmpConfig(): string {
  return join(mkdtempSync(join(tmpdir(), "pc-cfg-")), "config.json");
}

describe("office config schema", () => {
  it("has the owner-decided defaults", () => {
    assert.deepEqual(DEFAULT_OFFICE_CONFIG, {
      permissionMode: "auto",
      backendPermissions: {},
      lead: { selfWork: "never", subagents: "when_all_devs_busy", waitMs: 120000 },
      handoff: { durationMs: 2500 },
    });
  });

  it("fills defaults for a partial section", () => {
    const r = parseOfficeSection({ office: { handoff: { durationMs: 0 } } });
    assert.ok(r.ok);
    assert.equal(r.ok && r.config.handoff.durationMs, 0);
    assert.equal(r.ok && r.config.lead.selfWork, "never");
  });

  it("rejects out-of-range and unknown values", () => {
    assert.equal(parseOfficeSection({ office: { handoff: { durationMs: 10001 } } }).ok, false);
    assert.equal(parseOfficeSection({ office: { handoff: { durationMs: -1 } } }).ok, false);
    assert.equal(parseOfficeSection({ office: { lead: { selfWork: "always" } } }).ok, false);
    assert.equal(parseOfficeSection({ office: { typo: 1 } }).ok, false);
  });

  it("never allows bypass as the global default, only per backend", () => {
    assert.equal(parseOfficeSection({ office: { permissionMode: "bypass" } }).ok, false);
    const r = parseOfficeSection({ office: { backendPermissions: { codex: "bypass" } } });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(backendPermissionMode(r.config, "codex"), "bypass");
      assert.equal(backendPermissionMode(r.config, "claude"), "auto");
    }
  });
});

describe("OfficeConfigManager", () => {
  let mgr: OfficeConfigManager | null = null;
  afterEach(() => { mgr?.close(); mgr = null; });

  it("returns defaults when the file is missing", () => {
    mgr = new OfficeConfigManager(tmpConfig());
    mgr.reload();
    assert.deepEqual(mgr.get(), DEFAULT_OFFICE_CONFIG);
  });

  it("keeps the last valid config when the file becomes invalid", () => {
    const file = tmpConfig();
    writeFileSync(file, JSON.stringify({ office: { handoff: { durationMs: 1000 } } }));
    mgr = new OfficeConfigManager(file);
    mgr.reload();
    assert.equal(mgr.get().handoff.durationMs, 1000);
    writeFileSync(file, "{ not json");
    assert.equal(mgr.reload(), false);
    assert.equal(mgr.get().handoff.durationMs, 1000);
    assert.ok(mgr.error);
    writeFileSync(file, JSON.stringify({ office: { handoff: { durationMs: 99999 } } }));
    mgr.reload();
    assert.equal(mgr.get().handoff.durationMs, 1000);
  });

  it("hot-reloads when the file changes", async () => {
    const file = tmpConfig();
    writeFileSync(file, JSON.stringify({ defaultBackend: "claude" }));
    mgr = new OfficeConfigManager(file, 20);
    mgr.reload();
    mgr.watch();
    const changed = new Promise<number>((resolve) => mgr!.once("change", (c) => resolve(c.lead.waitMs)));
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(file, JSON.stringify({ defaultBackend: "claude", office: { lead: { waitMs: 5000 } } }));
    const waitMs = await Promise.race([changed, new Promise<number>((_, rej) => setTimeout(() => rej(new Error("no reload")), 3000))]);
    assert.equal(waitMs, 5000);
    assert.equal(mgr.get().lead.waitMs, 5000);
  });
});
