// Pairing v2 (P5.4) against the real gateway HTTP/WebSocket server (loopback bind).
import "./helpers/test-env.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import type { Command } from "@pixel-crew/shared";
import type { CommandMeta } from "../transport.js";
import { config } from "../config.js";
import { wsChannel, createPairLink, listDevices, revokeDevice, revokeAllSessions, getListeningAddress } from "../ws-server.js";
import { httpRequest, openWs, nextMessage, waitClose } from "./helpers/http.js";

const received: Array<{ cmd: Command; meta: CommandMeta }> = [];
let port = 0;

const tokenOf = (url: string) => new URL(url).hash.slice(1);
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// Each call looks like a different phone behind a local proxy (Tailscale serve style), so the
// per-client rate limit only kicks in where a test wants it to.
let phone = 0;
const nextPhone = () => ({ "x-forwarded-for": `100.64.1.${++phone}` });

function exchange(token: string, headers: Record<string, string> = nextPhone()) {
  return httpRequest({
    port,
    path: "/pair/exchange",
    method: "POST",
    headers: { host: `localhost:${port}`, "content-type": "application/json", "user-agent": IPHONE_UA, ...headers },
    body: JSON.stringify({ token }),
  });
}

async function authed(sessionToken: string): Promise<{ ws: WebSocket; meta: CommandMeta }> {
  const ws = await openWs(`ws://127.0.0.1:${port}`);
  ws.send(JSON.stringify({ type: "AUTH", sessionToken }));
  ws.send(JSON.stringify({ type: "PING" }));
  const deadline = Date.now() + 2000;
  while (!received.some((r) => r.cmd.type === "PING") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  const hit = received.find((r) => r.cmd.type === "PING");
  assert.ok(hit, "authenticated command reached the handler");
  received.length = 0;
  return { ws, meta: hit.meta };
}

describe("pairing v2: one-time QR links", () => {
  before(async () => {
    config.wsPort = 0;
    assert.ok(await wsChannel.init((cmd, meta) => received.push({ cmd, meta })));
    port = getListeningAddress()!.port;
  });
  after(() => wsChannel.destroy?.());

  it("a link is <base>/pair#<128-bit token> with a QR code, valid 2 minutes", () => {
    const link = createPairLink("owner");
    assert.match(link.url, new RegExp(`^http://localhost:${port}/pair#[A-Za-z0-9_-]{22}$`));
    assert.equal(link.qr.modules.length, link.qr.size ** 2);
    assert.ok(Math.abs(link.expiresAt - Date.now() - 120_000) < 2000);
    assert.match(link.warning ?? "", /--lan/, "loopback-only gateways say phones cannot reach the link");
  });

  it("exchanging it yields a device-bound session with the link's role and an expiry", async () => {
    const link = createPairLink("spectator");
    const r = await exchange(tokenOf(link.url));
    assert.equal(r.status, 200, r.body);
    const body = r.json();
    assert.equal(body.role, "spectator");
    assert.ok(body.sessionToken && body.deviceId);
    assert.ok(body.expiresAt > Date.now() + 6 * 24 * 3600_000, "7-day session");
    assert.equal(r.headers["cache-control"], "no-store");

    const { ws, meta } = await authed(body.sessionToken);
    assert.equal(meta.role, "spectator", "the server enforces the role it issued");
    const me = listDevices(meta.clientId).find((d) => d.deviceId === body.deviceId);
    assert.ok(me, "device is listed");
    assert.equal(me!.name, "iPhone · Safari");
    assert.equal(me!.kind, "qr");
    assert.equal(me!.connected, true);
    assert.equal(me!.current, true);
    ws.close();
  });

  it("a link works once: the replay is rejected", async () => {
    const token = tokenOf(createPairLink("owner").url);
    assert.equal((await exchange(token)).status, 200);
    const replay = await exchange(token);
    assert.equal(replay.status, 401);
    assert.equal(replay.body.includes("sessionToken"), false);
  });

  it("an unknown or malformed token is rejected", async () => {
    assert.equal((await exchange("A".repeat(22))).status, 401);
    const bad = await httpRequest({ port, path: "/pair/exchange", method: "POST", headers: { host: `localhost:${port}`, ...nextPhone() }, body: "not json" });
    assert.equal(bad.status, 400);
  });

  it("revoking one device disconnects it and kills its token, other devices stay", async () => {
    const a = (await exchange(tokenOf(createPairLink("owner").url))).json();
    const b = (await exchange(tokenOf(createPairLink("owner").url))).json();
    const sa = await authed(a.sessionToken);
    const sb = await authed(b.sessionToken);
    const closed = waitClose(sa.ws);
    assert.equal(revokeDevice(a.deviceId), true);
    assert.equal(await closed, 4001);
    const again = await openWs(`ws://127.0.0.1:${port}`);
    again.send(JSON.stringify({ type: "AUTH", sessionToken: a.sessionToken }));
    assert.equal((await nextMessage(again)).type, "AUTH_FAILED");
    assert.equal(sb.ws.readyState, WebSocket.OPEN, "the other device is still connected");
    assert.equal(listDevices().some((d) => d.deviceId === a.deviceId), false);
    sb.ws.close();
  });

  it("revoke-all also invalidates links that were not used yet", async () => {
    const token = tokenOf(createPairLink("owner").url);
    revokeAllSessions();
    assert.equal((await exchange(token)).status, 401);
  });

  it("rate-limits the exchange (5 tries a minute per client, then a lockout)", async () => {
    // Fresh client key: a forwarded address from a local proxy (as Tailscale serve sends)
    const headers = { "x-forwarded-for": "100.64.0.99" };
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await exchange("B".repeat(22), headers)).status;
    assert.equal(last, 429);
    // Even a valid link is refused while locked out
    assert.equal((await exchange(tokenOf(createPairLink("owner").url), headers)).status, 429);
  });

  it("/connect stays local-only: refused through a proxy, fine for the local UI (P0.1)", async () => {
    const proxied = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}`, "x-forwarded-for": "100.64.0.5" } });
    assert.equal(proxied.status, 403);
    const local = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}` } });
    assert.equal(local.status, 200);
  });
});
