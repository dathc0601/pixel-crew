// Pairing v2 (P5.4) unit tests: one-time links, device-bound sessions, roles, proxies.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { IncomingMessage } from "http";
import {
  MAX_LOCAL_SESSIONS,
  PAIR_TOKEN_TTL_MS,
  PairingTokenStore,
  SessionTokenStore,
  buildTrustedOrigins,
  checkQuickConnect,
  cleanDeviceName,
  clientKey,
  describeUserAgent,
  hashToken,
  isProxiedRequest,
} from "../security.js";
import { isCommandAllowed } from "../rbac.js";
import { pairBaseUrls, pairLinkUrl, pairWarning, qrModules } from "../pairing.js";

const fakeReq = (remote: string, headers: Record<string, string> = {}) =>
  ({ socket: { remoteAddress: remote }, headers }) as unknown as IncomingMessage;

describe("one-time pairing tokens", () => {
  it("are 128-bit, base64url, valid for 2 minutes", () => {
    const store = new PairingTokenStore();
    const { token, expiresAt } = store.create("owner");
    assert.match(token, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(Buffer.from(token, "base64url").length, 16);
    assert.ok(expiresAt - Date.now() <= PAIR_TOKEN_TTL_MS && expiresAt - Date.now() > PAIR_TOKEN_TTL_MS - 1000);
    assert.equal(PAIR_TOKEN_TTL_MS, 120_000);
  });

  it("expire after the TTL", () => {
    let t = 0;
    const store = new PairingTokenStore({ now: () => t });
    const a = store.create("owner").token;
    const b = store.create("spectator").token;
    t = PAIR_TOKEN_TTL_MS - 1;
    assert.equal(store.consume(a), "owner", "still valid just before expiry");
    t = PAIR_TOKEN_TTL_MS;
    assert.equal(store.consume(b), null, "expired at the TTL");
  });

  it("work once; a replay is rejected like an unknown token", () => {
    const store = new PairingTokenStore();
    const { token } = store.create("collaborator");
    assert.equal(store.consume(token), "collaborator");
    assert.equal(store.consume(token), null);
    assert.equal(store.consume("A".repeat(22)), null);
    assert.equal(store.consume("short"), null);
    assert.equal(store.consume(undefined), null);
  });

  it("an expired token is used up by the failed attempt too", () => {
    let t = 0;
    const store = new PairingTokenStore({ now: () => t });
    const { token } = store.create("owner");
    t = PAIR_TOKEN_TTL_MS + 1;
    assert.equal(store.consume(token), null);
    t = 0;
    assert.equal(store.consume(token), null, "gone even if the clock went back");
  });

  it("revoke-all clears outstanding links; the pending list is bounded", () => {
    const store = new PairingTokenStore();
    const first = store.create("owner").token;
    for (let i = 0; i < 30; i++) store.create("owner");
    assert.ok(store.size <= 20);
    assert.equal(store.consume(first), null, "oldest link was evicted");
    store.clear();
    assert.equal(store.size, 0);
  });
});

describe("device-bound session tokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-devices-"));

  it("give each paired device its own record, listed without secrets", () => {
    const store = new SessionTokenStore(join(dir, "a.json"));
    const tok = store.issue("spectator", { kind: "qr", name: "iPhone · Safari" });
    const [d] = store.list();
    assert.equal(d.name, "iPhone · Safari");
    assert.equal(d.role, "spectator");
    assert.equal(d.kind, "qr");
    assert.match(d.deviceId, /^[0-9a-f]{12}$/);
    assert.equal(JSON.stringify(d).includes(tok), false);
    assert.ok(d.expiresAt > Date.now());
  });

  it("store only token hashes on disk", () => {
    const file = join(dir, "b.json");
    const tok = new SessionTokenStore(file).issue("owner", { kind: "qr" });
    const raw = readFileSync(file, "utf-8");
    assert.equal(raw.includes(tok), false);
    assert.ok(raw.includes(hashToken(tok)));
    assert.equal(new SessionTokenStore(file).validate(tok), "owner", "still valid after a restart");
  });

  it("revoke one device without touching the others", () => {
    const store = new SessionTokenStore(join(dir, "c.json"));
    const phone = store.issue("owner", { kind: "qr", name: "phone" });
    const tablet = store.issue("spectator", { kind: "qr", name: "tablet" });
    const phoneId = store.lookup(phone)!.deviceId;
    assert.equal(store.revokeDevice(phoneId), true);
    assert.equal(store.validate(phone), null);
    assert.equal(store.validate(tablet), "spectator");
    assert.equal(store.revokeDevice(phoneId), false, "already gone");
  });

  it("device sessions expire", () => {
    let t = 1_000;
    const store = new SessionTokenStore(join(dir, "d.json"), { ttlMs: 500, now: () => t });
    const tok = store.issue("owner", { kind: "qr" });
    t += 501;
    assert.equal(store.lookup(tok), null);
    assert.equal(store.list().length, 0);
  });

  it(`keep at most ${MAX_LOCAL_SESSIONS} local quick-connect sessions`, () => {
    let t = 0;
    const store = new SessionTokenStore(join(dir, "e.json"), { now: () => ++t });
    const phone = store.issue("owner", { kind: "qr" });
    const local = Array.from({ length: MAX_LOCAL_SESSIONS + 3 }, () => store.issue("owner", { kind: "local" }));
    assert.equal(store.list().filter((d) => d.kind === "local").length, MAX_LOCAL_SESSIONS);
    assert.equal(store.validate(local[0]), null, "oldest local session dropped");
    assert.equal(store.validate(local[local.length - 1]), "owner");
    assert.equal(store.validate(phone), "owner", "paired devices are never evicted by local ones");
  });

  it("migrate v2 files (raw tokens) to hashed v3 records", () => {
    const file = join(dir, "f.json");
    const exp = Date.now() + 60_000;
    writeFileSync(file, JSON.stringify({ version: 2, tokens: { rawtoken123: { role: "collaborator", issuedAt: 1, expiresAt: exp } } }));
    const store = new SessionTokenStore(file);
    assert.equal(store.validate("rawtoken123"), "collaborator");
    const saved = JSON.parse(readFileSync(file, "utf-8"));
    assert.equal(saved.version, 3);
    assert.equal(JSON.stringify(saved).includes("rawtoken123"), false);
  });
});

describe("roles", () => {
  it("only owners can pair devices, list or revoke them, or change settings", () => {
    for (const cmd of ["CREATE_PAIR_LINK", "LIST_DEVICES", "REVOKE_DEVICE", "REVOKE_SESSIONS", "SET_OFFICE_CONFIG", "BOSS_ASSIGN", "APPROVAL_DECISION"]) {
      assert.equal(isCommandAllowed("owner", cmd), true, cmd);
      assert.equal(isCommandAllowed("collaborator", cmd), false, `collaborator ${cmd}`);
      assert.equal(isCommandAllowed("spectator", cmd), false, `spectator ${cmd}`);
    }
    assert.equal(isCommandAllowed("spectator", "PING"), true);
    assert.equal(isCommandAllowed("collaborator", "SUGGEST"), true);
    assert.equal(isCommandAllowed("spectator", "SUGGEST"), false);
  });
});

describe("proxied requests (Tailscale serve, reverse proxies)", () => {
  const ctx = { trustedOrigins: buildTrustedOrigins({ port: 9090, isDev: false }), ablyConfigured: false };
  it("never get the quick-connect owner token, even on loopback with a localhost Host", () => {
    for (const h of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "tailscale-user-login"]) {
      const req = fakeReq("127.0.0.1", { host: "localhost:9090", [h]: "100.64.0.2" });
      assert.equal(isProxiedRequest(req), true, h);
      assert.equal(checkQuickConnect(req, ctx).ok, false, h);
    }
    assert.equal(checkQuickConnect(fakeReq("127.0.0.1", { host: "localhost:9090" }), ctx).ok, true, "the local UI still works");
  });
  it("are rate-limited per forwarded client (the proxy-added entry)", () => {
    assert.equal(clientKey(fakeReq("127.0.0.1", { "x-forwarded-for": "1.1.1.1, 100.64.0.7" })), "xff:100.64.0.7");
    assert.equal(clientKey(fakeReq("192.168.1.9", { "x-forwarded-for": "100.64.0.7" })), "192.168.1.9", "only trusted from a local proxy");
  });
});

describe("pairing links and QR codes", () => {
  it("offer the public URL first, LAN addresses only with --lan, localhost last", () => {
    assert.deepEqual(pairBaseUrls({ port: 9090, listenHost: "127.0.0.1" }, ["192.168.1.5"]), ["http://localhost:9090"]);
    assert.deepEqual(
      pairBaseUrls({ port: 9090, listenHost: "0.0.0.0", publicUrl: "https://mac.tail1234.ts.net" }, ["192.168.1.5"]),
      ["https://mac.tail1234.ts.net", "http://192.168.1.5:9090", "http://localhost:9090"],
    );
  });
  it("put the token in the fragment and warn when phones cannot reach the link", () => {
    assert.equal(pairLinkUrl("https://x.ts.net/", "tok"), "https://x.ts.net/pair#tok");
    assert.match(pairWarning("http://localhost:9090") ?? "", /--lan/);
    assert.match(pairWarning("http://192.168.1.5:9090") ?? "", /installed/);
    assert.equal(pairWarning("https://x.ts.net"), undefined);
  });
  it("encode the link as a square module grid", () => {
    const { size, modules } = qrModules(`https://mac.tail1234.ts.net/pair#${"A".repeat(22)}`);
    assert.ok(size >= 21 && (size - 17) % 4 === 0, `valid QR size ${size}`);
    assert.equal(modules.length, size * size);
    assert.match(modules, /^[01]+$/);
    assert.equal(modules.slice(0, 7), "1111111", "finder pattern in the corner");
  });
  it("label devices from their User-Agent or a cleaned client name", () => {
    assert.equal(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "iPhone · Safari");
    assert.equal(describeUserAgent("Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"), "Android · Chrome");
    assert.equal(cleanDeviceName("  My <b>phone</b>\n "), "My bphone/b");
    assert.equal(cleanDeviceName("x".repeat(100))?.length, 60);
    assert.equal(cleanDeviceName(42), null);
  });
});
