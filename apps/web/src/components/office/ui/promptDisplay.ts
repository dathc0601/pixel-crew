// The daemon sends each run's full prompt in TASK_STARTED, and the chat log shows it as the
// "user" line. For team runs that prompt is an internal template (the Lead's delegation rules,
// result batches, "[Assigned by …]" wrappers). describePrompt() turns the ones we know into a
// short human line; the raw text stays available behind a "raw" toggle.

export interface PromptDisplay {
  /** Short tag shown before the text */
  tag: string;
  /** What a person would call this message */
  text: string;
}

const MAX_TEXT = 240;

function clip(text: string): string {
  const t = text.trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

/** "- Rex (completed successfully): Finished my part." lines of a result batch */
function resultLines(block: string): string[] {
  const lines = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).replace(/^([^:(]+?) \([^)]*\):/, '$1:'));
  return lines.length > 0 ? lines : [block.trim()];
}

function assigned(text: string): PromptDisplay | null {
  const i = text.lastIndexOf("[Assigned by ");
  if (i < 0) return null;
  const m = /^\[Assigned by ([^\]]+?)\]\n?([\s\S]*)$/.exec(text.slice(i));
  if (!m) return null;
  const from = m[1].replace(/\s*\(.*\)\s*$/, "").trim();
  return { tag: "task", text: clip(`${from}: ${m[2]}`) };
}

/**
 * A human-readable version of an internal team prompt, or null when the text is
 * already what a person typed (show it as it is).
 */
export function describePrompt(raw: string): PromptDisplay | null {
  const text = raw.replace(/\r\n/g, "\n");

  // Boss → Lead (dispatcher wrapper around the Boss's own words)
  const boss = /^The Boss assigned you a task:\n([\s\S]*?)\nSplit it into sub-tasks/.exec(text);
  if (boss) return { tag: "boss", text: clip(`Boss: ${boss[1]}`) };

  // Result batch for the Lead (leader-result template)
  const result = /\nNew results? from ([^\n]*?):?\n([\s\S]*?)(?:\n\s*CRITICAL:|\n\s*Next step|$)/.exec(text);
  if (result && /^You are (the Team Lead|\S+, the Team Lead)/.test(text)) {
    const who = result[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
    const lines = resultLines(result[2]);
    const body = lines.length === 1 && !result[2].includes("\n- ") ? lines[0] : lines.join(" · ");
    return { tag: "results", text: clip(`From ${who}: ${body}`) };
  }

  // Lead → dev hand-off, alone or at the end of a worker template
  const task = assigned(text);
  if (task) return task;

  // Reviewer → dev fix request
  const fix = /^\[Direct fix request from ([^\]]+)\]/.exec(text);
  if (fix) return { tag: "fix", text: clip(`${fix[1]} asked for fixes`) };

  // Any other role template: keep only the last paragraph, which is the actual request
  if (/^(\[Context reminder\]|Your name is |You are \S+(, | \(| the ))/.test(text) && text.length > 160) {
    const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1] ?? "";
    return { tag: "task", text: clip(last) };
  }

  return null;
}
