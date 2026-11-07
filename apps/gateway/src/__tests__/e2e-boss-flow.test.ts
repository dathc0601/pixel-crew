// End-to-end (P5.1 acceptance): a real gateway process in demo mode, driven over HTTP and
// WebSocket like the UI drives it. The Boss assigns a task, the Lead splits it, devs pick
// the parts from the pool, the reviewer passes it, and the Boss's item ends "done".
// Every agent is fake-agent.mjs (scripted, no tokens); runs on Linux, macOS and Windows.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";
import { killTree } from "@pixel-crew/orchestrator";
import { httpRequest } from "./helpers/http.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const gatewayDir = path.resolve(here, "..", "..");
const entry = path.join(gatewayDir, "src", "index.ts");

interface Gateway { child: ChildProcess; port: number; output: string[] }

function startGateway(home: string, workspace: string): Promise<Gateway> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PIXEL_CREW_HOME: home,
      WORKSPACE: workspace,
      WS_PORT: String(20000 + Math.floor(Math.random() * 20000)),
      GATEWAY_ID: "e2e",
      NO_OPEN: "1",
      PIXEL_CREW_EXTERNAL_AGENTS: "0",
      PIXEL_CREW_DEMO_DELAY_SCALE: "0.05",
    };
    delete env.NODE_ENV;
    delete env.PIXEL_CREW_LAN;
    delete env.ABLY_API_KEY;
    delete env.TELEGRAM_BOT_TOKEN;
    const child = spawn(process.execPath, ["--import", "tsx", entry, "--demo"], {
      cwd: gatewayDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    const output: string[] = [];
    let buf = "";
    const timer = setTimeout(() => reject(new Error(`gateway did not start:\n${output.slice(-40).join("\n")}`)), 30_000);
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        output.push(line);
        const m = line.match(/^GATEWAY_READY (.*)$/);
        if (m) {
          clearTimeout(timer);
          resolve({ child, port: JSON.parse(m[1]).port, output });
        }
      }
    });
    child.stderr!.on("data", (d: Buffer) => output.push(`[stderr] ${d.toString().trim()}`));
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`gateway exited early (${code}):\n${output.slice(-40).join("\n")}`)); });
  });
}

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
    gw = await startGateway(home, workspace);
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
