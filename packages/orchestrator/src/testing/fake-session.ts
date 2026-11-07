import { fileURLToPath } from "url";
import type { ChildProcess } from "child_process";
import { spawnPortable, killTree } from "../proc.js";

/** Absolute path of the fake interactive Claude session script (see the script header). */
export const FAKE_CLAUDE_SESSION_SCRIPT = fileURLToPath(new URL("../../fake-agent/fake-claude-session.mjs", import.meta.url));

export interface FakeClaudeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  transcript: string;
  socketPath: string | null;
  child: ChildProcess;
  /** Kill the fake session (its registry entry and socket are removed on exit) */
  stop(): Promise<void>;
}

export interface FakeClaudeSessionOptions {
  /** Fake Claude config dir (holds sessions/ and projects/) */
  home: string;
  cwd: string;
  sessionId?: string;
  replyDelayMs?: number;
  reply?: string;
  chatterMs?: number;
  noSocket?: boolean;
  exitAfterDelivery?: boolean;
  scriptPath?: string;
}

/** Start fake-claude-session.mjs and wait until its registry, transcript and socket exist. */
export function startFakeClaudeSession(o: FakeClaudeSessionOptions): Promise<FakeClaudeSession> {
  const args = [o.scriptPath ?? FAKE_CLAUDE_SESSION_SCRIPT, "--home", o.home, "--cwd", o.cwd, "--parent-pid", String(process.pid)];
  if (o.sessionId) args.push("--session-id", o.sessionId);
  if (o.replyDelayMs !== undefined) args.push("--reply-delay", String(o.replyDelayMs));
  if (o.reply) args.push("--reply", o.reply);
  if (o.chatterMs) args.push("--chatter", String(o.chatterMs));
  if (o.noSocket) args.push("--no-socket");
  if (o.exitAfterDelivery) args.push("--exit-after-delivery");
  const child = spawnPortable(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("fake Claude session did not start")), 10_000);
    child.stderr?.on("data", (d: Buffer) => console.error(`[fake-session] ${d.toString().trim()}`));
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`fake Claude session exited (${code})`)); });
    child.stdout?.on("data", (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/FAKE_SESSION_READY (.*)\n/);
      if (!m) return;
      clearTimeout(timer);
      child.removeAllListeners("exit");
      const info = JSON.parse(m[1]);
      resolve({
        ...info,
        child,
        stop: () => new Promise<void>((done) => {
          if (child.exitCode !== null || child.signalCode !== null) return done();
          child.once("exit", () => done());
          // SIGTERM lets the script remove its registry entry and socket
          if (process.platform === "win32") killTree(info.pid, "SIGKILL");
          else child.kill("SIGTERM");
        }),
      });
    });
  });
}
