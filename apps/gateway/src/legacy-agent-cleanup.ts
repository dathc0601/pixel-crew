/**
 * Undo what older gateways wrote into the user's global Claude agents directory.
 *
 * Before this fix, syncAgentDefs() copied every bundled role pack into ~/.claude/agents/ on
 * each start, overwriting files of the same name. Pixel Crew now passes the packs per run
 * (`--agents <file>`), so those copies only clutter every Claude Code session.
 *
 * Rules: a file is removed only when it is a regular file whose bytes equal a role pack we
 * shipped (the current bundled file or a known earlier version). Anything else is kept and
 * logged, so a user's own agent with the same file name is never touched.
 */
import { createHash } from "crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * SHA-256 of role pack versions that earlier releases shipped and that differ from today's
 * bundled files (from `git log -- packages/orchestrator/agents`; replaced in bf51b93).
 */
export const PREVIOUS_ROLE_PACK_SHA256: Readonly<Record<string, readonly string[]>> = {
  "game-designer.md": ["3a0166dd9add03e7aa61a15b5605da4bb62471dc2cd07fa6d3f17eeb6c93692d"],
  "level-designer.md": ["07d996973fbcc71fe77072000945895303e649668cd4113d5a0b5c0d84297f63"],
  "narrative-designer.md": ["1f793896731137bc24df3fd39a2e161b31a9bb2878aa3e7ef97c17921a49d8ac"],
  "product-manager.md": ["c549cbd343c6b774dc85368cfcb712f68c9cedeace02ac010f93b779f27d6fda"],
};

export interface LegacyCleanupOptions {
  /** Directory holding the bundled role packs (*.md) */
  bundledDir: string;
  /** Home directory whose .claude/agents/ older versions wrote to (default: os.homedir()) */
  home?: string;
  /** Extra known hashes per file name (default: PREVIOUS_ROLE_PACK_SHA256) */
  previous?: Readonly<Record<string, readonly string[]>>;
  log?: (msg: string) => void;
}

export interface LegacyCleanupResult {
  /** File names deleted because they were byte-identical to a shipped pack */
  removed: string[];
  /** File names left alone: content differs, not a regular file, or unreadable */
  kept: string[];
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Whether the startup cleanup should run: never in demo mode or with PIXEL_CREW_SKIP_LEGACY_CLEANUP=1. */
export function shouldRunLegacyCleanup(opts: { demo: boolean; env?: NodeJS.ProcessEnv }): boolean {
  const env = opts.env ?? process.env;
  return !opts.demo && env.PIXEL_CREW_SKIP_LEGACY_CLEANUP !== "1";
}

export function cleanupLegacyAgentFiles(opts: LegacyCleanupOptions): LegacyCleanupResult {
  const log = opts.log ?? ((msg: string) => console.log(msg));
  const previous = opts.previous ?? PREVIOUS_ROLE_PACK_SHA256;
  const targetDir = join(opts.home ?? homedir(), ".claude", "agents");
  const result: LegacyCleanupResult = { removed: [], kept: [] };
  if (!existsSync(targetDir) || !existsSync(opts.bundledDir)) return result;

  const bundled = readdirSync(opts.bundledDir).filter(f => f.endsWith(".md"));
  const names = [...new Set([...bundled, ...Object.keys(previous)])].sort();
  for (const name of names) {
    const target = join(targetDir, name);
    let stat;
    try { stat = lstatSync(target); } catch { continue; } // not there: nothing to do
    if (!stat.isFile()) {
      result.kept.push(name);
      log(`[Agents] Kept ${target}: not a regular file`);
      continue;
    }
    const known = new Set(previous[name] ?? []);
    if (bundled.includes(name)) known.add(sha256(readFileSync(join(opts.bundledDir, name))));
    try {
      if (!known.has(sha256(readFileSync(target)))) {
        result.kept.push(name);
        log(`[Agents] Kept ${target}: content differs from every role pack Pixel Crew shipped`);
        continue;
      }
      unlinkSync(target);
      result.removed.push(name);
      log(`[Agents] Removed ${target}: unchanged copy written by an older Pixel Crew`);
    } catch (e) {
      result.kept.push(name);
      log(`[Agents] Kept ${target}: ${(e as Error).message}`);
    }
  }
  return result;
}
