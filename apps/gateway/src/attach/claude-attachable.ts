// `pixel-crew claude-attachable [claude args…]`: start an interactive Claude Code session
// that takes Pixel Crew's live-mode tasks without an approval prompt.
//
// Live mode posts tasks to the session's cross-session inbox. A session that bypasses
// permission prompts holds such messages for approval (5 minutes), and a user setting
// may refuse them. This launcher passes `--settings <file>` with
// {"crossSessionInbound":"accept"} for THIS session only (code.claude.com/docs/en/
// cross-session-messaging.md: "start it with crossSessionInbound set to accept in its
// --settings value"). Nothing is written to ~/.claude; the settings file lives in the
// system temp dir. Trade-off: that session accepts messages from every local session
// and script of your OS user without asking.
import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
import os from "os";
import path from "path";

export const ATTACHABLE_SETTINGS = { crossSessionInbound: "accept" } as const;

/** The claude argv the launcher runs (settings file first, then the caller's own flags). */
export function claudeAttachableArgs(settingsFile: string, userArgs: readonly string[]): string[] {
  return ["--settings", settingsFile, ...userArgs];
}

export function runClaudeAttachable(userArgs: readonly string[]): number {
  const dryRun = userArgs.includes("--dry-run");
  const rest = userArgs.filter((a) => a !== "--dry-run");
  const settingsFile = path.join(os.tmpdir(), "pixel-crew-claude-attachable.json");
  writeFileSync(settingsFile, JSON.stringify(ATTACHABLE_SETTINGS));
  const args = claudeAttachableArgs(settingsFile, rest);
  console.log("[pixel-crew] Starting Claude Code with crossSessionInbound=accept for this session only.");
  console.log("[pixel-crew] In the office, pick \"Live in terminal\" when this session joins the team.");
  if (dryRun) {
    console.log(`claude ${args.join(" ")}`);
    return 0;
  }
  // Windows npm installs are .cmd shims, which need a shell; the arguments stay simple there
  const res = spawnSync("claude", args, { stdio: "inherit", shell: process.platform === "win32" });
  if (res.error) {
    console.error(`[pixel-crew] Could not start claude: ${res.error.message}`);
    return 1;
  }
  return res.status ?? 1;
}
