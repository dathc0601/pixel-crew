/**
 * Network-facing security helpers for the gateway HTTP/WebSocket server.
 *
 * Kept free of gateway config and I/O side effects (except SessionTokenStore,
 * which persists to the file it is given) so they can be unit-tested directly.
 */
import type { IncomingMessage } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname, isAbsolute, relative, resolve, sep } from "path";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { UserRole } from "@pixel-crew/shared";

// ---------------------------------------------------------------------------
// Addresses, hosts and origins
// ---------------------------------------------------------------------------

/** True for 127.0.0.0/8, ::1 and IPv4-mapped loopback (::ffff:127.x.x.x). */
export function isLoopbackAddress(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.toLowerCase();
  if (a === "::1" || a === "0:0:0:0:0:0:0:1") return true;
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  return /^127(\.\d{1,3}){3}$/.test(v4);
}

/** Strip the port from a Host header value ("localhost:9090" → "localhost", "[::1]:9090" → "::1"). */
export function hostnameFromHostHeader(host: string | undefined): string | null {
  if (!host) return null;
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(1, end) : null;
  }
  const colon = h.lastIndexOf(":");
  return colon >= 0 ? h.slice(0, colon) : h;
}

/**
 * True when the Host header names this machine's loopback interface.
 * Rejecting other names on loopback-only endpoints defeats DNS rebinding
 * (evil.example resolving to 127.0.0.1 sends "Host: evil.example:9090").
 */
export function isLoopbackHostHeader(host: string | undefined): boolean {
  const name = hostnameFromHostHeader(host);
  if (!name) return false;
  return name === "localhost" || isLoopbackAddress(name);
}

/** Normalise an Origin header; returns null for absent, "null" or malformed values. */
export function normalizeOrigin(origin: string | undefined | null): string | null {
  if (!origin || origin === "null") return null;
  try {
    const u = new URL(origin);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export interface TrustedOriginOptions {
  /** Port the gateway UI is served on */
  port: number;
  /** Development mode: also trust the Next.js dev server */
  isDev: boolean;
  /** Dev server ports (default 3000 and 3002, plus NEXT_DEV_PORT) */
  devPorts?: number[];
  /** Extra origins from config (e.g. a hosted UI) */
  extra?: string[];
}

/** Origins allowed to make credentialed cross-origin calls (CORS allowlist). */
export function buildTrustedOrigins(opts: TrustedOriginOptions): Set<string> {
  const set = new Set<string>();
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    set.add(`http://${host}:${opts.port}`);
  }
  // Tauri webview origins (macOS/Linux use tauri://localhost, Windows uses http(s)://tauri.localhost)
  set.add("tauri://localhost");
  set.add("http://tauri.localhost");
  set.add("https://tauri.localhost");
  if (opts.isDev) {
    for (const p of opts.devPorts ?? [3000, 3002]) {
      set.add(`http://localhost:${p}`);
      set.add(`http://127.0.0.1:${p}`);
    }
  }
  for (const o of opts.extra ?? []) {
    const n = normalizeOrigin(o);
    if (n) set.add(n);
  }
  return set;
}

/** True when the Origin's host:port equals the Host header (a page served by this gateway). */
export function isSameHostOrigin(origin: string | undefined, hostHeader: string | undefined): boolean {
  const n = normalizeOrigin(origin);
  if (!n || !hostHeader) return false;
  try {
    return new URL(n).host === hostHeader.trim().toLowerCase();
  } catch {
    return false;
  }
}

export type Verdict = { ok: true } | { ok: false; status: number; reason: string };

export interface QuickConnectContext {
  trustedOrigins: Set<string>;
  /** Quick connect is disabled entirely when Ably is configured */
  ablyConfigured: boolean;
}

/** Requests proxied by Cloudflare Tunnel carry these headers. */
export function isTunnelRequest(req: IncomingMessage): boolean {
  return !!(req.headers["cf-connecting-ip"] || req.headers["cf-ray"]);
}

/**
 * Requests relayed by a local reverse proxy (Tailscale serve, Caddy, nginx, a tunnel).
 * They arrive on loopback, but the person behind them is not on this machine, so they
 * must never get the quick-connect owner token. The local UI sends none of these.
 */
export function isProxiedRequest(req: IncomingMessage): boolean {
  const h = req.headers;
  return isTunnelRequest(req) || !!(h["x-forwarded-for"] || h["x-forwarded-host"] || h["x-forwarded-proto"]
    || h["forwarded"] || h["x-real-ip"] || h["tailscale-user-login"] || h["tailscale-headers-info"]);
}

/**
 * GET /connect hands out an owner token without a pair code, so it must only
 * answer the local UI: a loopback socket, a loopback Host header, and either no
 * Origin (same-origin GET, curl) or a trusted Origin.
 */
export function checkQuickConnect(req: IncomingMessage, ctx: QuickConnectContext): Verdict {
  if (ctx.ablyConfigured) return { ok: false, status: 403, reason: "Quick connect disabled (Ably configured)" };
  if (isTunnelRequest(req)) return { ok: false, status: 403, reason: "Quick connect is not available through the tunnel" };
  if (isProxiedRequest(req)) return { ok: false, status: 403, reason: "Quick connect is not available through a proxy; pair with a QR code or the pair code" };
  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    return { ok: false, status: 403, reason: "Quick connect is only available on this machine; pair with the pair code instead" };
  }
  if (!isLoopbackHostHeader(req.headers.host)) {
    return { ok: false, status: 403, reason: "Quick connect requires a localhost Host header" };
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !ctx.trustedOrigins.has(normalizeOrigin(origin) ?? "")) {
    return { ok: false, status: 403, reason: "Origin not allowed" };
  }
  return { ok: true };
}

/**
 * WebSocket upgrades: allow no Origin (non-browser clients), trusted origins,
 * and pages served by this gateway itself (LAN or tunnel host).
 */
export function checkWebSocketOrigin(origin: string | undefined, hostHeader: string | undefined, trusted: Set<string>): Verdict {
  if (origin === undefined) return { ok: true };
  const n = normalizeOrigin(origin);
  if (n && trusted.has(n)) return { ok: true };
  if (isSameHostOrigin(origin, hostHeader)) return { ok: true };
  return { ok: false, status: 403, reason: "Origin not allowed" };
}

/**
 * Client key for rate limiting. Behind Cloudflare Tunnel every request arrives
 * from cloudflared on loopback, so trust CF-Connecting-IP only in that case.
 */
export function clientKey(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  const cf = req.headers["cf-connecting-ip"];
  if (isLoopbackAddress(remote) && typeof cf === "string" && cf) return `cf:${cf}`;
  // A local reverse proxy (Tailscale serve, Caddy…) appends the address it saw to X-Forwarded-For.
  // Take the last entry: earlier ones come from the client and could be rotated to dodge the limit.
  const xff = req.headers["x-forwarded-for"];
  if (isLoopbackAddress(remote) && typeof xff === "string" && xff.trim()) return `xff:${xff.split(",").pop()!.trim()}`;
  return remote;
}

/**
 * True when `candidate` is `root` or inside it, on any platform. Uses path.relative,
 * so Windows separators, drive letters and case-insensitive roots are handled, and a
 * sibling that only shares a prefix ("/srv/web-evil" vs "/srv/web") is rejected.
 */
export function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Constant-time string comparison (for pair codes). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Pair codes
// ---------------------------------------------------------------------------

/** No 0/O, 1/I/L: easy to read off a terminal and type on a phone. */
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIR_CODE_LENGTH = 8;

export function generatePairCode(length = PAIR_CODE_LENGTH): string {
  const bytes = randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length && i < bytes.length; i++) {
    const b = bytes[i];
    // Rejection sampling keeps the distribution uniform
    if (b < 256 - (256 % PAIR_ALPHABET.length)) out += PAIR_ALPHABET[b % PAIR_ALPHABET.length];
  }
  return out.length === length ? out : generatePairCode(length);
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

export interface RateLimiterOptions {
  /** Attempts allowed per window */
  max: number;
  windowMs: number;
  /** Lockout once the limit is exceeded */
  lockoutMs: number;
  now?: () => number;
}

/** Fixed-window attempt counter with a lockout, keyed by client. */
export class RateLimiter {
  private entries = new Map<string, { count: number; windowStart: number; lockedUntil: number }>();
  private now: () => number;
  constructor(private opts: RateLimiterOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Record an attempt. Returns whether it may proceed. */
  hit(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const t = this.now();
    let e = this.entries.get(key);
    if (e && e.lockedUntil > t) return { allowed: false, retryAfterMs: e.lockedUntil - t };
    if (!e || t - e.windowStart >= this.opts.windowMs || e.lockedUntil) {
      e = { count: 0, windowStart: t, lockedUntil: 0 };
      this.entries.set(key, e);
    }
    e.count++;
    if (e.count > this.opts.max) {
      e.lockedUntil = t + this.opts.lockoutMs;
      return { allowed: false, retryAfterMs: this.opts.lockoutMs };
    }
    if (this.entries.size > 10_000) this.prune(t);
    return { allowed: true };
  }

  private prune(t: number) {
    for (const [k, e] of this.entries) {
      if (e.lockedUntil <= t && t - e.windowStart >= this.opts.windowMs) this.entries.delete(k);
    }
  }
}

// ---------------------------------------------------------------------------
// Session tokens (device-bound, P5.4)
// ---------------------------------------------------------------------------

/** How a device got its session. "local" = /connect on this machine (renewed on every load). */
export type DeviceKind = "local" | "qr" | "code" | "share";

export interface SessionRecord {
  role: UserRole;
  issuedAt: number;
  expiresAt: number;
  /** Stable id for listing and revoking this device (not a secret) */
  deviceId: string;
  /** Human label, e.g. "iPhone · Safari" */
  name: string;
  kind: DeviceKind;
  lastSeenAt: number;
}

/** What the devices list shows (never the token or its hash). */
export type DeviceInfo = Omit<SessionRecord, "issuedAt"> & { issuedAt: number };

export interface IssueOptions {
  name?: string;
  kind?: DeviceKind;
}

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Local quick-connect sessions kept per gateway; older ones are dropped (every page load makes one). */
export const MAX_LOCAL_SESSIONS = 10;

const ROLES = new Set<UserRole>(["owner", "collaborator", "spectator"]);
const KINDS = new Set<DeviceKind>(["local", "qr", "code", "share"]);

/** Tokens are stored as SHA-256 hashes, so the file on disk cannot be replayed. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Short device label from a User-Agent ("iPhone · Safari", "Android · Chrome", "Mac · Firefox"). */
export function describeUserAgent(ua: string | undefined): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : /curl|node|undici/i.test(ua) ? "Script"
    : "Device";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "";
  return browser ? `${os} · ${browser}` : os;
}

/** Trim a client-supplied device name to printable text (≤ 60 chars). */
export function cleanDeviceName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 60);
  return n || null;
}

/**
 * Session tokens with expiry and one record per device, persisted to disk.
 *
 * File format v3 keys records by SHA-256(token). v2 files (raw tokens, no device
 * info) are migrated in place; pre-expiry files (token → role) are dropped, since some
 * may have been issued by the old unauthenticated /connect to another page or host.
 */
export class SessionTokenStore {
  /** hash(token) → record */
  private tokens = new Map<string, SessionRecord>();
  private now: () => number;
  readonly ttlMs: number;
  constructor(private file: string, opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.load();
  }

  private load() {
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, "utf-8"));
      const t = this.now();
      if (raw && (raw.version === 2 || raw.version === 3) && raw.tokens && typeof raw.tokens === "object") {
        for (const [key, rec] of Object.entries(raw.tokens as Record<string, Partial<SessionRecord>>)) {
          if (!rec || typeof rec.expiresAt !== "number" || rec.expiresAt <= t || !ROLES.has(rec.role as UserRole)) continue;
          const hash = raw.version === 2 ? hashToken(key) : key;
          this.tokens.set(hash, {
            role: rec.role as UserRole,
            issuedAt: typeof rec.issuedAt === "number" ? rec.issuedAt : t,
            expiresAt: rec.expiresAt,
            deviceId: typeof rec.deviceId === "string" ? rec.deviceId : randomBytes(6).toString("hex"),
            name: typeof rec.name === "string" ? rec.name : "Paired device",
            kind: KINDS.has(rec.kind as DeviceKind) ? (rec.kind as DeviceKind) : "code",
            lastSeenAt: typeof rec.lastSeenAt === "number" ? rec.lastSeenAt : (rec.issuedAt ?? t),
          });
        }
        if (raw.version === 2) this.persist();
      } else {
        console.log("[Auth] Dropping session tokens in the legacy format; paired devices must pair again");
        this.persist();
      }
    } catch { /* corrupt file: start fresh */ }
  }

  private persist() {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 3, tokens: Object.fromEntries(this.tokens) }), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, this.file);
  }

  issue(role: UserRole, opts: IssueOptions = {}): string {
    const token = randomBytes(24).toString("base64url");
    const t = this.now();
    this.pruneExpired(t);
    const kind = opts.kind ?? "code";
    this.tokens.set(hashToken(token), {
      role,
      issuedAt: t,
      expiresAt: t + this.ttlMs,
      deviceId: randomBytes(6).toString("hex"),
      name: opts.name ?? (kind === "local" ? "This computer" : "Paired device"),
      kind,
      lastSeenAt: t,
    });
    if (kind === "local") this.capLocal();
    this.persist();
    return token;
  }

  /** Role for a valid, unexpired token; null otherwise. */
  validate(token: unknown): UserRole | null {
    return this.lookup(token)?.role ?? null;
  }

  /** The device record for a valid, unexpired token (no secrets in it). */
  lookup(token: unknown): DeviceInfo | null {
    if (typeof token !== "string" || !token) return null;
    const hash = hashToken(token);
    const rec = this.tokens.get(hash);
    if (!rec) return null;
    if (rec.expiresAt <= this.now()) {
      this.tokens.delete(hash);
      this.persist();
      return null;
    }
    return { ...rec };
  }

  /** Record that a device just authenticated (shown in the devices list). */
  touch(token: string): void {
    const rec = this.tokens.get(hashToken(token));
    if (!rec) return;
    rec.lastSeenAt = this.now();
    this.persist();
  }

  /** Unexpired devices, newest first. */
  list(): DeviceInfo[] {
    this.pruneExpired(this.now());
    return [...this.tokens.values()].map((r) => ({ ...r })).sort((a, b) => b.issuedAt - a.issuedAt);
  }

  /** Revoke one device. Returns true when it existed. */
  revokeDevice(deviceId: string): boolean {
    for (const [hash, rec] of this.tokens) {
      if (rec.deviceId !== deviceId) continue;
      this.tokens.delete(hash);
      this.persist();
      return true;
    }
    return false;
  }

  /** Revoke every token except the ones listed (raw tokens). Returns how many were revoked. */
  revokeAll(keep: Iterable<string> = []): number {
    const keepSet = new Set([...keep].map(hashToken));
    let n = 0;
    for (const hash of [...this.tokens.keys()]) {
      if (keepSet.has(hash)) continue;
      this.tokens.delete(hash);
      n++;
    }
    this.persist();
    return n;
  }

  get size(): number {
    return this.tokens.size;
  }

  private capLocal() {
    const local = [...this.tokens.entries()].filter(([, r]) => r.kind === "local").sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
    for (let i = 0; i < local.length - MAX_LOCAL_SESSIONS; i++) this.tokens.delete(local[i][0]);
  }

  private pruneExpired(t: number) {
    for (const [hash, rec] of this.tokens) {
      if (rec.expiresAt <= t) this.tokens.delete(hash);
    }
  }
}

// ---------------------------------------------------------------------------
// One-time pairing tokens (QR codes, P5.4)
// ---------------------------------------------------------------------------

export const PAIR_TOKEN_TTL_MS = 2 * 60 * 1000;
const MAX_PENDING_PAIR_TOKENS = 20;

/**
 * 128-bit, single-use, 2-minute tokens for `…/pair#<token>` links and QR codes.
 * Kept in memory only (a restart invalidates them) and stored hashed. Consuming a
 * token deletes it, so a replayed link fails like an unknown one.
 */
export class PairingTokenStore {
  private pending = new Map<string, { role: UserRole; expiresAt: number }>();
  private now: () => number;
  readonly ttlMs: number;
  constructor(opts: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? PAIR_TOKEN_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  create(role: UserRole): { token: string; expiresAt: number } {
    const t = this.now();
    this.prune(t);
    while (this.pending.size >= MAX_PENDING_PAIR_TOKENS) {
      const oldest = this.pending.keys().next().value as string;
      this.pending.delete(oldest);
    }
    const token = randomBytes(16).toString("base64url");
    const expiresAt = t + this.ttlMs;
    this.pending.set(hashToken(token), { role, expiresAt });
    return { token, expiresAt };
  }

  /** The token's role if it is valid; the token is used up either way. */
  consume(token: unknown): UserRole | null {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
    const hash = hashToken(token);
    const entry = this.pending.get(hash);
    if (!entry) return null;
    this.pending.delete(hash);
    return entry.expiresAt > this.now() ? entry.role : null;
  }

  /** Invalidate every outstanding link (revoke all devices). */
  clear(): void {
    this.pending.clear();
  }

  get size(): number {
    this.prune(this.now());
    return this.pending.size;
  }

  private prune(t: number) {
    for (const [hash, e] of this.pending) if (e.expiresAt <= t) this.pending.delete(hash);
  }
}
