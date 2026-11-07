/**
 * Portable process helpers (P5.1): command lookup, spawning and process-tree kills
 * that behave the same on macOS, Linux and Windows.
 *
 * - Lookup walks PATH (and PATHEXT on Windows) in-process: no `which`/`where` child.
 * - Spawning goes straight to the executable. On Windows, `.cmd`/`.bat` shims cannot
 *   be spawned without a shell (Node refuses since CVE-2024-27980), and cmd.exe cannot
 *   carry newlines in arguments, which multi-line agent prompts need. So an npm shim is
 *   unwrapped to `node <script>` when its target can be read from the shim; anything
 *   else goes through cross-spawn, which quotes for cmd.exe.
 * - Kills take the whole tree: a process group on Unix (children are spawned detached,
 *   so pid == pgid), `taskkill /T /F` on Windows (no process groups there).
 */
import { spawn as nodeSpawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncReturns } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { connect as netConnect } from "net";
import crossSpawn from "cross-spawn";

const isWindows = () => process.platform === "win32";

/** PATH entries from an env (Windows env keys are case-insensitive: Path, PATH). */
function envPathEntries(env: NodeJS.ProcessEnv): string[] {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  return (env[key] ?? "").split(path.delimiter).map((p) => p.replace(/^"(.*)"$/, "$1")).filter(Boolean);
}

/** Executable extensions to try on Windows, lower-case, in PATHEXT order. */
export function pathExtensions(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== "win32") return [""];
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATHEXT");
  const raw = (key && env[key]) || ".COM;.EXE;.BAT;.CMD";
  return raw.split(";").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function isExecutableFile(file: string): boolean {
  try {
    const st = statSync(file);
    if (!st.isFile()) return false;
    if (isWindows()) return true;
    return (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/**
 * Resolve a command name to an absolute executable path, like `which` / `where`,
 * without starting a child process. Absolute or relative paths are checked as given
 * (plus PATHEXT on Windows). Returns null when nothing executable is found.
 */
export function resolveCommand(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!command) return null;
  const exts = pathExtensions(env);
  const hasExt = isWindows() && exts.includes(path.extname(command).toLowerCase());
  const candidatesFor = (base: string) => (isWindows() ? (hasExt ? [base] : exts.map((e) => base + e)) : [base]);

  if (command.includes("/") || (isWindows() && command.includes("\\")) || path.isAbsolute(command)) {
    const abs = path.resolve(command);
    for (const c of candidatesFor(abs)) if (isExecutableFile(c)) return c;
    // A Windows path that already exists without an extension (rare) is still usable via cross-spawn
    return isExecutableFile(abs) ? abs : null;
  }
  const dirs = envPathEntries(env);
  // cmd.exe searches the current directory first; CreateProcess does not. Match Node's spawn (no cwd lookup).
  for (const dir of dirs) {
    for (const c of candidatesFor(path.join(dir, command))) {
      if (isExecutableFile(c)) return c;
    }
  }
  return null;
}

/**
 * For an npm/pnpm/yarn `.cmd` shim, the JavaScript entry it runs with node, so it can be
 * spawned as `node <script> ...args` without cmd.exe. Null when the shim is not a node shim.
 */
export function npmShimTarget(cmdFile: string): string | null {
  let text: string;
  try {
    text = readFileSync(cmdFile, "utf-8");
  } catch {
    return null;
  }
  // cmd-shim:  "%_prog%"  "%dp0%\node_modules\pkg\cli.js" %*
  // pnpm:      "%~dp0\..\pkg\bin\cli.js" %*   (also via node.exe lookups)
  const re = /"(%~?dp0%?\\[^"\r\n]+?\.(?:c|m)?js)"/gi;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(text))) last = m[1];
  if (!last) return null;
  const rel = last.replace(/^%~?dp0%?\\?/i, "");
  const target = path.resolve(path.dirname(cmdFile), rel);
  return existsSync(target) ? target : null;
}

export interface SpawnPlan {
  command: string;
  args: string[];
  /** True when the plan needs cross-spawn (cmd.exe quoting) */
  viaShell: boolean;
}

/** How `command args` will be started on this platform (exported for tests and logging). */
export function planSpawn(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): SpawnPlan {
  if (!isWindows()) return { command, args, viaShell: false };
  const resolved = resolveCommand(command, env) ?? command;
  const ext = path.extname(resolved).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    const script = npmShimTarget(resolved);
    if (script) {
      const localNode = path.join(path.dirname(resolved), "node.exe");
      const nodeBin = existsSync(localNode) ? localNode : process.execPath;
      return { command: nodeBin, args: [script, ...args], viaShell: false };
    }
    return { command: resolved, args, viaShell: true };
  }
  return { command: resolved, args, viaShell: false };
}

export interface PortableSpawnOptions extends Omit<SpawnOptions, "shell"> {
  /**
   * Put the child in its own process group (Unix) so killTree() reaches its
   * descendants. Ignored on Windows, where taskkill /T walks the tree instead.
   */
  group?: boolean;
}

/**
 * spawn() that works for `.cmd` shims on Windows and never opens a console window.
 * On Unix, `group: true` makes the child a process-group leader (detached).
 */
export function spawnPortable(command: string, args: string[], opts: PortableSpawnOptions = {}): ChildProcess {
  const { group, ...rest } = opts;
  if (!isWindows()) {
    return nodeSpawn(command, args, { ...rest, detached: group ?? rest.detached });
  }
  const env = rest.env ?? process.env;
  const plan = planSpawn(command, args, env);
  const winOpts: SpawnOptions = { ...rest, detached: false, windowsHide: true };
  if (plan.viaShell) {
    if (args.some((a) => /[\r\n]/.test(a))) {
      console.warn(`[proc] ${path.basename(plan.command)} is a batch file: cmd.exe drops everything after a newline in arguments`);
    }
    return crossSpawn(plan.command, plan.args, winOpts);
  }
  return nodeSpawn(plan.command, plan.args, winOpts);
}

/** spawnSync() counterpart of spawnPortable() (version probes, short helpers). */
export function spawnPortableSync(command: string, args: string[], opts: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
  if (!isWindows()) return spawnSync(command, args, opts);
  const plan = planSpawn(command, args, opts.env ?? process.env);
  const winOpts: SpawnSyncOptions = { ...opts, windowsHide: true };
  return plan.viaShell ? crossSpawn.sync(plan.command, plan.args, winOpts) : spawnSync(plan.command, plan.args, winOpts);
}

/** True while `pid` exists (signal 0 probe; EPERM means it exists but is not ours). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Kill a process and everything it started.
 * - Unix: signal the process group (-pid) when the child leads one, else the pid.
 * - Windows: `taskkill /PID pid /T /F` (signals do not exist; the tree is always force-killed).
 *   `sync: true` waits for taskkill (use it during shutdown).
 * Never throws; returns false when there was nothing to kill.
 */
export function killTree(pid: number | undefined | null, signal: NodeJS.Signals = "SIGKILL", opts: { sync?: boolean } = {}): boolean {
  if (!pid || pid <= 0) return false;
  if (isWindows()) {
    const args = ["/PID", String(pid), "/T", "/F"];
    try {
      if (opts.sync) {
        const r = spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true, timeout: 5000 });
        return r.status === 0;
      }
      const child = nodeSpawn("taskkill", args, { stdio: "ignore", windowsHide: true });
      child.on("error", () => { /* taskkill missing: nothing else to try */ });
      child.unref();
      return true;
    } catch {
      return false;
    }
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

/** Open a URL or file with the desktop's default handler (open / start / xdg-open). */
export function openExternal(target: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [target]]
    : isWindows() ? ["cmd", ["/d", "/c", "start", "\"\"", target.replace(/[&|<>^"]/g, (c) => `^${c}`)]]
    : ["xdg-open", [target]];
  try {
    const child = nodeSpawn(cmd as string, args as string[], { stdio: "ignore", detached: !isWindows(), windowsHide: true, windowsVerbatimArguments: isWindows() });
    child.on("error", (err) => console.warn(`[proc] Could not open ${target}: ${err.message}`));
    child.unref();
  } catch (err) {
    console.warn(`[proc] Could not open ${target}: ${(err as Error).message}`);
  }
}

/** PIDs listening on a local TCP port (lsof on Unix, netstat on Windows). Empty when unknown. */
export function pidsListeningOn(port: number): number[] {
  try {
    if (isWindows()) {
      const r = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf-8", windowsHide: true, timeout: 3000 });
      const pids = new Set<number>();
      for (const line of (r.stdout ?? "").split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        // Proto  Local Address  Foreign Address  State  PID
        if (cols.length >= 5 && /LISTEN/i.test(cols[3]) && cols[1].endsWith(`:${port}`)) {
          const pid = Number(cols[4]);
          if (pid > 0) pids.add(pid);
        }
      }
      return [...pids];
    }
    const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf-8", timeout: 3000 });
    return (r.stdout ?? "").split("\n").map((s) => Number(s.trim())).filter((n) => n > 0);
  } catch {
    return [];
  }
}

/** Resolves true when something accepts TCP connections on 127.0.0.1:port. */
export function isPortOpen(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ port, host });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}
