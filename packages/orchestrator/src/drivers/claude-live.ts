// ---------------------------------------------------------------------------
// Live mode: the task goes into the owner's running session, visible in their terminal.
//
// Delivery: Claude Code ≥ 2.1.224 binds a per-session inbox socket for cross-session
// messages (code.claude.com/docs/en/cross-session-messaging.md, "The session's inbox
// socket"). The docs cover "a script or hook to post into a session"; an idle session
// "starts a new turn with the message". On macOS and Linux the auth line is optional.
// The message line `{"type":"user","message":{"role":"user","content":…}}` comes from
// the CLI's own debug hint (binary strings, 2.1.319), not from a documented contract.
//
// Completion: the session's transcript. The run counts as delivered when a record that
// carries our marker appears, and as finished at the next turn end after it (an
// assistant record with stop_reason "end_turn", or a system "turn_duration" record).
// The transcript format is internal to Claude Code (docs: "changes between versions").
//
// Receiving rules belong to the owner's session: a session that bypasses permission
// prompts HOLDS such messages for approval in its terminal (5 minutes by default), and
// `crossSessionInbound: "refuse"` drops them. Pixel Crew cannot see either outcome, so
// an undelivered task times out and the Dispatcher re-queues it.
// ---------------------------------------------------------------------------

import { createConnection } from "net";
import { closeSync, openSync, readSync, statSync } from "fs";
import { VirtualRun, type AgentDriver, type AttachTarget, type DriverRunSpec } from "./driver.js";

export const LIVE_NOTE = "Work appears in your terminal: Claude starts a turn in that session for each task.";
export const LIVE_NOTE_BYPASS = "Work appears in your terminal. That session skips permission prompts, so Claude Code asks you there to accept each task (5 minutes).";

/** Marker put at the top of every live task; found again in the transcript. */
export function liveTaskMarker(taskId: string): string {
  return `[pixel-crew task ${taskId}]`;
}

/** The single JSON line posted to the inbox socket. */
export function liveMessageLine(text: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: text } });
}

/** Post one line to a session's inbox socket (Unix socket or Windows named pipe). */
export function postToInbox(socketPath: string, line: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath);
    const timer = setTimeout(() => { sock.destroy(); reject(new Error("inbox socket timed out")); }, timeoutMs);
    sock.once("error", (err) => { clearTimeout(timer); reject(err); });
    sock.once("connect", () => {
      sock.end(line + "\n", () => { clearTimeout(timer); resolve(); });
    });
  });
}

export interface ClaudeLiveDriverOptions {
  target: () => AttachTarget;
  /** The owner's session process is still running */
  isAlive: () => boolean;
  externallyBusy?: () => boolean;
  /** The owner's session bypasses permission prompts (messages are held for approval) */
  bypassesPermissions?: boolean;
  /** Override delivery (tests) */
  deliver?: (socketPath: string, line: string) => Promise<void>;
  /** Transcript poll interval (default 400 ms) */
  pollMs?: number;
  /** Give up when the message is not in the transcript after this long (default 6 min) */
  deliveryTimeoutMs?: number;
}

interface TranscriptRecord {
  type?: string;
  subtype?: string;
  message?: { content?: unknown; stop_reason?: string | null; usage?: unknown };
}

export function createClaudeLiveDriver(o: ClaudeLiveDriverOptions): AgentDriver {
  const pollMs = o.pollMs ?? 400;
  const deliveryTimeoutMs = o.deliveryTimeoutMs ?? 6 * 60_000;
  const deliver = o.deliver ?? ((p, l) => postToInbox(p, l));
  const describe = (spec: DriverRunSpec) => {
    const t = o.target();
    return { command: `inbox:${t.messagingSocketPath ?? "(none)"}`, args: [liveMessageLine(`${liveTaskMarker(spec.taskId)}\n${spec.prompt}`)] };
  };

  return {
    kind: "live",
    note: o.bypassesPermissions ? LIVE_NOTE_BYPASS : LIVE_NOTE,
    get pinnedCwd() { return o.target().cwd; },
    borrowsSession: true,
    externallyBusy: o.externallyBusy,
    describe,
    start(spec) {
      const run = new VirtualRun();
      const target = o.target();
      const marker = liveTaskMarker(spec.taskId);
      let offset = 0;
      try { offset = statSync(target.transcriptPath).size; } catch { /* created on first write */ }
      let partial = "";
      let delivered = false;
      let lastText = "";
      let timer: ReturnType<typeof setInterval> | null = null;
      const startedAt = Date.now();

      const stop = () => { if (timer) clearInterval(timer); timer = null; };
      run.setKillHandler(stop);

      const fail = (why: string) => {
        stop();
        run.writeErr(`Error: ${why}`);
        run.finish(1);
      };
      const succeed = () => {
        stop();
        run.writeLine({ type: "result", subtype: "success", result: lastText, session_id: target.sessionId });
        run.finish(0);
      };

      const onRecord = (rawLine: string) => {
        if (!delivered) {
          if (!rawLine.includes(marker)) return;
          delivered = true;
          run.writeLine({ type: "system", subtype: "init", session_id: target.sessionId });
          return;
        }
        let rec: TranscriptRecord;
        try { rec = JSON.parse(rawLine); } catch { return; }
        if (rec.type === "assistant" && rec.message) {
          const content = Array.isArray(rec.message.content) ? rec.message.content : [];
          const texts = content.filter((b: { type?: string; text?: string }) => b?.type === "text" && typeof b.text === "string").map((b: { text: string }) => b.text);
          if (texts.length) lastText = texts.join("\n");
          run.writeLine({ type: "assistant", message: { content, ...(rec.message.usage ? { usage: rec.message.usage } : {}) } });
          if (rec.message.stop_reason === "end_turn") succeed();
        } else if (rec.type === "system" && rec.subtype === "turn_duration") {
          succeed();
        }
      };

      const poll = () => {
        if (run.isClosed) return stop();
        try {
          const size = statSync(target.transcriptPath).size;
          if (size < offset) offset = 0; // rewritten
          if (size > offset) {
            const buf = Buffer.alloc(size - offset);
            const fd = openSync(target.transcriptPath, "r");
            try { readSync(fd, buf, 0, buf.length, offset); } finally { closeSync(fd); }
            offset = size;
            const lines = (partial + buf.toString("utf-8")).split("\n");
            partial = lines.pop() ?? "";
            for (const line of lines) {
              if (line.trim()) onRecord(line);
              if (run.isClosed) return;
            }
          }
        } catch { /* no transcript yet */ }
        if (!o.isAlive()) return fail("the Claude Code session ended before the task finished");
        if (!delivered && Date.now() - startedAt > deliveryTimeoutMs) {
          return fail("the session did not take the task (held for approval, refused, or messaging is off)");
        }
      };

      if (!target.messagingSocketPath) {
        setImmediate(() => fail("this session has no inbox socket (Claude Code 2.1.224 or later is needed)"));
        return run;
      }
      deliver(target.messagingSocketPath, liveMessageLine(`${marker}\n${spec.prompt}`)).then(
        () => { if (!run.isClosed) { timer = setInterval(poll, pollMs); timer.unref?.(); } },
        (err: Error) => fail(`could not reach the session's inbox socket: ${err.message}`),
      );
      return run;
    },
  };
}
