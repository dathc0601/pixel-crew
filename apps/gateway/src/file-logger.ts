/**
 * File logger — tees console.log/warn/error to a size-capped, rotating log file (P4.4).
 * Usage: call `installFileLogger(dir)` once at startup.
 *
 * gateway.log is rotated to gateway.log.1 (and .1 to .2, …) when it would pass the cap,
 * also at startup when an old log is already over it. Total disk use stays under
 * maxBytes × (backups + 1). PIXEL_CREW_LOG_MAX_MB overrides the 5 MB default.
 */
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "fs";
import { resolve } from "path";

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const LOG_NAME = "gateway.log";
/** One log line never takes more than this (long prompts and payloads are cut) */
export const MAX_LINE_BYTES = 16 * 1024;

export interface RotatingLogOptions {
  maxBytes?: number;
  /** Rotated files to keep (gateway.log.1 … .N) */
  backups?: number;
}

export interface RotatingLog {
  write(line: string): void;
  close(): void;
  readonly path: string;
}

/** Cut a line to MAX_LINE_BYTES (UTF-8), marking the cut. */
export function capLine(line: string): string {
  if (Buffer.byteLength(line) <= MAX_LINE_BYTES) return line;
  const cut = Buffer.from(line).subarray(0, MAX_LINE_BYTES - 32).toString("utf8").replace(/�$/, "");
  return `${cut} …[truncated]\n`;
}

/** A log file that rotates itself by size. Writes are synchronous (small, ordered, crash-safe). */
export function createRotatingLog(dir: string, opts: RotatingLogOptions = {}): RotatingLog {
  const maxBytes = Math.max(1024, opts.maxBytes ?? DEFAULT_MAX_BYTES);
  const backups = Math.max(1, opts.backups ?? 2);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const logPath = resolve(dir, LOG_NAME);
  const backupPath = (n: number) => `${logPath}.${n}`;

  let size = 0;
  try { size = statSync(logPath).size; } catch { size = 0; }
  let fd: number | null = null;

  const rotate = () => {
    if (fd !== null) closeSync(fd);
    fd = null;
    try { rmSync(backupPath(backups), { force: true }); } catch { /* ignore */ }
    for (let n = backups - 1; n >= 1; n--) {
      if (existsSync(backupPath(n))) {
        try { renameSync(backupPath(n), backupPath(n + 1)); } catch { /* ignore */ }
      }
    }
    try { renameSync(logPath, backupPath(1)); } catch { /* nothing to rotate */ }
    size = 0;
  };

  if (size >= maxBytes) rotate();
  fd = openSync(logPath, "a");

  return {
    path: logPath,
    write(raw: string) {
      const line = capLine(raw);
      const bytes = Buffer.byteLength(line);
      if (size > 0 && size + bytes > maxBytes) rotate();
      if (fd === null) fd = openSync(logPath, "a");
      writeSync(fd, line);
      size += bytes;
    },
    close() {
      if (fd !== null) closeSync(fd);
      fd = null;
    },
  };
}

let log: RotatingLog | null = null;

function writeLine(level: string, args: unknown[]) {
  if (!log) return;
  const ts = new Date().toISOString();
  const msg = args.map(a =>
    typeof a === "string" ? a : (a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))
  ).join(" ");
  try {
    log.write(`${ts} [${level}] ${msg}\n`);
  } catch {
    // Disk full or file gone: keep the console output, drop the file copy
  }
}

/**
 * Install file logger: patches console.log/warn/error to also write to
 * `<dir>/gateway.log`, capped at PIXEL_CREW_LOG_MAX_MB (default 5) with 2 backups.
 */
export function installFileLogger(dir: string) {
  const mb = Number(process.env.PIXEL_CREW_LOG_MAX_MB);
  log = createRotatingLog(dir, { maxBytes: Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : undefined });

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => { origLog(...args); writeLine("INFO", args); };
  console.warn = (...args: unknown[]) => { origWarn(...args); writeLine("WARN", args); };
  console.error = (...args: unknown[]) => { origError(...args); writeLine("ERROR", args); };
}
