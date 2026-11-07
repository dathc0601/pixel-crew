#!/usr/bin/env node
/**
 * Fake agent CLI for tests and demos. Emits Claude-style stream-json without
 * calling any model, so orchestrator flows can run in CI for free.
 *
 * Usage: node fake-agent.mjs --scenario <file.json> [--record <file.jsonl>] [cli flags...] -p <prompt>
 *
 * Scenario file:
 * {
 *   "rules": [
 *     {
 *       "match": "Your name is Dev",          // regex tested against the prompt; first match wins
 *       "text": "SUMMARY: done",              // string or array of lines (one assistant text block)
 *       "toolUses": [{ "name": "Write", "input": { "file_path": "index.html" } }],
 *       "writeFiles": { "index.html": "<h1>hi</h1>" },  // written relative to cwd
 *       "delayMs": 0, "exitCode": 0, "stderr": ""
 *     }
 *   ],
 *   "default": { "text": "SUMMARY: nothing to do" }
 * }
 *
 * --record appends one JSON line per run: { argv, cwd, rule } (rule = index or "default").
 */
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const scenarioFile = flag("--scenario");
const recordFile = flag("--record");
const prompt = flag("-p") ?? "";

const scenario = scenarioFile ? JSON.parse(readFileSync(scenarioFile, "utf-8")) : { rules: [] };
let ruleIndex = "default";
let rule = scenario.default ?? { text: "SUMMARY: (fake agent) no matching rule" };
for (const [i, r] of (scenario.rules ?? []).entries()) {
  if (new RegExp(r.match, r.flags ?? "").test(prompt)) {
    rule = r;
    ruleIndex = i;
    break;
  }
}

if (recordFile) {
  appendFileSync(recordFile, JSON.stringify({ argv, cwd: process.cwd(), rule: ruleIndex }) + "\n");
}

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sessionId = `fake-${randomBytes(6).toString("hex")}`;
emit({ type: "system", subtype: "init", session_id: sessionId });

if (rule.delayMs) await sleep(rule.delayMs);

for (const [file, content] of Object.entries(rule.writeFiles ?? {})) {
  const abs = resolve(process.cwd(), file);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const usage = { input_tokens: 10, output_tokens: 5 };
if (rule.toolUses?.length) {
  emit({ type: "assistant", message: { content: rule.toolUses.map((t) => ({ type: "tool_use", name: t.name, input: t.input ?? {} })), usage } });
}

const text = Array.isArray(rule.text) ? rule.text.join("\n") : (rule.text ?? "");
if (text) emit({ type: "assistant", message: { content: [{ type: "text", text }], usage: { input_tokens: 20, output_tokens: 10 } } });
emit({ type: "result", subtype: (rule.exitCode ?? 0) === 0 ? "success" : "error", result: text, session_id: sessionId, usage: { input_tokens: 30, output_tokens: 15 } });

if (rule.stderr) process.stderr.write(rule.stderr + "\n");
process.exitCode = rule.exitCode ?? 0;
