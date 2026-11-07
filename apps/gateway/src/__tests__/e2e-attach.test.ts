// End-to-end (Phase 2a): a real gateway in demo mode simulates one Claude Code session the
// owner opened in a terminal. The owner adds it to the team, the Boss assigns a task, the
// Lead walks a sub-task to it, it finishes, and the owner takes it off the team again.
// Everything is fake (fake-claude-session.mjs + fake-agent.mjs); no tokens are spent.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import WebSocket from "ws";
import { killTree } from "@pixel-crew/orchestrator";
import { httpRequest } from "./helpers/http.js";
import { startGateway, type Gateway } from "./helpers/gateway.js";

for (const mode of ["fork", "live"] as const) {
  describe(`attach a Claude session end to end (demo mode, ${mode})`, () => {
    const home = mkdtempSync(path.join(tmpdir(), "pixel-crew-e2e-attach-"));
    const workspace = path.join(home, "workspace");
    let gw: Gateway;
    let ws: WebSocket;
    const events: any[] = [];

    before(async () => {
      mkdirSync(workspace, { recursive: true });
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

    it("Join team → the Lead hands it a sub-task → done → Leave team", { timeout: 90_000 }, async () => {
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

      ws.send(JSON.stringify({ type: "PING" }));
      const ext = await waitFor((e) => e.type === "AGENT_CREATED" && e.isExternal === true && e.attachOptions?.length, "the simulated external Claude session", 15_000);
      assert.deepEqual(ext.attachOptions.map((o: any) => o.mode), ["fork", "live"]);
      const id = ext.agentId;

      ws.send(JSON.stringify({ type: "ATTACH_EXTERNAL", agentId: id, role: "dev", mode }));
      const ok = await waitFor((e) => e.type === "ATTACH_RESULT" && e.agentId === id, "ATTACH_RESULT");
      assert.equal(ok.ok, true, ok.error);
      const joined = await waitFor((e) => e.type === "AGENT_CREATED" && e.agentId === id && e.attached === true, "the attached member");
      assert.equal(joined.attachMode, mode);
      assert.equal(joined.isExternal, false);
      assert.ok(joined.teamId, "it is on the team");

      ws.send(JSON.stringify({ type: "BOSS_ASSIGN", prompt: "Build a tiny shop", urgent: false }));
      const bossItem = await waitFor((e) => e.type === "WORK_ITEM_UPDATED" && e.item.origin === "boss", "the Boss's work item");
      const handoff = await waitFor((e) => e.type === "HANDOFF" && e.kind === "lead_to_dev" && e.toId === id, "a hand-off to the attached session");
      const doneItem = await waitFor((e) => e.type === "WORK_ITEM_UPDATED" && e.item.id === handoff.workItemId && (e.item.state === "done" || e.item.state === "in_review"), "its sub-task delivered");
      assert.equal(doneItem.item.assigneeId, id);
      const taskDone = await waitFor((e) => e.type === "TASK_DONE" && e.agentId === id, "TASK_DONE from the attached session");
      assert.match(taskDone.result.summary, mode === "fork" ? /fork of my terminal session/ : /in my own terminal session/);
      await waitFor((e) => e.type === "WORK_ITEM_UPDATED" && e.item.id === bossItem.item.id && e.item.state === "done", "the Boss's item done");

      ws.send(JSON.stringify({ type: "DETACH_AGENT", agentId: id }));
      await waitFor((e) => e.type === "ATTACH_RESULT" && e.action === "detach" && e.ok, "detach result");
      const back = await waitFor((e) => e.type === "AGENT_CREATED" && e.agentId === id && e.isExternal === true && e.attached === false, "external again");
      assert.ok(back.attachOptions?.length, "it can join again");
      assert.ok(!events.some((e) => e.type === "AGENT_FIRED" && e.agentId === id), "leaving the team never removes the session");
    });
  });
}
