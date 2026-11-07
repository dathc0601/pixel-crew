// GET_OFFICE_CONFIG / SET_OFFICE_CONFIG: owner auth, validation, atomic write, broadcast.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";
import type { GatewayEvent, OfficeConfigEvent, UserRole } from "@pixel-crew/shared";
import { OfficeConfigManager, mergeOfficePatch } from "../office-config.js";
import { broadcastOfficeConfigChanges, handleOfficeConfigCommand } from "../office-config-commands.js";

function setup(initial: unknown = { defaultBackend: "claude", telegramAllowedUsers: ["42"], office: { lead: { waitMs: 5000 } } }) {
  const file = join(mkdtempSync(join(tmpdir(), "pc-office-")), "config.json");
  writeFileSync(file, JSON.stringify(initial, null, 2));
  const manager = new OfficeConfigManager(file, 20);
  manager.reload();
  const broadcasts: GatewayEvent[] = [];
  const replies: GatewayEvent[] = [];
  const stop = broadcastOfficeConfigChanges(manager, (e) => broadcasts.push(e));
  const deps = { manager, broadcast: (e: GatewayEvent) => broadcasts.push(e), reply: (e: GatewayEvent) => replies.push(e) };
  const set = (office: Record<string, unknown>, role: UserRole = "owner") =>
    handleOfficeConfigCommand({ type: "SET_OFFICE_CONFIG", office }, { role }, deps);
  const get = (role: UserRole = "owner") => handleOfficeConfigCommand({ type: "GET_OFFICE_CONFIG" }, { role }, deps);
  const disk = () => JSON.parse(readFileSync(file, "utf-8"));
  return { file, manager, broadcasts, replies, set, get, disk, stop };
}

describe("office config over the wire", () => {
  let cleanup: Array<() => void> = [];
  afterEach(() => { for (const c of cleanup) c(); cleanup = []; });
  function make(initial?: unknown) {
    const s = setup(initial);
    cleanup.push(() => { s.stop(); s.manager.close(); });
    return s;
  }

  it("rejects non-owner sessions for both commands and writes nothing", () => {
    const s = make();
    const before = readFileSync(s.file, "utf-8");
    for (const role of ["collaborator", "spectator"] as const) {
      s.get(role);
      s.set({ handoff: { durationMs: 0 } }, role);
    }
    assert.equal(readFileSync(s.file, "utf-8"), before);
    assert.equal(s.broadcasts.length, 0);
    assert.equal(s.replies.length, 4);
    for (const r of s.replies as OfficeConfigEvent[]) assert.match(r.error ?? "", /Only the owner/);
  });

  it("GET replies to the caller with the effective config", () => {
    const s = make();
    s.get();
    const reply = s.replies[0] as OfficeConfigEvent;
    assert.equal(reply.type, "OFFICE_CONFIG");
    assert.equal(reply.error, undefined);
    assert.equal(reply.config.lead.waitMs, 5000);
    assert.equal(reply.config.handoff.durationMs, 2500, "defaults are filled in");
    assert.equal(s.broadcasts.length, 0);
  });

  it("SET validates with the zod schema and leaves the file alone on error", () => {
    const s = make();
    const before = readFileSync(s.file, "utf-8");
    s.set({ handoff: { durationMs: 99_999 } });
    s.set({ lead: { selfWork: "always" } });
    s.set({ permissionMode: "bypass" });
    s.set({ typo: true });
    assert.equal(readFileSync(s.file, "utf-8"), before);
    assert.equal(s.broadcasts.length, 0);
    assert.equal(s.replies.length, 4);
    const errors = (s.replies as OfficeConfigEvent[]).map((r) => r.error ?? "");
    assert.match(errors[0], /office\.handoff\.durationMs/);
    assert.match(errors[1], /office\.lead\.selfWork/);
    assert.equal(s.manager.get().handoff.durationMs, 2500);
  });

  it("SET deep-merges, writes atomically, keeps other keys and broadcasts once", () => {
    const s = make();
    s.set({ handoff: { durationMs: 0 }, lead: { selfWork: "urgent_only" } });
    const disk = s.disk();
    assert.equal(disk.defaultBackend, "claude", "unrelated keys survive");
    assert.deepEqual(disk.telegramAllowedUsers, ["42"]);
    assert.deepEqual(disk.office, { lead: { waitMs: 5000, selfWork: "urgent_only" }, handoff: { durationMs: 0 } });
    assert.deepEqual(readdirSync(dirname(s.file)), ["config.json"], "no temp file left behind");
    assert.equal(s.manager.get().handoff.durationMs, 0, "applied immediately");
    assert.equal(s.broadcasts.length, 1);
    assert.equal((s.broadcasts[0] as OfficeConfigEvent).config.lead.selfWork, "urgent_only");
    assert.equal(s.replies.length, 0, "the caller hears the broadcast like everyone else");

    // Setting the same values again: no broadcast, but the caller still gets an answer
    s.set({ handoff: { durationMs: 0 } });
    assert.equal(s.broadcasts.length, 1);
    assert.equal(s.replies.length, 1);
  });

  it("null removes a key so it falls back to the default", () => {
    const s = make();
    s.set({ lead: { waitMs: null } });
    assert.deepEqual(s.disk().office, { lead: {} });
    assert.equal(s.manager.get().lead.waitMs, 120_000);
  });

  it("creates config.json when there is none and refuses to clobber invalid JSON", () => {
    const s = make({});
    writeFileSync(s.file, "{ broken");
    s.set({ handoff: { durationMs: 100 } });
    assert.equal(readFileSync(s.file, "utf-8"), "{ broken");
    assert.match((s.replies[0] as OfficeConfigEvent).error ?? "", /not valid JSON/);
  });

  it("a manual edit of config.json is broadcast through the watcher", async () => {
    const s = make();
    s.manager.watch();
    await new Promise((r) => setTimeout(r, 50));
    const got = new Promise<OfficeConfigEvent>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no broadcast")), 3000);
      const timer = setInterval(() => {
        const e = s.broadcasts.find((b) => (b as OfficeConfigEvent).config.handoff.durationMs === 700) as OfficeConfigEvent | undefined;
        if (e) { clearTimeout(t); clearInterval(timer); resolve(e); }
      }, 10);
    });
    writeFileSync(s.file, JSON.stringify({ defaultBackend: "claude", office: { handoff: { durationMs: 700 } } }));
    const e = await got;
    assert.equal(e.type, "OFFICE_CONFIG");
  });

  it("mergeOfficePatch replaces arrays/scalars and merges objects", () => {
    assert.deepEqual(
      mergeOfficePatch({ backendPermissions: { codex: "ask" }, lead: { waitMs: 1 } }, { backendPermissions: { gemini: "bypass" }, lead: { waitMs: 2 } }),
      { backendPermissions: { codex: "ask", gemini: "bypass" }, lead: { waitMs: 2 } },
    );
  });
});
