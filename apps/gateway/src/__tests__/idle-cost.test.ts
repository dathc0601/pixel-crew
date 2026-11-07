// P4.4 daemon idle cost: the external-agent scanner only polls when it is useful, and the
// gateway log stays under its size cap.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessScanner, shouldScanExternalAgents } from "../process-scanner.js";
import { createRotatingLog, capLine, MAX_LINE_BYTES } from "../file-logger.js";

describe("external agent scanner", () => {
  it("polls only when enabled, outside demo mode, and while someone watches", () => {
    const base = { enabled: true, demo: false, wsViewers: 1, ablyActive: false, platform: "linux" as const };
    assert.equal(shouldScanExternalAgents(base), true);
    assert.equal(shouldScanExternalAgents({ ...base, enabled: false }), false);
    assert.equal(shouldScanExternalAgents({ ...base, demo: true }), false);
    assert.equal(shouldScanExternalAgents({ ...base, wsViewers: 0 }), false);
    assert.equal(shouldScanExternalAgents({ ...base, wsViewers: 0, ablyActive: true }), true);
    assert.equal(shouldScanExternalAgents({ ...base, platform: "win32" }), false, "ps/lsof do not exist on Windows");
  });

  it("stops its timer when inactive and scans at once when resumed", () => {
    let scans = 0;
    class CountingScanner extends ProcessScanner {
      protected override async scan() { scans++; }
    }
    const s = new CountingScanner(() => [], { onAdded() {}, onRemoved() {}, onChanged() {} });
    assert.equal(s.active, false);
    s.setActive(true, 60_000);
    assert.equal(s.active, true);
    assert.equal(scans, 1);
    s.setActive(true, 60_000);
    assert.equal(scans, 1, "already running: no second timer");
    s.setActive(false);
    assert.equal(s.active, false);
    s.setActive(true, 60_000);
    assert.equal(scans, 2);
    s.stop();
  });
});

describe("rotating gateway log", () => {
  it("rotates by size, keeps a fixed number of backups and caps disk use", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-log-"));
    try {
      const log = createRotatingLog(dir, { maxBytes: 2048, backups: 2 });
      const line = "x".repeat(99) + "\n";
      for (let i = 0; i < 200; i++) log.write(line);
      log.close();
      const files = readdirSync(dir).sort();
      assert.deepEqual(files, ["gateway.log", "gateway.log.1", "gateway.log.2"]);
      for (const f of files) assert.ok(statSync(join(dir, f)).size <= 2048, `${f} over the cap`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rotates an old log that is already over the cap at startup", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-log-"));
    try {
      writeFileSync(join(dir, "gateway.log"), "y".repeat(5000));
      const log = createRotatingLog(dir, { maxBytes: 2048 });
      log.write("fresh\n");
      log.close();
      assert.equal(readFileSync(join(dir, "gateway.log"), "utf8"), "fresh\n");
      assert.equal(statSync(join(dir, "gateway.log.1")).size, 5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cuts very long lines", () => {
    const long = "z".repeat(MAX_LINE_BYTES * 3) + "\n";
    const cut = capLine(long);
    assert.ok(Buffer.byteLength(cut) <= MAX_LINE_BYTES);
    assert.ok(cut.endsWith("[truncated]\n"));
    assert.equal(capLine("short\n"), "short\n");
  });
});
