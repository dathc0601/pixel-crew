// Event-stream efficiency (plan P4.5).
//
// LogCoalescer sits in front of every channel: LOG_APPEND chunks of the same agent, task
// and stream that arrive within ~100 ms go out as one event (lines joined with "\n", which
// is exactly how clients accumulate them). Any other event first flushes what is pending,
// so a TASK_DONE never overtakes the last log lines. "💭 " thinking snippets are status
// lines (clients do not add them to the chat), so they are never merged.
//
// It also keeps the current task's output per agent (capped), so a client that opens an
// agent's pane mid-task gets everything so far (LOG_APPEND replace: true).

import type { GatewayEvent, LogAppendEvent } from "@pixel-crew/shared";

export const LOG_BATCH_MS = 100;
/** Output kept per agent for late subscribers (the end of it, when longer) */
export const LOG_TAIL_MAX_CHARS = 64 * 1024;
const THINKING_PREFIX = "💭 ";

export function isThinkingChunk(chunk: string): boolean {
  return chunk.startsWith(THINKING_PREFIX);
}

/** The last non-empty line of a chunk (a status line for agents whose pane is closed). */
export function lastLine(chunk: string): string {
  const lines = chunk.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i];
  return "";
}

interface Pending {
  event: LogAppendEvent;
  parts: string[];
}

export class LogCoalescer {
  private pending = new Map<string, Pending>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tails = new Map<string, { taskId: string; stream: LogAppendEvent["stream"]; text: string }>();

  constructor(
    private emit: (event: GatewayEvent) => void,
    private windowMs = LOG_BATCH_MS,
  ) {}

  push(event: GatewayEvent): void {
    this.track(event);
    if (event.type === "LOG_APPEND" && !event.replace && !event.preview && event.chunk && !isThinkingChunk(event.chunk)) {
      const key = `${event.agentId}\u0000${event.taskId}\u0000${event.stream}`;
      const p = this.pending.get(key);
      if (p) p.parts.push(event.chunk);
      else this.pending.set(key, { event, parts: [event.chunk] });
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush();
        }, this.windowMs);
        this.timer.unref?.();
      }
      return;
    }
    this.flush();
    this.emit(event);
  }

  /** Send everything pending now (before other events, and on shutdown). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;
    const batch = [...this.pending.values()];
    this.pending.clear();
    for (const { event, parts } of batch) {
      this.emit(parts.length === 1 ? event : { ...event, chunk: parts.join("\n") });
    }
  }

  /** The current task's output so far, as one replace event (null when the agent is not working). */
  getTail(agentId: string): LogAppendEvent | null {
    const t = this.tails.get(agentId);
    if (!t || !t.text) return null;
    return { type: "LOG_APPEND", agentId, taskId: t.taskId, stream: t.stream, chunk: t.text, replace: true };
  }

  dispose(): void {
    this.flush();
    this.tails.clear();
  }

  private track(event: GatewayEvent): void {
    switch (event.type) {
      case "TASK_STARTED":
        this.tails.set(event.agentId, { taskId: event.taskId, stream: "stdout", text: "" });
        break;
      case "TASK_DONE":
      case "TASK_FAILED":
      case "AGENT_FIRED":
        this.tails.delete(event.agentId);
        break;
      case "LOG_APPEND": {
        if (event.replace || event.preview || !event.chunk || isThinkingChunk(event.chunk)) break;
        const t = this.tails.get(event.agentId);
        // Only tasks we saw start (external sessions have no TASK_STARTED)
        if (!t || t.taskId !== event.taskId) break;
        let text = t.text ? `${t.text}\n${event.chunk}` : event.chunk;
        if (text.length > LOG_TAIL_MAX_CHARS) {
          text = text.slice(text.length - LOG_TAIL_MAX_CHARS);
          const nl = text.indexOf("\n");
          if (nl >= 0) text = text.slice(nl + 1);
        }
        t.text = text;
        t.stream = event.stream;
        break;
      }
    }
  }
}

/** Per-connection log subscription (null = an older client: every log in full). */
export interface LogSubscription {
  agentIds: Set<string>;
  previews: boolean;
}

/**
 * What one connection gets for a LOG_APPEND: the event, a one-line preview, or nothing.
 * Spectators get status events only (no logs).
 */
export function logEventFor(
  event: LogAppendEvent,
  role: string,
  sub: LogSubscription | null,
): "full" | "preview" | "none" {
  if (role === "spectator") return "none";
  if (!sub || sub.agentIds.has(event.agentId)) return "full";
  return sub.previews ? "preview" : "none";
}

/** The preview form of a log event: last line only, flagged so clients keep it out of the chat. */
export function previewOf(event: LogAppendEvent): LogAppendEvent {
  return { type: "LOG_APPEND", agentId: event.agentId, taskId: event.taskId, stream: event.stream, chunk: lastLine(event.chunk), preview: true };
}
