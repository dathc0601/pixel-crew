// P4.5 on the client: batched chunks, previews for closed panes, and catch-up (replace).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });

type Store = typeof import("../office-store");
let useOfficeStore: Store["useOfficeStore"];

before(async () => {
  ({ useOfficeStore } = await import("../office-store"));
});

const ev = (e: Record<string, unknown>) => useOfficeStore.getState().handleEvent(e as never);
const streamText = (id: string) => {
  const msgs = useOfficeStore.getState().agents.get(id)!.messages;
  return msgs[msgs.length - 1]?.text;
};

describe("LOG_APPEND in the store", () => {
  it("appends batches, keeps previews out of the chat, and replaces on catch-up", () => {
    ev({ type: "AGENT_CREATED", agentId: "a", name: "A", role: "dev", palette: 0 });
    ev({ type: "TASK_STARTED", agentId: "a", taskId: "t", prompt: "do it" });
    ev({ type: "LOG_APPEND", agentId: "a", taskId: "t", stream: "stdout", chunk: "one\ntwo" });
    assert.equal(streamText("a"), "one\ntwo");
    assert.equal(useOfficeStore.getState().agentLogLines.get("a"), "two", "status line = last line of a batch");

    ev({ type: "LOG_APPEND", agentId: "a", taskId: "t", stream: "stdout", chunk: "three", preview: true });
    assert.equal(streamText("a"), "one\ntwo", "a preview is not chat text");
    assert.equal(useOfficeStore.getState().agentLogLines.get("a"), "three");

    ev({ type: "LOG_APPEND", agentId: "a", taskId: "t", stream: "stdout", chunk: "one\ntwo\nthree\nfour", replace: true });
    assert.equal(streamText("a"), "one\ntwo\nthree\nfour", "catch-up replaces instead of duplicating");
    ev({ type: "LOG_APPEND", agentId: "a", taskId: "t", stream: "stdout", chunk: "five" });
    assert.equal(streamText("a"), "one\ntwo\nthree\nfour\nfive");
  });
});
