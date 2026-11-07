// P0.1 acceptance tests against the real gateway HTTP/WebSocket server (loopback bind).
import "./helpers/test-env.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import type { Command } from "@pixel-crew/shared";
import type { CommandMeta } from "../transport.js";
import { config } from "../config.js";
import { wsChannel, setPairCode, revokeAllSessions, getListeningAddress } from "../ws-server.js";
import { httpRequest, openWs, nextMessage, waitClose } from "./helpers/http.js";

const received: Command[] = [];
const metas: CommandMeta[] = [];
let port = 0;

async function getToken(): Promise<string> {
  const r = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}` } });
  assert.equal(r.status, 200, r.body);
  return r.json().sessionToken;
}

async function authedSocket(token: string): Promise<WebSocket> {
  const ws = await openWs(`ws://127.0.0.1:${port}`);
  ws.send(JSON.stringify({ type: "AUTH", sessionToken: token }));
  // AUTH success is silent; prove it with a PING round-trip through the command handler
  ws.send(JSON.stringify({ type: "PING" }));
  const deadline = Date.now() + 2000;
  while (!received.some((c) => c.type === "PING") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  assert.ok(received.some((c) => c.type === "PING"), "authenticated command reached the handler");
  received.length = 0;
  return ws;
}

describe("gateway server security (P0.1)", () => {
  before(async () => {
    config.wsPort = 0;
    const ok = await wsChannel.init((cmd, meta) => { received.push(cmd); metas.push(meta); });
    assert.ok(ok);
    port = getListeningAddress()!.port;
    setPairCode("ABCD2345");
  });
  after(() => wsChannel.destroy?.());

  it("binds to 127.0.0.1 by default", () => {
    assert.equal(config.listenHost, "127.0.0.1");
    assert.equal(getListeningAddress()!.host, "127.0.0.1");
  });

  it("GET /connect works for the local UI and sends no wildcard CORS", async () => {
    const r = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}` } });
    assert.equal(r.status, 200);
    assert.ok(r.json().sessionToken);
    assert.equal(r.headers["access-control-allow-origin"], undefined);
  });

  it("a page from another origin cannot read /connect", async () => {
    const r = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}`, origin: "https://evil.example" } });
    assert.equal(r.status, 403);
    assert.equal(r.body.includes("sessionToken"), false);
    assert.equal(r.headers["access-control-allow-origin"], undefined);
    const pre = await httpRequest({ port, path: "/connect", method: "OPTIONS", headers: { host: `localhost:${port}`, origin: "https://evil.example", "access-control-request-method": "GET" } });
    assert.equal(pre.status, 403);
    assert.equal(pre.headers["access-control-allow-origin"], undefined);
  });

  it("CORS allowlist echoes trusted origins only", async () => {
    const own = `http://localhost:${port}`;
    const pre = await httpRequest({ port, path: "/pair/validate", method: "OPTIONS", headers: { host: `localhost:${port}`, origin: own, "access-control-request-method": "POST" } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers["access-control-allow-origin"], own);
    const tauri = await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}`, origin: "tauri://localhost" } });
    assert.equal(tauri.status, 200);
    assert.equal(tauri.headers["access-control-allow-origin"], "tauri://localhost");
  });

  it("refuses DNS-rebinding requests to /connect", async () => {
    const r = await httpRequest({ port, path: "/connect", headers: { host: `evil.example:${port}` } });
    assert.equal(r.status, 403);
  });

  it("rejects a WebSocket upgrade with a foreign Origin", async () => {
    await assert.rejects(openWs(`ws://127.0.0.1:${port}`, "https://evil.example"), (err: any) => err.status === 403);
  });

  it("accepts a WebSocket upgrade from the gateway's own origin and requires AUTH", async () => {
    const ws = await openWs(`ws://127.0.0.1:${port}`, `http://localhost:${port}`);
    ws.send(JSON.stringify({ type: "AUTH", sessionToken: "not-a-token" }));
    assert.equal((await nextMessage(ws)).type, "AUTH_FAILED");
    await waitClose(ws);
  });

  it("rate-limits pair code guessing", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await httpRequest({ port, path: "/pair/validate", method: "POST", headers: { host: `localhost:${port}`, "content-type": "application/json" }, body: JSON.stringify({ code: `WRONG00${i}` }) });
      statuses.push(r.status);
    }
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.equal(statuses[5], 429);
    // Locked out even with the right code
    const r = await httpRequest({ port, path: "/pair/validate", method: "POST", headers: { host: `localhost:${port}` }, body: JSON.stringify({ code: "ABCD2345" }) });
    assert.equal(r.status, 429);
    assert.ok(r.headers["retry-after"]);
  });

  it("rate-limits share token guessing", async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (await httpRequest({ port, path: "/share/validate", method: "POST", headers: { host: `localhost:${port}` }, body: JSON.stringify({ token: `guess-${i}` }) })).status;
    }
    assert.equal(last, 429);
  });

  it("revoke-all disconnects other sessions and invalidates their tokens", async () => {
    const keepToken = await getToken();
    const dropToken = await getToken();
    const keep = await authedSocket(keepToken);
    const drop = await authedSocket(dropToken);
    const closed = waitClose(drop);
    const n = revokeAllSessions();
    assert.ok(n >= 2);
    assert.equal(await closed, 4001);
    // Revoked token can no longer authenticate
    const again = await openWs(`ws://127.0.0.1:${port}`);
    again.send(JSON.stringify({ type: "AUTH", sessionToken: dropToken }));
    assert.equal((await nextMessage(again)).type, "AUTH_FAILED");
    keep.close();
  });

  it("revoke-all can keep the caller's own session", async () => {
    const other = await authedSocket(await getToken());
    metas.length = 0;
    const me = await authedSocket(await getToken());
    const myClientId = metas[metas.length - 1].clientId;
    const otherClosed = waitClose(other);
    revokeAllSessions({ exceptClientId: myClientId });
    await otherClosed;
    assert.equal(me.readyState, WebSocket.OPEN);
    me.send(JSON.stringify({ type: "PING" }));
    const deadline = Date.now() + 2000;
    while (!received.some((c) => c.type === "PING") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    assert.ok(received.some((c) => c.type === "PING"), "kept session still works");
    me.close();
  });
});
