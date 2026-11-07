import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { IncomingMessage } from "http";
import {
  RateLimiter,
  SessionTokenStore,
  buildTrustedOrigins,
  checkQuickConnect,
  checkWebSocketOrigin,
  clientKey,
  generatePairCode,
  isLoopbackAddress,
  isLoopbackHostHeader,
  PAIR_CODE_LENGTH,
} from "../security.js";

function fakeReq(opts: { remote: string; headers?: Record<string, string> }): IncomingMessage {
  return { socket: { remoteAddress: opts.remote }, headers: opts.headers ?? {} } as unknown as IncomingMessage;
}

const trusted = buildTrustedOrigins({ port: 9090, isDev: false });
const ctx = { trustedOrigins: trusted, ablyConfigured: false };

describe("loopback detection", () => {
  it("recognises loopback socket addresses", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) assert.ok(isLoopbackAddress(a), a);
    for (const a of ["192.168.1.20", "10.0.0.5", "::ffff:192.168.1.20", "0.0.0.0", "", undefined]) assert.ok(!isLoopbackAddress(a), String(a));
  });
  it("recognises loopback Host headers", () => {
    for (const h of ["localhost:9090", "127.0.0.1:9090", "[::1]:9090", "localhost"]) assert.ok(isLoopbackHostHeader(h), h);
    for (const h of ["evil.example:9090", "192.168.1.20:9090", "localhost.evil.example", undefined]) assert.ok(!isLoopbackHostHeader(h), String(h));
  });
});

describe("GET /connect policy", () => {
  it("allows the local UI (no Origin, or same-origin)", () => {
    assert.ok(checkQuickConnect(fakeReq({ remote: "127.0.0.1", headers: { host: "localhost:9090" } }), ctx).ok);
    assert.ok(checkQuickConnect(fakeReq({ remote: "::1", headers: { host: "localhost:9090", origin: "http://localhost:9090" } }), ctx).ok);
    assert.ok(checkQuickConnect(fakeReq({ remote: "127.0.0.1", headers: { host: "127.0.0.1:9090", origin: "tauri://localhost" } }), ctx).ok);
  });
  it("refuses non-loopback clients (LAN)", () => {
    const v = checkQuickConnect(fakeReq({ remote: "192.168.1.20", headers: { host: "192.168.1.5:9090" } }), ctx);
    assert.equal(v.ok, false);
    assert.equal(!v.ok && v.status, 403);
  });
  it("refuses a foreign Origin even from loopback", () => {
    const v = checkQuickConnect(fakeReq({ remote: "127.0.0.1", headers: { host: "localhost:9090", origin: "https://evil.example" } }), ctx);
    assert.equal(v.ok, false);
  });
  it("refuses DNS-rebinding Host headers", () => {
    const v = checkQuickConnect(fakeReq({ remote: "127.0.0.1", headers: { host: "evil.example:9090" } }), ctx);
    assert.equal(v.ok, false);
  });
  it("refuses tunnel requests and Ably mode", () => {
    assert.equal(checkQuickConnect(fakeReq({ remote: "127.0.0.1", headers: { host: "localhost:9090", "cf-ray": "x" } }), ctx).ok, false);
    assert.equal(checkQuickConnect(fakeReq({ remote: "127.0.0.1", headers: { host: "localhost:9090" } }), { ...ctx, ablyConfigured: true }).ok, false);
  });
  it("only trusts the dev server origin in dev mode", () => {
    const req = fakeReq({ remote: "127.0.0.1", headers: { host: "localhost:9099", origin: "http://localhost:3000" } });
    assert.equal(checkQuickConnect(req, { trustedOrigins: buildTrustedOrigins({ port: 9099, isDev: false }), ablyConfigured: false }).ok, false);
    assert.equal(checkQuickConnect(req, { trustedOrigins: buildTrustedOrigins({ port: 9099, isDev: true }), ablyConfigured: false }).ok, true);
  });
});

describe("WebSocket origin policy", () => {
  it("allows no Origin, trusted origins and same-host pages", () => {
    assert.ok(checkWebSocketOrigin(undefined, "localhost:9090", trusted).ok);
    assert.ok(checkWebSocketOrigin("http://localhost:9090", "localhost:9090", trusted).ok);
    assert.ok(checkWebSocketOrigin("http://192.168.1.5:9090", "192.168.1.5:9090", trusted).ok);
  });
  it("rejects foreign origins", () => {
    assert.equal(checkWebSocketOrigin("https://evil.example", "localhost:9090", trusted).ok, false);
    assert.equal(checkWebSocketOrigin("null", "localhost:9090", trusted).ok, false);
  });
});

describe("RateLimiter", () => {
  it("locks a client out after max attempts and releases it later", () => {
    let t = 0;
    const rl = new RateLimiter({ max: 5, windowMs: 60_000, lockoutMs: 300_000, now: () => t });
    for (let i = 0; i < 5; i++) assert.ok(rl.hit("a").allowed);
    assert.equal(rl.hit("a").allowed, false);
    assert.ok(rl.hit("b").allowed, "other clients are unaffected");
    t += 120_000;
    assert.equal(rl.hit("a").allowed, false, "still locked out");
    t += 300_000;
    assert.ok(rl.hit("a").allowed);
  });
  it("uses CF-Connecting-IP only behind a loopback tunnel", () => {
    assert.equal(clientKey(fakeReq({ remote: "127.0.0.1", headers: { "cf-connecting-ip": "1.2.3.4" } })), "cf:1.2.3.4");
    assert.equal(clientKey(fakeReq({ remote: "192.168.1.20", headers: { "cf-connecting-ip": "1.2.3.4" } })), "192.168.1.20");
  });
});

describe("pair codes", () => {
  it("are 8 unambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const c = generatePairCode();
      assert.equal(c.length, PAIR_CODE_LENGTH);
      assert.match(c, /^[A-HJ-KM-NP-Z2-9]+$/);
    }
  });
});

describe("SessionTokenStore", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-tokens-"));
  it("expires tokens after the TTL", () => {
    let t = 1_000;
    const store = new SessionTokenStore(join(dir, "a.json"), { ttlMs: 1_000, now: () => t });
    const tok = store.issue("owner");
    assert.equal(store.validate(tok), "owner");
    t += 999;
    assert.equal(store.validate(tok), "owner");
    t += 2;
    assert.equal(store.validate(tok), null);
  });
  it("persists unexpired tokens across restarts", () => {
    const file = join(dir, "b.json");
    const tok = new SessionTokenStore(file).issue("spectator");
    assert.equal(new SessionTokenStore(file).validate(tok), "spectator");
  });
  it("drops legacy tokens that had no expiry", () => {
    const file = join(dir, "c.json");
    writeFileSync(file, JSON.stringify({ oldtoken: "owner" }));
    const store = new SessionTokenStore(file);
    assert.equal(store.validate("oldtoken"), null);
    assert.equal(JSON.parse(readFileSync(file, "utf-8")).version, 2);
  });
  it("revokes all tokens except the kept ones", () => {
    const store = new SessionTokenStore(join(dir, "d.json"));
    const a = store.issue("owner");
    const b = store.issue("owner");
    const c = store.issue("collaborator");
    assert.equal(store.revokeAll([a]), 2);
    assert.equal(store.validate(a), "owner");
    assert.equal(store.validate(b), null);
    assert.equal(store.validate(c), null);
  });
});
