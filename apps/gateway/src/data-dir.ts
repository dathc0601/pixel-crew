import { existsSync, lstatSync, renameSync, symlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { resolve } from "path";

export interface DataDirOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

function isDevEnv(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "development";
}

/** ~/.pixel-crew (or ~/.pixel-crew-dev), unless PIXEL_CREW_HOME overrides it. */
export function resolveDataDir(opts: DataDirOptions = {}): string {
  const env = opts.env ?? process.env;
  if (env.PIXEL_CREW_HOME) return resolve(env.PIXEL_CREW_HOME);
  return resolve(opts.home ?? homedir(), isDevEnv(env) ? ".pixel-crew-dev" : ".pixel-crew");
}

/** The pre-rename data directory: ~/.open-office (or ~/.open-office-dev). */
export function resolveLegacyDataDir(opts: DataDirOptions = {}): string {
  const env = opts.env ?? process.env;
  return resolve(opts.home ?? homedir(), isDevEnv(env) ? ".open-office-dev" : ".open-office");
}

export type MigrationResult =
  | { status: "none"; dataDir: string }
  | { status: "migrated"; dataDir: string; legacyDir: string; symlinked: boolean }
  | { status: "failed"; dataDir: string; legacyDir: string; error: string };

/**
 * One-time migration from the legacy data dir to the new one.
 *
 * The legacy directory is renamed (not copied) and a symlink is left at the old
 * path. State files and git worktree metadata store absolute paths under the old
 * directory; the symlink keeps them resolving without rewriting anything.
 *
 * If the rename fails, the legacy directory stays in use so no data is lost.
 * Nothing happens when PIXEL_CREW_HOME is set or the new directory already exists.
 */
export function migrateLegacyDataDir(opts: DataDirOptions = {}): MigrationResult {
  const env = opts.env ?? process.env;
  const dataDir = resolveDataDir(opts);
  if (env.PIXEL_CREW_HOME) return { status: "none", dataDir };
  if (existsSync(dataDir)) return { status: "none", dataDir };

  const legacyDir = resolveLegacyDataDir(opts);
  let isRealDir = false;
  try {
    const st = lstatSync(legacyDir);
    isRealDir = st.isDirectory() && !st.isSymbolicLink();
  } catch { /* missing */ }
  if (!isRealDir) return { status: "none", dataDir };

  try {
    renameSync(legacyDir, dataDir);
  } catch (err) {
    return { status: "failed", dataDir: legacyDir, legacyDir, error: (err as Error).message };
  }

  let symlinked = false;
  try {
    symlinkSync(dataDir, legacyDir, process.platform === "win32" ? "junction" : "dir");
    symlinked = true;
  } catch { /* best effort: absolute paths in old state files may need re-creating */ }

  try {
    writeFileSync(
      resolve(dataDir, "MIGRATED_FROM.txt"),
      `Migrated from ${legacyDir} on ${new Date().toISOString()}.\n` +
        (symlinked ? `${legacyDir} is now a symlink to this directory.\n` : ""),
      "utf-8",
    );
  } catch { /* informational only */ }

  return { status: "migrated", dataDir, legacyDir, symlinked };
}
