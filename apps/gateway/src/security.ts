/**
 * Network-facing security helpers for the gateway HTTP/WebSocket server.
 *
 * Kept free of gateway config and I/O side effects (except SessionTokenStore,
 * which persists to the file it is given) so they can be unit-tested directly.
 */
import type { IncomingMessage } from "http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname } from "path";
import { randomBytes, timingSafeEqual } from "crypto";
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
 * GET /connect hands out an owner token without a pair code, so it must only
 * answer the local UI: a loopback socket, a loopback Host header, and either no
 * Origin (same-origin GET, curl) or a trusted Origin.
 */
export function checkQuickConnect(req: IncomingMessage, ctx: QuickConnectContext): Verdict {
  if (ctx.ablyConfigured) return { ok: false, status: 403, reason: "Quick connect disabled (Ably configured)" };
  if (isTunnelRequest(req)) return { ok: false, status: 403, reason: "Quick connect is not available through the tunnel" };
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
  return remote;
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
// Session tokens
// ---------------------------------------------------------------------------

export interface SessionRecord {
  role: UserRole;
  issuedAt: number;
  expiresAt: number;
}

export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Session tokens with expiry, persisted to disk.
 *
 * Tokens in the pre-expiry format (token → role) are dropped on load: some may
 * have been issued by the old unauthenticated /connect to another page or host.
 */
export class SessionTokenStore {
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
      if (raw && raw.version === 2 && raw.tokens && typeof raw.tokens === "object") {
        const t = this.now();
        for (const [token, rec] of Object.entries(raw.tokens as Record<string, SessionRecord>)) {
          if (rec && typeof rec.expiresAt === "number" && rec.expiresAt > t
            && (rec.role === "owner" || rec.role === "collaborator" || rec.role === "spectator")) {
            this.tokens.set(token, rec);
          }
        }
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
    writeFileSync(tmp, JSON.stringify({ version: 2, tokens: Object.fromEntries(this.tokens) }), { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, this.file);
  }

  issue(role: UserRole): string {
    const token = randomBytes(24).toString("base64url");
    const t = this.now();
    this.pruneExpired(t);
    this.tokens.set(token, { role, issuedAt: t, expiresAt: t + this.ttlMs });
    this.persist();
    return token;
  }

  /** Role for a valid, unexpired token; null otherwise. */
  validate(token: unknown): UserRole | null {
    if (typeof token !== "string" || !token) return null;
    const rec = this.tokens.get(token);
    if (!rec) return null;
    if (rec.expiresAt <= this.now()) {
      this.tokens.delete(token);
      this.persist();
      return null;
    }
    return rec.role;
  }

  /** Revoke every token except the ones listed. Returns how many were revoked. */
  revokeAll(keep: Iterable<string> = []): number {
    const keepSet = new Set(keep);
    let n = 0;
    for (const token of [...this.tokens.keys()]) {
      if (keepSet.has(token)) continue;
      this.tokens.delete(token);
      n++;
    }
    this.persist();
    return n;
  }

  get size(): number {
    return this.tokens.size;
  }

  private pruneExpired(t: number) {
    for (const [token, rec] of this.tokens) {
      if (rec.expiresAt <= t) this.tokens.delete(token);
    }
  }
}
