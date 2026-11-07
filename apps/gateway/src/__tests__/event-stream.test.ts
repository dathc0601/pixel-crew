// P4.5 event-stream efficiency: LOG_APPEND batching, per-pane log subscriptions,
// previews for closed panes, nothing for spectators, and catch-up for late subscribers.
import "./helpers/test-env.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import type { GatewayEvent } from "@pixel-crew/shared";
import { config } from "../config.js";
import { wsChannel, setPairCode, getListeningAddress } from "../ws-server.js";
import { publishEvent } from "../transport.js";
import { LogCoalescer, lastLine, logEventFor, previewOf } from "../log-stream.js";
import { httpRequest, openWs } from "./helpers/http.js";

const log = (agentId: string, chunk: string, taskId = "t1"): GatewayEvent =>
  ({ type: "LOG_APPEND", agentId, taskId, stream: "stdout", chunk });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("LogCoalescer", () => {
  it("joins chunks of one stream inside the window with newlines", async () => {
    const out: GatewayEvent[] = [];
    const c = new LogCoalescer((e) => out.push(e), 20);
    c.push(log("a", "one"));
    c.push(log("a", "two"));
    c.push(log("b", "other"));
    c.push(log("a", "three"));
    assert.equal(out.length, 0);
    await sleep(40);
    assert.deepEqual(out.map((e) => (e as { chunk: string }).chunk), ["one\ntwo\nthree", "other"]);
    c.dispose();
  });

  it("flushes pending logs before any other event, and never merges thinking lines", () => {
    const out: GatewayEvent[] = [];
    const c = new LogCoalescer((e) => out.push(e), 10_000);
    c.push(log("a", "line 1"));
    c.push(log("a", "line 2"));
    c.push(log("a", "💭 thinking"));
    c.push({ type: "TASK_DONE", agentId: "a", taskId: "t1", result: { summary: "ok", changedFiles: [], diffStat: "", testResult: "unknown" } } as unknown as GatewayEvent);
    assert.deepEqual(out.map((e) => e.type === "LOG_APPEND" ? e.chunk : e.type), ["line 1\nline 2", "💭 thinking", "TASK_DONE"]);
    c.dispose();
  });

  it("keeps the running task's output for late subscribers", () => {
    const c = new LogCoalescer(() => {}, 10_000);
    c.push({ type: "TASK_STARTED", agentId: "a", taskId: "t1", prompt: "p" });
    c.push(log("a", "first"));
    c.push(log("a", "second"));
    c.push(log("a", "x", "other-task"));
    assert.deepEqual(c.getTail("a"), { type: "LOG_APPEND", agentId: "a", taskId: "t1", stream: "stdout", chunk: "first\nsecond", replace: true });
    c.push({ type: "TASK_FAILED", agentId: "a", taskId: "t1", error: "e" });
    assert.equal(c.getTail("a"), null);
    c.dispose();
  });

  it("decides per connection: full, preview or nothing", () => {
    const e = log("a", "x\ny\n") as Extract<GatewayEvent, { type: "LOG_APPEND" }>;
    assert.equal(logEventFor(e, "owner", null), "full", "older clients get everything");
    assert.equal(logEventFor(e, "owner", { agentIds: new Set(["a"]), previews: true }), "full");
    assert.equal(logEventFor(e, "owner", { agentIds: new Set(), previews: true }), "preview");
    assert.equal(logEventFor(e, "owner", { agentIds: new Set(), previews: false }), "none");
    assert.equal(logEventFor(e, "spectator", null), "none", "spectators get status events only");
    assert.equal(lastLine("a\nb\n\n"), "b");
    assert.deepEqual(previewOf(e), { type: "LOG_APPEND", agentId: "a", taskId: "t1", stream: "stdout", chunk: "y", preview: true });
  });
});

describe("WebSocket log subscriptions", () => {
  let port = 0;
  before(async () => {
    config.wsPort = 0;
    assert.ok(await wsChannel.init(() => {}));
    port = getListeningAddress()!.port;
    setPairCode("ABCD2345");
  });
  after(() => wsChannel.destroy?.());

  async function client(token: string): Promise<{ ws: WebSocket; got: GatewayEvent[] }> {
    const ws = await openWs(`ws://127.0.0.1:${port}`);
    const got: GatewayEvent[] = [];
    ws.on("message", (d) => got.push(JSON.parse(d.toString())));
    ws.send(JSON.stringify({ type: "AUTH", sessionToken: token }));
    await sleep(50);
    return { ws, got };
  }
  const ownerToken = async () => (await httpRequest({ port, path: "/connect", headers: { host: `localhost:${port}` } })).json().sessionToken as string;
  async function spectatorToken(): Promise<string> {
    const share = await httpRequest({ port, path: "/share/create", method: "POST", headers: { host: `localhost:${port}`, "content-type": "application/json" }, body: JSON.stringify({ code: "ABCD2345", role: "spectator" }) });
    const v = await httpRequest({ port, path: "/share/validate", method: "POST", headers: { host: `localhost:${port}`, "content-type": "application/json" }, body: JSON.stringify({ token: share.json().token }) });
    return v.json().sessionToken;
  }

  it("sends full logs for open panes, previews or nothing otherwise, and catch-up on subscribe", async () => {
    const old = await client(await ownerToken());
    const pane = await client(await ownerToken());
    const phone = await client(await ownerToken());
    const spectator = await client(await spectatorToken());
    pane.ws.send(JSON.stringify({ type: "SUBSCRIBE_LOGS", agentIds: ["a"] }));
    phone.ws.send(JSON.stringify({ type: "SUBSCRIBE_LOGS", agentIds: [], previews: false }));
    await sleep(50);

    wsChannel.broadcast(log("a", "a1\na2"));
    wsChannel.broadcast(log("b", "b1\nb2"));
    wsChannel.broadcast({ type: "AGENT_STATUS", agentId: "b", status: "working" });
    await sleep(80);

    const chunks = (got: GatewayEvent[]) => got.filter((e) => e.type === "LOG_APPEND").map((e) => (e as { chunk: string; preview?: boolean }).preview ? `preview:${(e as { chunk: string }).chunk}` : (e as { chunk: string }).chunk);
    assert.deepEqual(chunks(old.got), ["a1\na2", "b1\nb2"]);
    assert.deepEqual(chunks(pane.got), ["a1\na2", "preview:b2"]);
    assert.deepEqual(chunks(phone.got), []);
    assert.deepEqual(chunks(spectator.got), []);
    for (const c of [old, pane, phone, spectator]) assert.ok(c.got.some((e) => e.type === "AGENT_STATUS"), "status events reach everyone");

    // A pane opened mid-task gets the output so far as one replace event
    publishEvent({ type: "TASK_STARTED", agentId: "c", taskId: "tc", prompt: "p" });
    publishEvent(log("c", "c1", "tc"));
    publishEvent(log("c", "c2", "tc"));
    publishEvent({ type: "AGENT_STATUS", agentId: "c", status: "working" }); // flushes the batch
    pane.ws.send(JSON.stringify({ type: "SUBSCRIBE_LOGS", agentIds: ["a", "c"] }));
    await sleep(80);
    const replay = pane.got.find((e) => e.type === "LOG_APPEND" && (e as { replace?: boolean }).replace);
    assert.deepEqual(replay, { type: "LOG_APPEND", agentId: "c", taskId: "tc", stream: "stdout", chunk: "c1\nc2", replace: true });

    for (const c of [old, pane, phone, spectator]) c.ws.close();
  });
});
