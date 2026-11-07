// End-to-end (P5.1 acceptance): a real gateway process in demo mode, driven over HTTP and
// WebSocket like the UI drives it. The Boss assigns a task, the Lead splits it, devs pick
// the parts from the pool, the reviewer passes it, and the Boss's item ends "done".
// Every agent is fake-agent.mjs (scripted, no tokens); runs on Linux, macOS and Windows.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import WebSocket from "ws";
import { killTree } from "@pixel-crew/orchestrator";
import { httpRequest } from "./helpers/http.js";
import { startGateway, type Gateway } from "./helpers/gateway.js";

describe("gateway end to end (demo mode, fake agents)", () => {
  const home = mkdtempSync(path.join(tmpdir(), "pixel-crew-e2e-"));
  const workspace = path.join(home, "workspace");
  let gw: Gateway;
  let ws: WebSocket;
  const events: any[] = [];

  before(async () => {
    mkdirSync(workspace, { recursive: true });
    // Instant hand-offs keep the run short; everything else is the shipped demo script
    writeFileSync(path.join(home, "config.json"), JSON.stringify({ office: { handoff: { durationMs: 0 } } }));
    gw = await startGateway(home, workspace, { PIXEL_CREW_EXTERNAL_AGENTS: "0" });
  });

  after(async () => {
    try { ws?.close(); } catch { /* closed */ }
    if (gw?.child.exitCode === null) {
      const exited = new Promise((r) => gw.child.once("exit", r));
      killTree(gw.child.pid, "SIGKILL", { sync: true });
      await exited;
    }
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  it("pairs locally, then Boss → Lead → devs → reviewer finishes the Boss's task", { timeout: 90_000 }, async () => {
    const connect = await httpRequest({ port: gw.port, path: "/connect", headers: { host: `localhost:${gw.port}` } });
    assert.equal(connect.status, 200, connect.body);
    const { sessionToken } = connect.json();

    ws = new WebSocket(`ws://127.0.0.1:${gw.port}`);
    await new Promise((r, j) => { ws.once("open", r); ws.once("error", j); });
    ws.on("message", (d) => events.push(JSON.parse(d.toString())));
    ws.send(JSON.stringify({ type: "AUTH", sessionToken }));

    const waitFor = (pred: (e: any) => boolean, what: string, ms = 60_000) => new Promise<any>((resolve, reject) => {
      const hit = events.find(pred);
      if (hit) return resolve(hit);
      const onMsg = (d: WebSocket.RawData) => {
        const e = JSON.parse(d.toString());
        if (pred(e)) { cleanup(); resolve(e); }
      };
      const t = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${what}; last events: ${events.slice(-8).map((e) => e.type).join(", ")}\n${gw.output.slice(-30).join("\n")}`)); }, ms);
      const cleanup = () => { clearTimeout(t); ws.off("message", onMsg); };
      ws.on("message", onMsg);
    });

    // The demo team (1 Lead, 4 devs, 1 reviewer) is hired at startup
    ws.send(JSON.stringify({ type: "PING" }));
    await waitFor((e) => e.type === "GATEWAY_INFO" && e.demo === true, "GATEWAY_INFO demo", 10_000);

    ws.send(JSON.stringify({ type: "BOSS_ASSIGN", prompt: "Build a tiny todo app", urgent: false }));
    const bossItem = await waitFor((e) => e.type === "WORK_ITEM_UPDATED" && e.item.origin === "boss", "the Boss's work item");
    await waitFor((e) => e.type === "HANDOFF" && e.fromId === "boss", "Boss → Lead hand-off");

    const done = await waitFor((e) => e.type === "WORK_ITEM_UPDATED" && e.item.id === bossItem.item.id && e.item.state === "done", "the Boss's item done");
    assert.equal(done.item.state, "done");

    // The Lead fanned the task out to several devs through the pool
    const devItems = new Map<string, any>();
    for (const e of events) if (e.type === "WORK_ITEM_UPDATED" && e.item.parentId === bossItem.item.id) devItems.set(e.item.id, e.item);
    assert.ok(devItems.size >= 3, `Lead split the task (${devItems.size} sub-items)`);
    assert.ok([...devItems.values()].every((i) => i.state === "done"), "every sub-item is done");
    const assignees = new Set([...devItems.values()].map((i) => i.assigneeId));
    assert.ok(assignees.size >= 2, `several devs worked (${[...assignees].join(", ")})`);
    assert.ok(events.some((e) => e.type === "HANDOFF" && e.fromId !== "boss"), "papers were walked between agents");
    await waitFor((e) => e.type === "TASK_DONE" && e.isFinalResult === true, "the Lead's final result", 10_000);
  });
});
