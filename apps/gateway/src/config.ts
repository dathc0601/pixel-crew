import "dotenv/config";
import { resolve, dirname, parse as parsePath } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";
import { migrateLegacyDataDir } from "./data-dir.js";
import { OfficeConfigManager } from "./office-config.js";
import type { OfficeConfig } from "@pixel-crew/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";
// One-time move of ~/.open-office[-dev] → ~/.pixel-crew[-dev] (runs before anything reads the dir).
const migration = migrateLegacyDataDir();
if (migration.status === "migrated") {
  console.log(`[Config] Migrated data dir ${migration.legacyDir} → ${migration.dataDir}${migration.symlinked ? " (old path is now a symlink)" : ""}`);
} else if (migration.status === "failed") {
  console.warn(`[Config] Could not migrate ${migration.legacyDir} (${migration.error}); continuing to use it`);
}
export const CONFIG_DIR = migration.dataDir;
// Orchestrator and memory packages resolve the data dir on their own; point them at the same place.
if (!process.env.PIXEL_CREW_HOME) process.env.PIXEL_CREW_HOME = CONFIG_DIR;
export const CONFIG_FILE = resolve(CONFIG_DIR, "config.json");


interface SavedConfig {
  ablyApiKey?: string;
  /** @deprecated Use telegramBotToken (singular) */
  telegramBotTokens?: (string | null)[];
  telegramBotToken?: string;
  telegramAllowedUsers?: string[];
  detectedBackends?: string[];
  defaultBackend?: string;
  /** Default model per backend (e.g. { "claude": "opus", "gemini": "gemini-2.5-pro" }) */
  defaultModels?: Record<string, string>;
  /** @deprecated Ignored. Bypass is per backend: office.backendPermissions[id] = "bypass" */
  sandboxMode?: "full" | "safe";
  worktreeEnabled?: boolean;
  autoMergeEnabled?: boolean;
  tunnelBaseUrl?: string;
  tunnelToken?: string;
  /** Listen on all interfaces so phones on the LAN can pair (default: loopback only) */
  lan?: boolean;
  /** Show CLI sessions started outside Pixel Crew (polls `ps`; default true). PIXEL_CREW_EXTERNAL_AGENTS=0 turns it off */
  externalAgents?: boolean;
  /** Extra origins allowed to call the gateway cross-origin (CORS / WebSocket) */
  allowedOrigins?: string[];
  /** Session token lifetime in ms (default 7 days) */
  sessionTtlMs?: number;
  /** Port for the separate preview origin (default: OS-assigned) */
  previewPort?: number;
  /** HTTPS address phones use to reach this gateway, e.g. a Tailscale serve URL (QR pairing links, trusted origin) */
  publicUrl?: string;
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}


function loadSavedConfig(): SavedConfig {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveConfig(cfg: SavedConfig) {
  ensureConfigDir();
  const existing = loadSavedConfig();
  const merged = { ...existing, ...cfg };
  // Remove keys explicitly set to undefined (e.g. clearing legacy fields)
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined) delete (merged as Record<string, unknown>)[k];
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
}

export function hasSetupRun(): boolean {
  return existsSync(CONFIG_FILE);
}

function getOrCreateMachineId(): string {
  ensureConfigDir();
  const idFile = resolve(CONFIG_DIR, "machine-id");

  if (existsSync(idFile)) {
    return readFileSync(idFile, "utf-8").trim();
  }

  const id = `mac-${randomBytes(4).toString("hex")}`;
  writeFileSync(idFile, id, "utf-8");
  console.log(`[Config] Generated machine ID: ${id}`);
  return id;
}

function resolveWebDir(): string {
  if (process.env.WEB_DIR) return process.env.WEB_DIR;
  // Bundled mode: dist/web (next to dist/index.js)
  const bundled = resolve(__dirname, "web");
  if (existsSync(resolve(bundled, "index.html"))) return bundled;
  // Dev mode: apps/web/out (relative to apps/gateway/src/)
  return resolve(__dirname, "../../web/out");
}

function ensureGitRepo(dir: string) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir, stdio: "ignore", timeout: 3000, windowsHide: true });
  } catch {
    try {
      execFileSync("git", ["init"], { cwd: dir, stdio: "pipe", timeout: 3000, windowsHide: true });
      execFileSync("git", ["-c", "user.name=PixelCrew", "-c", "user.email=bot@pixel-crew.local", "commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "pipe", timeout: 3000, windowsHide: true });
      console.log(`[Config] Initialized git repo in ${dir}`);
    } catch { /* ignore */ }
  }
}

function resolveDefaultWorkspace(): string {
  if (isDev) {
    // Dev mode: use ~/.pixel-crew-dev/projects/ (outside git repo so Claude Code
    // doesn't resolve to the source tree as its working directory)
    const ws = resolve(CONFIG_DIR, "projects");
    if (!existsSync(ws)) {
      mkdirSync(ws, { recursive: true });
      console.log(`[Config] Created default workspace: ${ws}`);
    }
    ensureGitRepo(ws);
    return ws;
  }
  // Published mode: use the directory where the user ran the command
  // Tauri sidecar runs with cwd="/", fall back to ~/.pixel-crew/projects/
  const cwd = process.cwd();
  if (cwd === parsePath(cwd).root) {
    const ws = resolve(CONFIG_DIR, "projects");
    if (!existsSync(ws)) {
      mkdirSync(ws, { recursive: true });
      console.log(`[Config] Created default workspace: ${ws}`);
    }
    ensureGitRepo(ws);
    return ws;
  }
  return cwd;
}

/**
 * Resolve a stable gateway instance ID.
 * - GATEWAY_ID env var takes precedence (e.g. Tauri sets "desktop")
 * - Falls back to "port-{wsPort}" so different ports auto-isolate
 *
 * Each gateway instance gets its own state directory under
 * ~/.pixel-crew[-dev]/data/instances/{gatewayId}/ to prevent cross-instance
 * context contamination (e.g. Tauri vs Web vs CLI all running separately).
 */
function resolveGatewayId(): string {
  if (process.env.GATEWAY_ID) return process.env.GATEWAY_ID;
  const port = Number(process.env.WS_PORT) || 9090;
  return `port-${port}`;
}

function resolveInstanceDir(gatewayId: string): string {
  const dir = resolve(CONFIG_DIR, "data", "instances", gatewayId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** "https://host[:port]" without a trailing slash, or undefined for empty/invalid values. */
function normalizePublicUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return `${u.protocol}//${u.host}`;
  } catch {
    console.warn(`[Config] Ignoring invalid publicUrl "${raw}"`);
    return undefined;
  }
}

function buildConfig() {
  ensureConfigDir();
  const saved = loadSavedConfig();
  const gatewayId = resolveGatewayId();
  const instanceDir = resolveInstanceDir(gatewayId);
  return {
    machineId: getOrCreateMachineId(),
    /** Unique identifier for this gateway instance (isolates state from other instances) */
    gatewayId,
    /** Per-instance state directory: ~/.pixel-crew[-dev]/data/instances/{gatewayId}/ */
    instanceDir,
    defaultWorkspace: (() => {
      const envWs = process.env.WORKSPACE;
      if (envWs && existsSync(envWs)) return envWs;
      if (envWs) console.log(`[Config] WORKSPACE="${envWs}" does not exist, using default`);
      return resolveDefaultWorkspace();
    })(),
    wsPort: Number(process.env.WS_PORT) || (isDev ? 9099 : 9090),
    /** Loopback by default; LAN only with --lan, PIXEL_CREW_LAN=1 or "lan": true in config.json */
    externalAgents: process.env.PIXEL_CREW_EXTERNAL_AGENTS === "0" ? false
      : process.env.PIXEL_CREW_EXTERNAL_AGENTS === "1" ? true
      : saved.externalAgents !== false,
    listenHost: (process.argv.includes("--lan") || process.env.PIXEL_CREW_LAN === "1" || saved.lan === true)
      ? "0.0.0.0"
      : "127.0.0.1",
    /** Where phones reach this gateway (Tailscale serve / reverse proxy); used for QR links and trusted as an origin */
    publicUrl: normalizePublicUrl(process.env.PIXEL_CREW_PUBLIC_URL || saved.publicUrl),
    allowedOrigins: Array.isArray(saved.allowedOrigins) ? saved.allowedOrigins.filter((o): o is string => typeof o === "string") : [],
    sessionTtlMs: typeof saved.sessionTtlMs === "number" && saved.sessionTtlMs > 0 ? saved.sessionTtlMs : 7 * 24 * 60 * 60 * 1000,
    isDev,
    /** Previews are served from their own port so they get their own origin (0 = OS-assigned) */
    previewPort: Number(process.env.PREVIEW_PORT) || (typeof saved.previewPort === "number" ? saved.previewPort : 0),
    ablyApiKey: process.env.ABLY_API_KEY || saved.ablyApiKey || undefined,
    webDir: resolveWebDir(),
    telegramBotToken:
      process.env.TELEGRAM_BOT_TOKEN
      || saved.telegramBotToken
      || (process.env.TELEGRAM_BOT_TOKENS?.split(",")[0]?.trim())
      || (saved.telegramBotTokens?.[0] ?? undefined)
      || undefined,
    telegramAllowedUsers: (
      process.env.TELEGRAM_ALLOWED_USERS
        ? process.env.TELEGRAM_ALLOWED_USERS.split(",").map((s) => s.trim()).filter(Boolean)
        : saved.telegramAllowedUsers ?? []
    ),
    detectedBackends: saved.detectedBackends ?? [],
    defaultBackend: saved.defaultBackend ?? "claude",
    defaultModels: saved.defaultModels ?? { claude: "opus" },
    /** Legacy upstream setting; it no longer grants bypass (see office.backendPermissions) */
    legacySandboxFull: saved.sandboxMode === "full",
    worktreeEnabled: saved.worktreeEnabled ?? true,
    autoMergeEnabled: saved.autoMergeEnabled ?? true,
    tunnelBaseUrl: (process.env.TUNNEL_BASE_URL || saved.tunnelBaseUrl || "").replace(/\/+$/, "") || undefined,
    tunnelToken: process.env.TUNNEL_TOKEN || saved.tunnelToken || undefined,
  };
}

export const config = buildConfig();

/** Reload config from saved file (after setup wizard) */
export function reloadConfig() {
  const fresh = buildConfig();
  Object.assign(config, fresh);
  officeConfig?.reload();
}

/**
 * The zod-validated "office" section of config.json (permissions, lead policy, hand-off timing).
 * Hot-reloaded once main() calls officeConfig.watch(); read it at the point of use.
 */
export const officeConfig = new OfficeConfigManager(CONFIG_FILE);
officeConfig.reload();

export function getOfficeConfig(): OfficeConfig {
  return officeConfig.get();
}
