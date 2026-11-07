#!/usr/bin/env node
/**
 * A fake "interactive Claude Code session" for tests and demo mode. No model is called.
 *
 * It imitates what Pixel Crew reads from a real session the owner started in a terminal:
 *   <home>/sessions/<pid>.json              registry entry (pid, sessionId, cwd, status, inbox socket)
 *   <home>/projects/<cwd key>/<sessionId>.jsonl   transcript (user / assistant / system records)
 *   an inbox socket (Unix socket, or a named pipe on Windows) that takes
 *   {"type":"user","message":{"role":"user","content":"..."}} lines, like cross-session messaging.
 *
 * For every inbox message it appends a user record, flips status to "busy", waits
 * --reply-delay ms, appends an assistant reply (stop_reason "end_turn") and a
 * system/turn_duration record, then goes back to "idle".
 *
 * Usage: node fake-claude-session.mjs --home <dir> --cwd <dir> [--session-id <id>]
 *        [--reply-delay <ms>] [--reply <text>] [--chatter <ms>] [--socket <path>] [--no-socket]
 *        [--exit-after-delivery] [--parent-pid <pid>]
 * Prints "FAKE_SESSION_READY {json}" once everything is written.
 */
import { appendFileSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(name);

const home = flag("--home");
const cwd = flag("--cwd", process.cwd());
if (!home) {
  console.error("--home is required");
  process.exit(2);
}
const sessionId = flag("--session-id", randomUUID());
const replyDelay = Number(flag("--reply-delay", "1500"));
const replyText = flag("--reply", "STATUS: done\nSUMMARY: (fake session) Finished the task in my own session.");
const chatterMs = Number(flag("--chatter", "0"));
const exitAfterDelivery = has("--exit-after-delivery");

const key = cwd.replace(/[^a-zA-Z0-9]/g, "-");
const projectDir = join(home, "projects", key);
const transcript = join(projectDir, `${sessionId}.jsonl`);
const sessionsDir = join(home, "sessions");
const registry = join(sessionsDir, `${process.pid}.json`);
mkdirSync(projectDir, { recursive: true });
mkdirSync(sessionsDir, { recursive: true });

function defaultSocket() {
  if (process.platform === "win32") return `\\\\.\\pipe\\pixel-crew-fake-session-${process.pid}`;
  const p = join(tmpdir(), `pxc-fake-${process.pid}.sock`);
  return p.length < 100 ? p : `/tmp/pxc-fake-${process.pid}.sock`;
}
const socketPath = has("--no-socket") ? undefined : flag("--socket", defaultSocket());

let status = "idle";
const startedAt = Date.now();
function writeRegistry() {
  const entry = {
    pid: process.pid, sessionId, cwd, startedAt, version: "fake", kind: "interactive", entrypoint: "cli",
    peerProtocol: socketPath ? 1 : undefined, messagingSocketPath: socketPath, status, updatedAt: Date.now(),
  };
  writeFileSync(registry, JSON.stringify(entry));
}
const record = (obj) => appendFileSync(transcript, JSON.stringify({ ...obj, sessionId, cwd, timestamp: new Date().toISOString() }) + "\n");

record({ type: "user", message: { role: "user", content: "(fake) earlier work in this terminal" } });
record({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "(fake) Done with the earlier work." }], stop_reason: "end_turn" } });
writeRegistry();

const queue = [];
let working = false;
function work() {
  if (working || queue.length === 0) return;
  working = true;
  const content = queue.shift();
  status = "busy";
  writeRegistry();
  record({ type: "user", message: { role: "user", content: `<cross-session-message from="script">${content}</cross-session-message>` } });
  if (exitAfterDelivery) {
    setTimeout(() => process.exit(0), 100);
    return;
  }
  setTimeout(() => {
    record({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: replyText }], stop_reason: "end_turn", usage: { input_tokens: 12, output_tokens: 6 } } });
    record({ type: "system", subtype: "turn_duration", durationMs: replyDelay });
    status = "idle";
    writeRegistry();
    working = false;
    work();
  }, replyDelay);
}

let server = null;
if (socketPath) {
  if (process.platform !== "win32" && existsSync(socketPath)) rmSync(socketPath, { force: true });
  server = createServer((sock) => {
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "user" && typeof msg.message?.content === "string") {
            queue.push(msg.message.content);
            work();
          }
        } catch { /* ignore */ }
      }
    });
    sock.on("error", () => {});
  });
  server.listen(socketPath, ready);
} else {
  ready();
}

// Optional "owner is typing in this terminal" activity for the demo
if (chatterMs > 0) {
  setInterval(() => {
    if (working) return;
    record({ type: "user", message: { role: "user", content: "(fake) owner asks something" } });
    record({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "(fake) Looked into it in the terminal." }], stop_reason: "end_turn" } });
  }, chatterMs).unref();
}

function ready() {
  console.log(`FAKE_SESSION_READY ${JSON.stringify({ pid: process.pid, sessionId, cwd, transcript, socketPath: socketPath ?? null })}`);
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { rmSync(registry, { force: true }); } catch { /* gone */ }
  try { server?.close(); } catch { /* closed */ }
  if (socketPath && process.platform !== "win32") {
    try { rmSync(socketPath, { force: true }); } catch { /* gone */ }
  }
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { cleanup(); process.exit(0); });
// Stay alive until killed, or until the process that started us is gone (--parent-pid)
const parentPid = Number(flag("--parent-pid", "0"));
setInterval(() => {
  if (!parentPid) return;
  try { process.kill(parentPid, 0); } catch { cleanup(); process.exit(0); }
}, 2000);
